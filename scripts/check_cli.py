#!/usr/bin/env python3
"""Layer-4 check: every generated AWS CLI command matches the AWS CLI service model (botocore).

Usage: check_cli.py <dir>

Walks <dir> recursively and checks every `aws` invocation in command position in
  * *.sh (bash) and *.ps1 (PowerShell),
  * README.md: ```sh / ```bash / ```shell fences (bash rules), ```powershell / ```pwsh / ```ps1 fences
    (PowerShell rules), and inline code spans starting with `aws ` (a span followed by "command(s)" only
    names an operation, so only the operation's existence is checked),
  * `aws ...` commands quoted in template.yaml / main.tf comments (deploy/delete/attach hints).
Heredoc / here-string bodies and script comment lines are skipped, except heredocs fed to a shell
(`bash <<EOF`, `cat <<EOF | bash`), whose bodies are checked as scripts. `aws.exe`, quoted `'aws'` and paths
to aws count as aws.

It never skips silently: a line that looks like an aws command (`aws <word> <word>`) but yielded no
command, an unterminated heredoc/here-string/quote/substitution, and a fence in another language that
contains `aws ` are all problems, and so is a README prose line (outside code spans and fences) that reads
like a command (`aws <svc> <op> --flag`). In scripts and README fences, a reference to a variable that is
never assigned (in any form) and isn't automatic/environment (PowerShell automatic variables, $env:*;
bash special parameters, HOME/PWD/PATH-style variables, AWS_*) is a problem: typos fail. That includes
references in bodies the shell expands: unquoted heredocs (`<<EOF`) and PowerShell `@"..."@` here-strings,
but not `<<'EOF'` or `@'...'@`, which are literal.

For each command it asserts: the operation (or waiter) exists, every --flag (or --flag=value) maps to an
input member or a CLI global (none given twice), boolean members are used as --flag / --no-flag, every
flag that needs a value has one, values parse (integers, booleans, JSON or shorthand structures/lists,
file:// files next to the script), enums hold, every required member is present, and finally botocore's
own ParamValidator (what the CLI runs before sending) accepts the parameters, plus the model's max length
and pattern for literal strings. Literal variable assignments in the script (bash `VAR='...'`, PowerShell
`$Var = '...'`, unindented, the only assignment of that name) are substituted, so "$ROLE_NAME" and
"${ROLE_NAME}-policy" are checked for real; values that stay dynamic (reassigned, conditional, scoped,
exported, from a command) get placeholders that satisfy the model. The summary counts model patterns
Python's re cannot compile (those are not checked).
Exit 1 with `file:line: message` per problem.
"""

from __future__ import annotations

import json
import os
import re
import shlex
import sys
from dataclasses import dataclass, field

import botocore.session
from botocore import xform_name
from botocore.validate import ParamValidator

# --- CLI globals: flag -> takes a value ---------------------------------------------------------
GLOBALS: dict[str, bool] = {
    "--query": True,
    "--output": True,
    "--region": True,
    "--profile": True,
    "--endpoint-url": True,
    "--no-cli-pager": False,
    "--debug": False,
    "--no-paginate": False,
}
OUTPUT_FORMATS = {"json", "text", "table", "yaml", "yaml-stream"}
# Added by the CLI to paginated operations.
PAGINATION_FLAGS: dict[str, bool] = {"--max-items": True, "--starting-token": True, "--page-size": True}
# Top-level command names that differ from the botocore service name.
SERVICE_ALIASES = {"s3api": "s3", "configservice": "config"}

# `aws cloudformation deploy` is a CLI customization, not a botocore operation, so it is checked
# against this hard-coded list of its documented flags (AWS CLI v2 reference). flag -> kind.
CFN_DEPLOY_FLAGS: dict[str, str] = {
    "--template-file": "value",
    "--stack-name": "value",
    "--s3-bucket": "value",
    "--s3-prefix": "value",
    "--kms-key-id": "value",
    "--role-arn": "value",
    "--parameter-overrides": "list",
    "--capabilities": "list",
    "--notification-arns": "list",
    "--tags": "list",
    "--force-upload": "flag",
    "--use-json": "flag",
    "--no-execute-changeset": "flag",
    "--fail-on-empty-changeset": "flag",
    "--no-fail-on-empty-changeset": "flag",
    "--disable-rollback": "flag",
    "--no-disable-rollback": "flag",
}
CFN_DEPLOY_REQUIRED = ("--template-file", "--stack-name")
CFN_CAPABILITIES = {"CAPABILITY_IAM", "CAPABILITY_NAMED_IAM", "CAPABILITY_AUTO_EXPAND"}
# `aws configure get <name>` (CLI customization, used for the region preflight): the names it may read.
CONFIGURE_GET_NAMES = {"region", "output"}

# Anything that looks like `aws <service> <operation>` (also aws.exe, 'aws', "aws"): every match must yield a
# checked command. So echo / Write-Output text containing `aws <word> <word>` is reported too (fails safe).
AWS_LIKE = re.compile(r"\baws(?:\.exe)?['\"]?\s+[a-z0-9-]+\s+[a-z0-9-]+")
# README prose (outside code spans and fences) that reads like a runnable command.
PROSE_COMMAND = re.compile(r"\baws(?:\.exe)?\s+[a-z0-9-]+\s+[a-z0-9-]+\s+--[a-z]")
AWS_NAMES = {"aws", "aws.exe"}
# Model patterns Python's re cannot compile (Java-only syntax); counted in the summary.
UNCOMPILABLE: set[str] = set()
VAR_REF = re.compile(r"\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))")


@dataclass
class Word:
    raw: str  # source text of the shell word
    value: str  # unquoted value
    opaque: bool  # contains a variable or command substitution that could not be resolved


@dataclass
class Command:
    line: int  # 1-based line of the `aws` word
    words: list[Word] = field(default_factory=list)
    name_only: bool = False  # README prose span that only names an operation


Problem = tuple[int, str]  # (line, message)

# --- Tokenizer ------------------------------------------------------------------------------------
# Words after which the next word is still in command position.
BASH_KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do", "!", "time", "exec", "env", "command", "nohup"}
PS_KEYWORDS = {"if", "elseif", "while", "-not", "!", "return", "throw"}
# A heredoc fed to one of these is a script: its body is checked like the rest of the file.
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
PS_SINGLE_QUOTES = "'‘’‚‛"


class Scanner:
    """Finds `aws` commands in command position in one logical source line (continuations joined)."""

    def __init__(self, text: str, dialect: str, line_of):
        self.s = text
        self.ps = dialect == "ps"
        self.line_of = line_of  # offset -> source line number
        self.commands: list[Command] = []
        # bash: [marker, strip tabs, body is a shell script, body is expanded (unquoted marker)] for heredoc
        # bodies starting on the next line
        self.heredocs: list[list] = []
        self.command_word = ""  # first word of the current simple command (bash: `bash <<EOF` runs the body)
        self.here_string: str | None = None  # PowerShell: terminator ('@ or "@) of a body starting next line
        self.backticks = 0  # bash: depth of `...` command substitution
        self.assigned: list[str] = []  # bash: NAME=... words in command position
        self.simple: list[list[Word]] = []  # bash: words of each simple command that isn't an aws command

    def _stop(self, c: str) -> bool:
        """Characters that end a word."""
        if c.isspace() or c in ";|&<>()":
            return True
        if self.ps:
            return c in "{}"
        return c == "`" and self.backticks > 0

    def _var_start(self, i: int) -> bool:
        s = self.s
        return s[i] == "$" and i + 1 < len(s) and (s[i + 1].isalnum() or s[i + 1] in "_{")

    def _backtick_subst(self, i: int) -> int:
        self.backticks += 1
        j = self.scan(i + 1, "`")
        self.backticks -= 1
        return j

    def read_word(self, i: int) -> tuple[Word, int]:
        s, n, start = self.s, len(self.s), i
        out: list[str] = []
        opaque = False
        while i < n and not self._stop(s[i]):
            c = s[i]
            if self.ps and c == "@" and i + 1 < n and s[i + 1] in "'\"" and not s[i + 2 :].strip():
                self.here_string = s[i + 1] + "@"  # here-string body follows on the next lines
                out.append(s[i:])
                opaque = True
                i = n
            elif self.ps and c in PS_SINGLE_QUOTES:
                i += 1
                while True:
                    if i >= n:
                        raise ValueError("unterminated single quote")
                    if s[i] in PS_SINGLE_QUOTES:
                        if i + 1 < n and s[i + 1] in PS_SINGLE_QUOTES:
                            out.append(s[i])
                            i += 2
                            continue
                        i += 1
                        break
                    out.append(s[i])
                    i += 1
            elif not self.ps and c == "'":
                j = s.find("'", i + 1)
                if j < 0:
                    raise ValueError("unterminated single quote")
                out.append(s[i + 1 : j])
                i = j + 1
            elif c == '"':
                i += 1
                esc = "`" if self.ps else "\\"
                while i < n and s[i] != '"':
                    if s[i] == esc and i + 1 < n:
                        out.append(s[i + 1])
                        i += 2
                    elif self.ps and s[i] == '"' and i + 1 < n and s[i + 1] == '"':
                        out.append('"')
                        i += 2
                    elif s[i] == "$" and i + 1 < n and s[i + 1] == "(":
                        j = self.scan(i + 2, ")")
                        out.append(s[i:j])
                        opaque = True
                        i = j
                    elif not self.ps and s[i] == "`":
                        j = self._backtick_subst(i)
                        out.append(s[i:j])
                        opaque = True
                        i = j
                    else:
                        opaque = opaque or self._var_start(i)
                        out.append(s[i])
                        i += 1
                if i >= n:
                    raise ValueError("unterminated double quote")
                i += 1
            elif c == ("`" if self.ps else "\\") and i + 1 < n:
                out.append(s[i + 1])
                i += 2
            elif not self.ps and c == "`":
                j = self._backtick_subst(i)
                out.append(s[i:j])
                opaque = True
                i = j
            elif c == "$" and i + 1 < n and s[i + 1] == "(":
                j = self.scan(i + 2, ")")
                out.append(s[i:j])
                opaque = True
                i = j
            else:
                opaque = opaque or self._var_start(i)
                out.append(c)
                i += 1
        raw = s[start:i]
        value = "".join(out)
        if not self.ps and not opaque and raw.strip():
            # Plain bash words are cooked by shlex (posix), the reference tokenizer.
            value = shlex.split(raw, comments=False, posix=True)[0]
        return Word(raw, value, opaque), i

    def skip_space(self, i: int) -> int:
        while i < len(self.s) and self.s[i].isspace():
            i += 1
        return i

    def read_command(self, i: int) -> int:
        """Reads an aws command starting at i until an unquoted separator; records it."""
        cmd = Command(self.line_of(i))
        s, n = self.s, len(self.s)
        while True:
            i = self.skip_space(i)
            if i >= n or (self._stop(s[i]) and not s[i].isspace()):
                break
            if s[i] == "#":
                i = n
                break
            w, i = self.read_word(i)
            cmd.words.append(w)
        # `2>&1` / `2> file` / PowerShell `*>$null`: the stream number belongs to the redirection.
        if i < n and s[i] in "<>" and len(cmd.words) > 1 and (cmd.words[-1].raw.isdigit() or cmd.words[-1].raw == "*"):
            cmd.words.pop()
        self.commands.append(cmd)
        return i

    def scan(self, i: int, closer: str | None) -> int:
        """Scans a command list until `closer`; returns the index after it."""
        s, n = self.s, len(self.s)
        cmdpos = True
        cur: list[Word] | None = None  # words of the current simple command
        piped: list[int] = []  # heredocs opened earlier in the current pipeline (`cat <<EOF | bash`)
        while i < n:
            c = s[i]
            if c.isspace():
                i += 1
                continue
            if closer and c == closer:
                return i + 1
            if c == "#":
                i = n  # comment to end of line
                break
            if c in ";|&":
                j = i
                while j < n and s[j] in ";|&":
                    j += 1
                if s[i:j] != "|":
                    piped = []
                i = j
                cmdpos = True
                cur = None
                self.command_word = ""
                continue
            if c in "<>":
                j = i
                while j < n and s[j] in "<>&":
                    j += 1
                op = s[i:j]
                strip_tabs = False
                if not self.ps and op == "<<" and j < n and s[j] == "-":
                    strip_tabs = True
                    j += 1
                i = self.skip_space(j)
                if i < n and not self._stop(s[i]):
                    w, i = self.read_word(i)
                    if not self.ps and op == "<<":
                        script = os.path.basename(self.command_word) in SHELLS
                        piped.append(len(self.heredocs))
                        expanded = not any(q in w.raw for q in "'\"\\")  # <<EOF, not <<'EOF' / <<\EOF
                        self.heredocs.append([w.value, strip_tabs, script, expanded])
                continue
            if c == "(":
                i = self.scan(i + 1, ")")
                cmdpos = False
                continue
            if c == ")":
                i += 1
                cmdpos = True  # bash `case` pattern: `pat) aws ...`
                cur = None
                continue
            if self.ps and c in "{}":
                i += 1
                cmdpos = True
                cur = None
                continue
            start = i
            w, j = self.read_word(i)
            if cmdpos and is_aws(w):
                i = self.read_command(start)
                cmdpos = False
                cur = None
                continue
            i = j
            if not self.ps and w.raw in ("{", "}"):
                cmdpos = True  # group / function body: `f() { aws ...; }`
                cur = None
                continue
            if not cmdpos:
                if self.ps and w.raw in ("=", "+="):
                    cmdpos = True  # $Var = aws ...
                elif cur is not None:
                    cur.append(w)
                continue
            if self.ps:
                if w.raw.lower() in PS_KEYWORDS:
                    continue
                if w.raw.startswith("$"):
                    cmdpos = False  # assignment target; `=` re-enables
                    continue
            elif w.raw in BASH_KEYWORDS:
                continue  # keyword or `env`
            else:
                m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)\+?=", w.raw)
                if m:
                    self.assigned.append(m.group(1))
                    continue  # VAR=... (assignment or prefix)
            self.command_word = w.value
            if not self.ps:
                cur = [w]
                self.simple.append(cur)
                if os.path.basename(w.value) in SHELLS:
                    for k in piped:  # `cat <<'EOF' | bash`: the heredoc body runs
                        self.heredocs[k][2] = True
            cmdpos = False
        if closer and self.here_string is None:  # a here-string body continues the expression
            raise ValueError(f"unterminated {'$(' if closer == ')' else closer} substitution")
        return i


def resolve(word: Word, variables: dict[str, str], ps: bool) -> Word:
    """Substitutes known literal variables into an opaque word (not command substitutions)."""
    if not word.opaque or "$(" in word.value or "`" in word.value or "@'" in word.value or '@"' in word.value:
        return word
    refs = [a or b for a, b in VAR_REF.findall(word.value)]
    key = (lambda name: name.lower()) if ps else (lambda name: name)
    if not refs or not all(key(r) in variables for r in refs):
        return word
    value = VAR_REF.sub(lambda m: variables[key(m.group(1) or m.group(2))], word.value)
    return Word(word.raw, value, False)


def is_aws(w: Word) -> bool:
    """`aws`, `aws.exe`, `'aws'`, or a path to either (`/usr/local/bin/aws`, Windows backslash paths)."""
    return not w.opaque and re.split(r"[\\/]", w.value)[-1].lower() in AWS_NAMES


# Variables that exist without an assignment in the script.
PS_AUTOMATIC = {
    "_", "psitem", "pwd", "lastexitcode", "null", "true", "false", "erroractionpreference", "args", "matches",
    "psscriptroot", "pscommandpath", "home", "psversiontable", "error", "host", "input", "myinvocation",
    "iswindows", "islinux", "ismacos", "progresspreference", "verbosepreference", "warningpreference",
    "informationpreference", "debugpreference", "confirmpreference", "ofs", "this",
}  # fmt: skip
BASH_ENV = {
    "_", "HOME", "PWD", "OLDPWD", "PATH", "USER", "SHELL", "TMPDIR", "IFS", "RANDOM", "LINENO", "SECONDS",
    "BASH_SOURCE", "BASH_VERSION", "FUNCNAME", "PIPESTATUS", "OSTYPE", "HOSTNAME", "UID", "EUID", "PPID",
    "REPLY", "OPTARG", "OPTIND",
}  # fmt: skip
PS_SCOPES = ("script", "global", "local", "private", "using")
# ${X}, ${#X}, ${!X}; group 3 is a default/assign/error/alternate operator (`${X:-d}`), which can't fail.
BASH_BRACED = re.compile(r"\{([#!]?)([A-Za-z_]\w*)(:?[-=?+])?")
PS_BRACED = re.compile(r"\{([A-Za-z_]\w*(?::[A-Za-z_]\w*)?)\}")


def references(text: str, ps: bool, body: bool = False) -> list[tuple[int, str]]:
    """(offset, name) of every variable reference outside single quotes and comments.

    bash `${X:-default}` style expansions (default, assign, error, alternate) are not references that can
    fail, so they are left out; PowerShell `$env:X` is the environment, also left out. `body`: `text` is an
    expanded heredoc / @"..."@ here-string body, where quotes and # are literal outside $(...).
    """
    refs: list[tuple[int, str]] = []
    esc = "`" if ps else "\\"
    stack: list[str] = []  # '"' (double quotes) or ')' (command substitution)
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        in_dq = bool(stack) and stack[-1] == '"'
        if c == esc and i + 1 < n:
            i += 2
            continue
        if c == "$" and i + 1 < n:
            nxt = text[i + 1]
            if nxt == "(":
                stack.append(")")
                i += 2
                continue
            m = re.match(PS_BRACED if ps else BASH_BRACED, text[i + 1 :])
            if m and not ps:
                if not m.group(3):
                    refs.append((i, m.group(2)))
                i += 1 + m.end()
                continue
            if m and ps:
                name = m.group(1)
                scope, _, rest = name.rpartition(":")
                if scope.lower() != "env":
                    refs.append((i, rest if scope.lower() in PS_SCOPES or not scope else name))
                i += 1 + m.end()
                continue
            m = re.match(r"([A-Za-z_]\w*)(:[A-Za-z_]\w*)?" if ps else r"[A-Za-z_]\w*", text[i + 1 :])
            if m:
                if ps and m.group(2):
                    scope = m.group(1).lower()
                    if scope != "env":
                        refs.append((i, m.group(2)[1:] if scope in PS_SCOPES else m.group(0)))
                else:
                    refs.append((i, m.group(1) if ps else m.group(0)))
                i += 1 + m.end()
                continue
            i += 1
            continue
        if body and not stack:
            i += 1
            continue
        if in_dq:
            if c == '"':
                if ps and i + 1 < n and text[i + 1] == '"':
                    i += 2
                    continue
                stack.pop()
            i += 1
            continue
        if c == "'" or (ps and c in PS_SINGLE_QUOTES):
            j = i + 1
            while j < n and not (text[j] == "'" or (ps and text[j] in PS_SINGLE_QUOTES)):
                j += 1
            i = j + 1
            continue
        if c == '"':
            stack.append('"')
        elif c == ")" and stack:
            stack.pop()
        elif c == "#" and (i == 0 or text[i - 1].isspace() or text[i - 1] in ";|&("):
            break  # comment
        i += 1
    return refs


PS_ASSIGN = re.compile(r"\$(?:\{)?(?:([A-Za-z_]\w*):)?([A-Za-z_]\w*)\}?\s*(?:[-+*/%]|\?\?)?=(?!=)")


def assigned_names(text: str, sc: Scanner, ps: bool) -> list[str]:
    """Every name the logical line assigns, in any form (literal or not)."""
    if ps:
        names = [m.group(2) for m in PS_ASSIGN.finditer(text) if (m.group(1) or "").lower() != "env"]
        names += re.findall(r"(?i)\bforeach\s*\(\s*\$([A-Za-z_]\w*)\s+in\b", text)
        names += re.findall(r"(?i)-(?:Out|Error|Warning|Information|Pipeline)Variable\s+['\"]?([A-Za-z_]\w*)", text)
        names += re.findall(r"(?i)\b(?:Set|New)-Variable\s+(?:-Name\s+)?['\"]?([A-Za-z_]\w*)", text)
        for block in re.findall(r"(?i)\bparam\s*\(([^)]*)\)", text) + re.findall(r"(?i)\bfunction\s+[\w-]+\s*\(([^)]*)\)", text):
            names += re.findall(r"\$([A-Za-z_]\w*)", block)
        return names
    names = list(sc.assigned)
    ident = re.compile(r"[A-Za-z_]\w*")
    for words in sc.simple:
        head, rest = os.path.basename(words[0].value), words[1:]
        values = [w.value for w in rest if not w.opaque or "=" in w.raw]
        if head in ("export", "readonly", "local", "declare", "typeset"):
            names += [m.group(1) for v in values if (m := re.match(r"([A-Za-z_]\w*)(?:\+?=|$)", v)) and not v.startswith("-")]
        elif head in ("read", "mapfile", "readarray"):
            names += [w.value for w in rest if ident.fullmatch(w.raw)]
        elif head == "printf" and "-v" in values[:-1]:
            names.append(values[values.index("-v") + 1])
        elif head == "getopts" and len(values) >= 2:
            names.append(values[1])
        elif head in ("for", "select") and values:
            names.append(values[0])
    return names


def literal_candidate(text: str, ps: bool) -> tuple[str, str] | None:
    """(name, value text) for an unindented whole-line `NAME=value` / `$Name = value`."""
    m = re.fullmatch(r"\$([A-Za-z_]\w*)\s*=\s*(.*)" if ps else r"([A-Za-z_]\w*)=(.*)", text)
    return (m.group(1), m.group(2)) if m else None


def literal_value(rest: str, dialect: str, variables: dict[str, str]) -> str | None:
    if not rest:
        return "" if dialect == "bash" else None
    sc = Scanner(rest, dialect, lambda _off: 0)
    try:
        w, j = sc.read_word(0)
    except ValueError:
        return None
    if sc.skip_space(j) != len(rest) or sc.commands:
        return None
    w = resolve(w, variables, dialect == "ps")
    if not w.opaque and (dialect == "bash" or w.raw[:1] in PS_SINGLE_QUOTES + '"'):
        return w.value
    return None


@dataclass
class Logical:
    text: str
    nums: list[int]  # source line per character
    scanner: Scanner


def extract(
    text: str, dialect: str, line_offset: int = 0, undefined: bool = True, outer: frozenset[str] = frozenset()
) -> tuple[list[Command], list[Problem]]:
    """Commands in a script, plus problems: unrecognized aws-looking lines, unterminated constructs, and
    (when `undefined`) references to variables the script never assigns. `outer`: names assigned by the
    script a heredoc body comes from."""
    ps = dialect == "ps"
    key = str.lower if ps else str
    problems: list[Problem] = []
    logicals: list[Logical] = []
    bodies: list[tuple[str, int]] = []  # (body, first line) of heredocs fed to a shell
    expanded: list[tuple[str, int]] = []  # (body, first line) of unquoted heredocs and @"..."@ here-strings
    heredocs: list[list] = []
    body: list[str] = []
    body_start = 0
    here_string: str | None = None
    opened_at = 0
    block_comment = False
    buf, nums = "", []

    def process(logical: str, nums: list[int]) -> None:
        nonlocal heredocs, here_string, opened_at
        sc = Scanner(logical, dialect, lambda off: nums[min(off, len(nums) - 1)] + line_offset)
        try:
            sc.scan(0, None)
        except ValueError as e:
            problems.append((nums[0] + line_offset, f"cannot tokenize: {e}"))
        logicals.append(Logical(logical, nums, sc))
        for ln in sorted(set(nums)):
            part = "".join(ch for ch, num in zip(logical, nums, strict=True) if num == ln)
            found = len(AWS_LIKE.findall(part))
            got = sum(1 for c in sc.commands if c.line == ln + line_offset)
            if got < found:
                problems.append((ln + line_offset, f"aws command not recognized by the checker: {part.strip()[:80]}"))
        heredocs = list(sc.heredocs)
        here_string = sc.here_string
        opened_at = nums[-1]

    for idx, line in enumerate(text.split("\n"), start=1):
        if heredocs:
            marker, strip_tabs, script, expands = heredocs[0]
            if (line.lstrip("\t") if strip_tabs else line) == marker:
                heredocs.pop(0)
                if script:  # `bash <<EOF` / `cat <<EOF | bash`: the body runs, so check it
                    bodies.append(("\n".join(body), body_start))
                elif expands and body:  # `cat <<EOF`: the shell expands variables in the body
                    expanded.append(("\n".join(body), body_start))
                body = []
            else:
                if not body:
                    body_start = idx
                body.append(line.lstrip("\t") if strip_tabs else line)
            continue
        if here_string is not None:
            if line.startswith(here_string):
                if here_string == '"@' and body:  # @"..."@ expands variables; @'...'@ is literal
                    expanded.append(("\n".join(body), body_start))
                here_string = None
                body = []
            else:
                if not body:
                    body_start = idx
                body.append(line)
            continue
        if ps and block_comment:
            if "#>" in line:
                block_comment = False
            continue
        stripped = line.strip()
        if not buf and (stripped.startswith("#") or not stripped):
            if ps and stripped.startswith("<#") and "#>" not in stripped:
                block_comment = True
            continue
        cont = "`" if ps else "\\"
        if line.endswith(cont) and not line.endswith(cont * 2):
            piece = line[:-1] + " "
            buf += piece
            nums += [idx] * len(piece)
            continue
        buf += line
        nums += [idx] * len(line)
        process(buf, nums)
        buf, nums = "", []
    if buf:
        process(buf, nums)
    if heredocs:
        problems.append((opened_at + line_offset, f"unterminated heredoc (no line '{heredocs[0][0]}')"))
    if here_string is not None:
        problems.append((opened_at + line_offset, f"unterminated here-string (no line starting with {here_string})"))
    if ps and block_comment:
        problems.append((line_offset + 1, "unterminated <# block comment"))

    # Every assignment of every name, in any form. Only a name assigned exactly once, by an unindented
    # whole-line literal, keeps its value; anything else (reassigned, conditional, export/local, scoped,
    # from a command) is dynamic and gets a placeholder.
    counts: dict[str, int] = {}
    for lg in logicals:
        for name in assigned_names(lg.text, lg.scanner, ps):
            counts[key(name)] = counts.get(key(name), 0) + 1
    variables: dict[str, str] = {}
    for lg in logicals:
        cand = literal_candidate(lg.text, ps)
        if cand and counts.get(key(cand[0])) == 1:
            value = literal_value(cand[1], dialect, variables)
            if value is not None:
                variables[key(cand[0])] = value
    cmds: list[Command] = []
    for lg in logicals:
        for c in lg.scanner.commands:
            c.words = [resolve(w, variables, ps) for w in c.words]
        cmds.extend(lg.scanner.commands)

    known = set(counts) | set(outer) | (PS_AUTOMATIC if ps else BASH_ENV)
    if undefined:
        seen: set[tuple[int, str]] = set()
        for lg in logicals:
            for off, name in references(lg.text, ps):
                if key(name) in known or (not ps and name.startswith("AWS_")):
                    continue
                line = lg.nums[min(off, len(lg.nums) - 1)] + line_offset
                if (line, key(name)) not in seen:
                    seen.add((line, key(name)))
                    problems.append((line, f"${name} is never assigned"))
        for body_text, start in expanded:
            for off, name in references(body_text, ps, body=True):
                if key(name) in known or (not ps and name.startswith("AWS_")):
                    continue
                line = start + body_text.count("\n", 0, off) + line_offset
                if (line, key(name)) not in seen:
                    seen.add((line, key(name)))
                    problems.append((line, f"${name} is never assigned"))
    for body_text, start in bodies:
        c, p = extract(body_text, "bash", line_offset + start - 1, undefined, frozenset(known))
        cmds.extend(c)
        problems.extend(p)
    cmds.sort(key=lambda c: c.line)
    problems.sort(key=lambda p: p[0])
    return cmds, problems


def extract_commands(text: str, dialect: str, line_offset: int = 0) -> list[Command]:
    return extract(text, dialect, line_offset)[0]


FENCE_DIALECTS = {"sh": "bash", "bash": "bash", "shell": "bash", "powershell": "ps", "pwsh": "ps", "ps1": "ps"}


def markdown(text: str) -> tuple[list[Command], list[Problem]]:
    """Fenced blocks by language, and inline code spans starting with `aws ` outside fences."""
    cmds: list[Command] = []
    problems: list[Problem] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        m = re.match(r"^```(\S*)\s*$", lines[i])
        if m:
            lang = m.group(1).lower()
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            if j >= len(lines):
                problems.append((i + 1, "unterminated ``` fence"))
            body = "\n".join(lines[i + 1 : j])
            if lang in FENCE_DIALECTS:
                c, p = extract(body, FENCE_DIALECTS[lang], line_offset=i + 1)
                cmds += c
                problems += p
            elif re.search(r"\baws\s", body):
                problems.append((i + 1, f"```{lang} block contains aws commands but is not a shell/PowerShell fence"))
            i = j + 1
            continue
        if PROSE_COMMAND.search(re.sub(r"`[^`]*`", "", lines[i])):
            problems.append((i + 1, "aws command in README prose outside a code span or fence: not checked"))
        for span in re.finditer(r"`(aws [^`]*)`", lines[i]):
            c, p = extract(span.group(1), "bash", line_offset=i, undefined=False)
            problems += p
            # A span followed by "command(s)" only names an operation ("run the `aws iam attach-group-policy`
            # commands"); every other span is a runnable command and is checked in full.
            names_only = re.match(r"\s+commands?\b", lines[i][span.end() :]) is not None
            for cmd in c:
                cmd.name_only = names_only
            cmds += c
        i += 1
    return cmds, problems


def comments(text: str) -> tuple[list[Command], list[Problem]]:
    """`aws ...` commands quoted in YAML/HCL comments: `# aws ...`, `# Deploy: aws ...`, `(aws ...)`."""
    cmds: list[Command] = []
    problems: list[Problem] = []
    for idx, line in enumerate(text.split("\n")):
        if not line.lstrip().startswith("#"):
            continue
        body = line.lstrip()[1:].strip()
        found = []
        for m in re.finditer(r"(?:^|^Deploy: |\()(aws [^()]+)", body):
            c, p = extract(m.group(1), "bash", line_offset=idx, undefined=False)
            found += c
            problems += p
        if len(found) < len(AWS_LIKE.findall(body)):
            problems.append((idx + 1, f"aws command in comment not recognized by the checker: {body[:80]}"))
        cmds += found
    return cmds, problems


# --- Model checks ---------------------------------------------------------------------------------
class Model:
    def __init__(self) -> None:
        self.session = botocore.session.get_session()
        self.services: dict[str, object] = {}

    def service(self, name: str):
        if name not in self.services:
            try:
                self.services[name] = self.session.get_service_model(SERVICE_ALIASES.get(name, name))
            except Exception:  # noqa: BLE001 - UnknownServiceError and friends
                self.services[name] = None
        return self.services[name]


class BadValue(Exception):
    pass


# `--flag=value` whose value is dynamic: the flag part is literal, so the word is still a flag.
FLAG_EQ = re.compile(r"^--[a-z0-9][a-z0-9-]*=")


def is_flag(w: Word) -> bool:
    return w.value.startswith("--") and (not w.opaque or FLAG_EQ.match(w.value) is not None)


def split_top(s: str, sep: str = ",") -> list[str]:
    """Splits at `sep` outside [...] / {...} brackets."""
    parts, depth, cur = [], 0, []
    for c in s:
        if c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
        if c == sep and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(c)
    parts.append("".join(cur))
    return parts


def convert(value, shape, what: str):
    """Shorthand/CLI string(s) -> the Python type botocore expects for `shape`."""
    t = shape.type_name
    if t == "list":
        items = value if isinstance(value, list) else [value]
        return [convert(v, shape.member, f"{what}[{i}]") for i, v in enumerate(items)]
    if t == "structure":
        if isinstance(value, dict):
            return value
        return parse_shorthand(value, shape, what)
    if t == "map":
        if isinstance(value, dict):
            return value
        return {k: v for k, v in (p.split("=", 1) for p in split_top(value) if "=" in p)}
    if not isinstance(value, str):
        return value
    if t in ("integer", "long"):
        if not re.fullmatch(r"-?\d+", value):
            raise BadValue(f"{what}: '{value}' is not an integer")
        return int(value)
    if t in ("float", "double"):
        try:
            return float(value)
        except ValueError:
            raise BadValue(f"{what}: '{value}' is not a number") from None
    if t == "boolean":
        if value.lower() not in ("true", "false"):
            raise BadValue(f"{what}: '{value}' is not true/false")
        return value.lower() == "true"
    return value


def parse_shorthand(value: str, shape, what: str) -> dict:
    """CLI shorthand for a structure: k=v,k2=[a,b],k3={x=y}."""
    out: dict = {}
    for part in split_top(value):
        if "=" not in part:
            raise BadValue(f"{what}: shorthand '{part}' is not key=value")
        key, val = part.split("=", 1)
        if key not in shape.members:
            raise BadValue(f"{what}: unknown shorthand key '{key}' (members: {', '.join(shape.members)})")
        member = shape.members[key]
        if val.startswith("[") and val.endswith("]"):
            inner = val[1:-1]
            parsed = [v for v in split_top(inner)] if inner else []
        elif val.startswith("{") and val.endswith("}"):
            parsed = val[1:-1]
        elif member.type_name == "list":
            parsed = split_top(val)
        else:
            parsed = val
        out[key] = convert(parsed, member, f"{what}.{key}")
    return out


def check_value(data, shape, what: str) -> list[str]:
    """Structure keys, scalar types and enums of a parsed value."""
    t = shape.type_name
    if t == "structure":
        if not isinstance(data, dict):
            return [f"{what}: expected an object"]
        problems = []
        for k, v in data.items():
            if k not in shape.members:
                problems.append(f"{what}: unknown key '{k}'")
            else:
                problems += check_value(v, shape.members[k], f"{what}.{k}")
        return problems
    if t == "list":
        if not isinstance(data, list):
            return [f"{what}: expected an array"]
        return [p for i, v in enumerate(data) for p in check_value(v, shape.member, f"{what}[{i}]")]
    if t == "string" and isinstance(data, str):
        if getattr(shape, "enum", None) and data not in shape.enum:
            return [f"{what}: '{data}' is not one of {', '.join(shape.enum)}"]
        meta = shape.metadata
        if "max" in meta and len(data) > meta["max"]:
            return [f"{what}: '{data[:40]}' is longer than {meta['max']} characters"]
        if "pattern" in meta and data:
            try:
                rx = re.compile(meta["pattern"])
            except re.error:
                UNCOMPILABLE.add(meta["pattern"])  # Java-only syntax; botocore doesn't check patterns either
                return []
            if not rx.fullmatch(data):
                return [f"{what}: '{data[:40]}' does not match the pattern {meta['pattern']}"]
    return []


def placeholder(shape):
    """A value that satisfies the model, for values only known at run time ("$POLICY_ARN")."""
    t = shape.type_name
    meta = shape.metadata
    if t == "string":
        if getattr(shape, "enum", None):
            return shape.enum[0]
        return "x" * max(1, int(meta.get("min", 1)))
    if t in ("integer", "long"):
        return int(meta.get("min", 1))
    if t in ("float", "double"):
        return float(meta.get("min", 1))
    if t == "boolean":
        return True
    if t == "list":
        return [placeholder(shape.member) for _ in range(max(1, int(meta.get("min", 1))))]
    if t == "structure":
        return {m: placeholder(shape.members[m]) for m in shape.required_members}
    if t == "map":
        return {}
    if t == "timestamp":
        return "2020-01-01T00:00:00Z"
    return "x"


def word_value(w: Word, mshape, base_dir: str | None, what: str):
    """One CLI word -> Python value for a member (or list item)."""
    if w.opaque:
        return placeholder(mshape)
    v = w.value
    for prefix in ("file://", "fileb://"):
        if v.startswith(prefix):
            path = v[len(prefix) :]
            if base_dir is None or os.path.isabs(path):
                return placeholder(mshape)
            full = os.path.join(base_dir, path)
            if not os.path.exists(full):
                raise BadValue(f"{what}: {v} does not exist next to the script")
            with open(full, encoding="utf-8") as f:
                content = f.read()
            return json.loads(content) if mshape.type_name in ("structure", "list", "map") else content
    if mshape.type_name in ("structure", "list", "map") and v.lstrip()[:1] in ("{", "["):
        try:
            return json.loads(v)
        except json.JSONDecodeError as e:
            raise BadValue(f"{what}: invalid JSON ({e.msg})") from None
    return convert(v, mshape, what)


def check_globals(flag: str, vals: list[Word]) -> list[str]:
    if flag == "--output" and vals and not vals[0].opaque and vals[0].value not in OUTPUT_FORMATS:
        return [f"--output: '{vals[0].value}' is not one of {', '.join(sorted(OUTPUT_FORMATS))}"]
    return []


def check_global_arity(flag: str, vals: list[Word]) -> list[str]:
    if GLOBALS[flag] and not vals:
        return [f"{flag} needs a value"]
    if GLOBALS[flag] and len(vals) > 1:
        return [f"{flag} takes one value, got extra '{vals[1].raw}'"]
    if not GLOBALS[flag] and vals:
        return [f"{flag} takes no value (got '{vals[0].raw}')"]
    return []


def split_args(words: list[Word]) -> tuple[list[tuple[str, list[Word]]], list[Word]]:
    """[(flag, values)] (`--flag=value` split), positionals (non-flag words before the first flag)."""
    args: list[tuple[str, list[Word]]] = []
    positionals: list[Word] = []
    for w in words:
        if is_flag(w):
            if "=" in w.value:
                flag, val = w.value.split("=", 1)
                args.append((flag, [Word(val, val, w.opaque)]))
            else:
                args.append((w.value, []))
        elif args:
            args[-1][1].append(w)
        else:
            positionals.append(w)
    return args, positionals


def check_cfn_deploy(args: list[tuple[str, list[Word]]], base_dir: str | None) -> list[str]:
    problems = []
    seen = set()
    for flag, vals in args:
        if flag in GLOBALS:
            problems += check_global_arity(flag, vals) + check_globals(flag, vals)
            continue
        kind = CFN_DEPLOY_FLAGS.get(flag)
        if kind is None:
            problems.append(f"unknown flag {flag} for cloudformation deploy")
            continue
        seen.add(flag)
        if kind == "flag" and vals:
            problems.append(f"{flag} takes no value (got '{vals[0].raw}')")
        if kind in ("value", "list") and not vals:
            problems.append(f"{flag} needs a value")
        if kind == "value" and len(vals) > 1:
            problems.append(f"{flag} takes one value (got {len(vals)})")
        if flag == "--capabilities":
            problems += [
                f"--capabilities: '{v.value}' is not one of {', '.join(sorted(CFN_CAPABILITIES))}"
                for v in vals
                if not v.opaque and v.value not in CFN_CAPABILITIES
            ]
        template_missing = (
            flag == "--template-file"
            and vals
            and not vals[0].opaque
            and base_dir is not None
            and not os.path.exists(os.path.join(base_dir, vals[0].value))
        )
        if template_missing:
            problems.append(f"--template-file: {vals[0].value} does not exist next to the file")
    for req in CFN_DEPLOY_REQUIRED:
        if req not in seen:
            problems.append(f"missing required {req} for cloudformation deploy")
    return problems


def check_command(cmd: Command, model: Model, base_dir: str | None = None) -> list[str]:
    words = cmd.words[1:]  # drop `aws`
    if [w.value for w in words] == ["--version"]:
        return []  # `aws --version` (README: how to check the installed CLI version)
    # Leading globals (aws --region x iam ...) are allowed before the service.
    lead: list[tuple[str, list[Word]]] = []
    while words and is_flag(words[0]):
        flag = words[0].value.split("=", 1)[0]
        if flag not in GLOBALS:
            return [f"unknown global flag {flag}"]
        if "=" in words[0].value:
            val = words[0].value.split("=", 1)[1]
            lead.append((flag, [Word(val, val, False)]))
            words = words[1:]
            continue
        n = 2 if GLOBALS[flag] else 1
        lead.append((flag, words[1:n]))
        words = words[n:]
    if len(words) < 2 or any(w.opaque for w in words[:2]):
        return ["expected `aws <service> <command>`"]
    svc_name, op_cli = words[0].value, words[1].value
    rest = words[2:]
    problems: list[str] = [p for f, v in lead for p in check_global_arity(f, v) + check_globals(f, v)]
    lead_flags = [f for f, _ in lead]
    problems += [f"{f} given twice" for i, f in enumerate(lead_flags) if f in lead_flags[:i]]

    # argparse reads a separate value word starting with "-" as an option and the CLI exits before calling AWS.
    problems += [
        f"value '{w.value}' for {prev.value} starts with '-': pass it as {prev.value}=value"
        for prev, w in zip(rest, rest[1:], strict=False)
        if is_flag(prev) and "=" not in prev.value and not w.opaque and w.value.startswith("-") and not is_flag(w)
    ]

    if svc_name == "configure":
        args, positionals = split_args(rest)
        if op_cli != "get":
            return problems + [f"only `aws configure get` is supported (got configure {op_cli})"]
        if len(positionals) != 1 or positionals[0].opaque or positionals[0].value not in CONFIGURE_GET_NAMES:
            return problems + [f"aws configure get needs one of {', '.join(sorted(CONFIGURE_GET_NAMES))}"]
        for flag, vals in args:
            if flag not in GLOBALS:
                problems.append(f"unknown flag {flag} for aws configure get")
            else:
                problems += check_global_arity(flag, vals) + check_globals(flag, vals)
        return problems

    if svc_name == "cloudformation" and op_cli == "deploy":
        if cmd.name_only:
            return problems
        args, positionals = split_args(rest)
        problems += [f"unexpected argument '{w.raw}'" for w in positionals]
        flags = lead_flags + [f for f, _ in args]
        problems += [f"{f} given twice" for i, f in enumerate(flags) if f in flags[:i] and i >= len(lead_flags)]
        return problems + check_cfn_deploy(args, base_dir)

    service = model.service(svc_name)
    if service is None:
        return problems + [f"unknown service '{svc_name}'"]
    paginated = False
    label = f"{svc_name} {op_cli}"
    if op_cli == "wait":
        if not rest or is_flag(rest[0]):
            return problems + [f"{svc_name} wait needs a waiter name"]
        waiter_cli = rest[0].value
        try:
            waiters = model.session.get_waiter_model(SERVICE_ALIASES.get(svc_name, svc_name))
        except Exception:  # noqa: BLE001
            return problems + [f"service '{svc_name}' has no waiters"]
        names = {xform_name(n, "-"): n for n in waiters.waiter_names}
        if waiter_cli not in names:
            return problems + [f"unknown waiter '{svc_name} wait {waiter_cli}'"]
        op_name = waiters.get_waiter(names[waiter_cli]).operation
        rest = rest[1:]
        label = f"{svc_name} wait {waiter_cli}"
    else:
        ops = {xform_name(n, "-"): n for n in service.operation_names}
        if op_cli not in ops:
            return problems + [f"unknown operation '{svc_name} {op_cli}'"]
        op_name = ops[op_cli]
        try:
            paginated = model.session.get_paginator_model(service.service_name).get_paginator(op_name) is not None
        except Exception:  # noqa: BLE001 - no paginators or not paginated
            paginated = False
    if cmd.name_only:
        return problems

    op = service.operation_model(op_name)
    shape = op.input_shape
    members = {xform_name(m, "-"): m for m in shape.members} if shape else {}
    args, positionals = split_args(rest)
    problems += [f"{label}: unexpected argument '{w.raw}'" for w in positionals]
    params: dict = {}
    seen_flags: set[str] = set(lead_flags)
    for flag, vals in args:
        if flag in seen_flags:
            problems.append(f"{label}: {flag} given twice")
        seen_flags.add(flag)
        if flag in GLOBALS:
            problems += [f"{label}: {p}" for p in check_global_arity(flag, vals) + check_globals(flag, vals)]
            continue
        if paginated and flag in PAGINATION_FLAGS:
            if not vals:
                problems.append(f"{label}: {flag} needs a value")
            continue
        name = flag[2:]
        negated = False
        if name not in members and name.startswith("no-") and name[3:] in members:
            name, negated = name[3:], True
        if name not in members:
            problems.append(f"{label}: unknown flag {flag}")
            continue
        member = members[name]
        mshape = shape.members[member]
        what = f"{label} {flag}"
        if mshape.type_name == "boolean":
            if vals:
                problems.append(f"{what}: boolean flag takes no value (got '{vals[0].raw}'); use {flag} or --no-{name}")
            params[member] = not negated
            continue
        if negated:
            problems.append(f"{label}: --no-{name} is only valid for boolean members ({member} is {mshape.type_name})")
            continue
        if not vals:
            problems.append(f"{what}: needs a value")
            continue
        try:
            if mshape.type_name == "list":
                items: list = []
                for v in vals:
                    if v.opaque:
                        items.append(placeholder(mshape.member))
                        continue
                    parsed = word_value(v, mshape, base_dir, what)
                    if isinstance(parsed, list):
                        items += parsed
                    else:
                        items.append(parsed)
                params[member] = items
            else:
                if len(vals) > 1:
                    problems.append(f"{what}: takes one value, got extra '{vals[1].raw}'")
                params[member] = word_value(vals[0], mshape, base_dir, what)
        except BadValue as e:
            problems.append(str(e))
            continue
        if not any(v.opaque for v in vals):
            problems += check_value(params[member], mshape, what)
    if shape is not None:
        for req in shape.required_members:
            if req not in params and not any(f == f"--{xform_name(req, '-')}" for f, _ in args):
                problems.append(f"{label}: missing required --{xform_name(req, '-')}")
    if not problems and shape is not None:
        report = ParamValidator().validate(params, shape)
        if report.has_errors():
            problems += [f"{label}: botocore: {line.strip()}" for line in report.generate_report().splitlines() if line.strip()]
    return problems


def commands_in_file(path: str) -> tuple[list[Command], list[Problem]]:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    name = os.path.basename(path)
    if name.endswith(".sh"):
        return extract(text, "bash")
    if name.endswith(".ps1"):
        return extract(text, "ps")
    if name.endswith(".md"):
        return markdown(text)
    if name in ("template.yaml", "main.tf"):
        return comments(text)
    return [], []


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_cli.py <dir>", file=sys.stderr)
        return 2
    root = argv[1]
    model = Model()
    problems: list[str] = []
    files = commands = 0
    ops: set[str] = set()
    for dirpath, _, filenames in sorted(os.walk(root)):
        for fn in sorted(filenames):
            if not (fn.endswith((".sh", ".ps1")) or fn in ("README.md", "template.yaml", "main.tf")):
                continue
            path = os.path.join(dirpath, fn)
            cmds, extraction = commands_in_file(path)
            problems += [f"{path}:{line}: {msg}" for line, msg in extraction]
            files += 1
            for cmd in cmds:
                commands += 1
                ops.add(" ".join(w.value for w in cmd.words[1:3]))
                for p in check_command(cmd, model, dirpath):
                    problems.append(f"{path}:{cmd.line}: {p}")
    unchecked = f"{len(UNCOMPILABLE)} model pattern(s) not compilable by Python re (left to botocore, which skips patterns)"
    if problems:
        print("\n".join(problems))
        print(f"\n{len(problems)} problem(s) in {commands} aws commands across {files} files; {unchecked}.", file=sys.stderr)
        return 1
    if commands == 0:
        print(f"No aws commands found under {root}.", file=sys.stderr)
        return 1
    print(f"OK: {commands} aws commands ({len(ops)} distinct operations) in {files} files match the AWS CLI model; {unchecked}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
