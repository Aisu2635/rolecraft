#!/usr/bin/env python3
"""Layer-4 check: every generated AWS CLI command matches the AWS CLI service model (botocore).

Usage: check_cli.py <dir>

Walks <dir> recursively and checks every `aws` invocation in command position in
  * *.sh (bash), and in README.md ```sh / ```bash fenced blocks plus `aws ... --flag ...` inline code spans,
  * *.ps1 (PowerShell),
  * `aws ...` commands quoted in template.yaml header comments (the deploy/delete/attach hints).
Heredoc / here-string bodies and comment lines of scripts are skipped.

For each command it asserts: the operation (or waiter) exists, every --flag maps to an input member
(or is a CLI global), boolean members are used as --flag / --no-flag, every flag that needs a value has
one, values have the member's type (integers, enums, JSON or shorthand structures/lists), every
required member is present, and file:// references exist next to the file. Shell variables and
command substitutions are accepted as opaque values. Exit 1 with `file:line: message` per problem.
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


@dataclass
class Word:
    raw: str  # source text of the shell word
    value: str  # unquoted value
    opaque: bool  # contains a variable or command substitution


@dataclass
class Command:
    line: int  # 1-based line of the `aws` word
    words: list[Word] = field(default_factory=list)


# --- Tokenizer ------------------------------------------------------------------------------------
BASH_KEYWORDS = {"if", "then", "else", "elif", "while", "until", "do", "!", "{", "time", "exec"}
PS_KEYWORDS = {"if", "elseif", "while", "-not", "!", "&", "return", "throw"}
PS_SINGLE_QUOTES = "'‘’‚‛"


class Scanner:
    """Finds `aws` commands in command position in one logical source line (continuations joined)."""

    def __init__(self, text: str, dialect: str, line_of):
        self.s = text
        self.ps = dialect == "ps"
        self.line_of = line_of  # offset -> source line number
        self.commands: list[Command] = []

    # Characters that end a word.
    def _stop(self, c: str) -> bool:
        if c.isspace() or c in ";|&<>()":
            return True
        return self.ps and c in "{}"

    def read_word(self, i: int) -> tuple[Word, int]:
        s, n, start = self.s, len(self.s), i
        out: list[str] = []
        opaque = False
        while i < n and not self._stop(s[i]):
            c = s[i]
            if self.ps and c in PS_SINGLE_QUOTES:
                i += 1
                while i < n:
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
                while i < n and s[i] != '"':
                    esc = "`" if self.ps else "\\"
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
                    else:
                        if s[i] == "$" and i + 1 < n and (s[i + 1].isalnum() or s[i + 1] in "_{"):
                            opaque = True
                        out.append(s[i])
                        i += 1
                if i >= n:
                    raise ValueError("unterminated double quote")
                i += 1
            elif c == ("`" if self.ps else "\\") and i + 1 < n:
                out.append(s[i + 1])
                i += 2
            elif c == "$" and i + 1 < n and s[i + 1] == "(":
                j = self.scan(i + 2, ")")
                out.append(s[i:j])
                opaque = True
                i = j
            else:
                if c == "$" and i + 1 < n and (s[i + 1].isalnum() or s[i + 1] in "_{"):
                    opaque = True
                out.append(c)
                i += 1
        raw = s[start:i]
        value = "".join(out)
        if not self.ps and not opaque:
            # Plain bash words are cooked by shlex (posix), the reference tokenizer.
            value = shlex.split(raw, comments=False, posix=True)[0] if raw.strip() else value
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
            if i >= n or s[i] in ";|&<>()" or (self.ps and s[i] in "{}"):
                break
            if s[i] == "#":
                i = n
                break
            w, i = self.read_word(i)
            cmd.words.append(w)
        # `2>&1` / `2> file`: the fd number belongs to the redirection.
        if i < n and s[i] in "<>" and cmd.words and cmd.words[-1].raw.isdigit():
            cmd.words.pop()
        self.commands.append(cmd)
        return i

    def scan(self, i: int, closer: str | None) -> int:
        """Scans a command list until `closer`; returns the index after it."""
        s, n = self.s, len(self.s)
        cmdpos = True
        while i < n:
            c = s[i]
            if c.isspace():
                i += 1
                continue
            if closer and c == closer:
                return i + 1
            if c == "#":
                return n  # comment to end of line
            if c in ";|&":
                while i < n and s[i] in ";|&":
                    i += 1
                cmdpos = True
                continue
            if c in "<>":
                while i < n and s[i] in "<>&":
                    i += 1
                i = self.skip_space(i)
                if i < n and not self._stop(s[i]):
                    _, i = self.read_word(i)
                continue
            if c == "(":
                i = self.scan(i + 1, ")")
                cmdpos = False
                continue
            if c == ")":
                i += 1
                continue
            if self.ps and c in "{}":
                i += 1
                cmdpos = True
                continue
            start = i
            w, j = self.read_word(i)
            if cmdpos and w.raw == "aws":
                i = self.read_command(start)
                cmdpos = False
                continue
            i = j
            if not cmdpos:
                if self.ps and w.raw in ("=", "+="):
                    cmdpos = True  # $Var = aws ...
                continue
            if self.ps:
                if w.raw.lower() in PS_KEYWORDS:
                    continue
                if w.raw.startswith("$"):
                    cmdpos = False  # assignment target; `=` re-enables
                    continue
            elif w.raw in BASH_KEYWORDS or re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w.raw):
                continue  # keyword or VAR=... prefix
            cmdpos = False
        return i


def logical_lines(text: str, dialect: str) -> list[tuple[str, list[int]]]:
    """Source lines with continuations joined, heredoc/here-string bodies and comment lines dropped.

    Returns (logical line, line number of each character) pairs."""
    lines = text.split("\n")
    out: list[tuple[str, list[int]]] = []
    heredoc: str | None = None
    strip_tabs = False
    here_string: str | None = None
    block_comment = False
    buf, nums = "", []
    for idx, line in enumerate(lines, start=1):
        if heredoc is not None:
            if (line.lstrip("\t") if strip_tabs else line) == heredoc:
                heredoc = None
            continue
        if here_string is not None:
            if line.startswith(here_string):
                here_string = None
                # Code may follow the terminator, e.g. `'@)`; nothing to check there in our outputs.
            continue
        if dialect == "ps" and block_comment:
            if "#>" in line:
                block_comment = False
            continue
        stripped = line.strip()
        if not buf and (stripped.startswith("#") or not stripped):
            if dialect == "ps" and stripped.startswith("<#") and "#>" not in stripped:
                block_comment = True
            continue
        cont = "`" if dialect == "ps" else "\\"
        if line.endswith(cont) and not line.endswith(cont * 2):
            piece = line[:-1] + " "
            buf += piece
            nums += [idx] * len(piece)
            continue
        buf += line
        nums += [idx] * len(line)
        out.append((buf, nums))
        if dialect == "bash":
            m = re.search(r"<<(-?)\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\2", buf)
            if m:
                heredoc, strip_tabs = m.group(3), m.group(1) == "-"
        else:
            m = re.search(r"@(['\"])\s*$", buf)
            if m:
                here_string = m.group(1) + "@"
        buf, nums = "", []
    if buf:
        out.append((buf, nums))
    return out


def extract_commands(text: str, dialect: str, line_offset: int = 0) -> list[Command]:
    cmds: list[Command] = []
    for logical, nums in logical_lines(text, dialect):
        sc = Scanner(logical, dialect, lambda off, nums=nums: (nums[min(off, len(nums) - 1)] if nums else 0) + line_offset)
        sc.scan(0, None)
        cmds.extend(sc.commands)
    return cmds


def markdown_commands(text: str) -> list[Command]:
    """```sh / ```bash fenced blocks and `aws ...` inline code spans outside fences."""
    cmds: list[Command] = []
    lines = text.split("\n")
    i = 0
    while i < len(lines):
        m = re.match(r"^```(\w*)\s*$", lines[i])
        if m:
            lang = m.group(1)
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            if lang in ("sh", "bash", "shell"):
                cmds.extend(extract_commands("\n".join(lines[i + 1 : j]), "bash", line_offset=i + 1))
            i = j + 1
            continue
        # Inline spans with flags are runnable commands; bare ones (`aws iam attach-group-policy`) only name one.
        for span in re.finditer(r"`(aws [^`]+ --[^`]*)`", lines[i]):
            cmds.extend(extract_commands(span.group(1), "bash", line_offset=i))
        i += 1
    return cmds


def comment_commands(text: str) -> list[Command]:
    """`aws ...` commands quoted in YAML/HCL comments: `# aws ...`, `# Deploy: aws ...`, `(aws ...)`."""
    cmds: list[Command] = []
    for idx, line in enumerate(text.split("\n")):
        if not line.lstrip().startswith("#"):
            continue
        body = line.lstrip()[1:].strip()
        for m in re.finditer(r"(?:^|^Deploy: |\()(aws [^()]+)", body):
            cmds.extend(extract_commands(m.group(1), "bash", line_offset=idx))
    return cmds


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


def is_flag(w: Word) -> bool:
    return not w.opaque and w.value.startswith("--")


def check_shorthand_or_json(value: str, shape, what: str) -> list[str]:
    """Structure/map/list-of-structure value given as JSON or CLI shorthand (k=v,k2=v2)."""
    v = value.strip()
    if v.startswith("{") or v.startswith("["):
        try:
            data = json.loads(v)
        except json.JSONDecodeError as e:
            return [f"{what}: invalid JSON ({e.msg})"]
        return check_json_value(data, shape, what)
    if shape.type_name not in ("structure", "map"):
        return [f"{what}: expected JSON for {shape.type_name}"]
    problems: list[str] = []
    for part in v.split(","):
        if "=" not in part:
            problems.append(f"{what}: shorthand '{part}' is not key=value")
            continue
        key, val = part.split("=", 1)
        if shape.type_name == "structure":
            if key not in shape.members:
                problems.append(f"{what}: unknown shorthand key '{key}' (members: {', '.join(shape.members)})")
                continue
            problems += check_scalar(val, shape.members[key], f"{what}.{key}")
    if shape.type_name == "structure":
        keys = {p.split("=", 1)[0] for p in v.split(",") if "=" in p}
        for req in shape.required_members:
            if req not in keys:
                problems.append(f"{what}: missing required key '{req}'")
    return problems


def check_json_value(data, shape, what: str) -> list[str]:
    t = shape.type_name
    if t == "structure":
        if not isinstance(data, dict):
            return [f"{what}: expected an object"]
        problems = []
        for k, v in data.items():
            if k not in shape.members:
                problems.append(f"{what}: unknown key '{k}'")
            else:
                problems += check_json_value(v, shape.members[k], f"{what}.{k}")
        for req in shape.required_members:
            if req not in data:
                problems.append(f"{what}: missing required key '{req}'")
        return problems
    if t == "list":
        if not isinstance(data, list):
            return [f"{what}: expected an array"]
        return [p for i, v in enumerate(data) for p in check_json_value(v, shape.member, f"{what}[{i}]")]
    if t == "map":
        return [] if isinstance(data, dict) else [f"{what}: expected an object"]
    if t in ("integer", "long"):
        return [] if isinstance(data, int) and not isinstance(data, bool) else [f"{what}: expected an integer"]
    if t == "boolean":
        return [] if isinstance(data, bool) else [f"{what}: expected true/false"]
    if t == "string":
        if not isinstance(data, str):
            return [f"{what}: expected a string"]
        return check_scalar(data, shape, what)
    return []


def check_scalar(value: str, shape, what: str) -> list[str]:
    t = shape.type_name
    if t in ("integer", "long"):
        return [] if re.fullmatch(r"-?\d+", value) else [f"{what}: '{value}' is not an integer"]
    if t in ("float", "double"):
        return [] if re.fullmatch(r"-?\d+(\.\d+)?", value) else [f"{what}: '{value}' is not a number"]
    if t == "boolean":
        return [] if value.lower() in ("true", "false") else [f"{what}: '{value}' is not true/false"]
    if t == "string" and getattr(shape, "enum", None) and value not in shape.enum:
        return [f"{what}: '{value}' is not one of {', '.join(shape.enum)}"]
    return []


def check_file_ref(value: str, base_dir: str | None, what: str) -> list[str]:
    for prefix in ("file://", "fileb://"):
        if value.startswith(prefix) and base_dir is not None:
            path = value[len(prefix) :]
            if not os.path.isabs(path) and not os.path.exists(os.path.join(base_dir, path)):
                return [f"{what}: {value} does not exist next to the script"]
    return []


def check_globals(flag: str, vals: list[Word]) -> list[str]:
    if flag == "--output" and vals and not vals[0].opaque and vals[0].value not in OUTPUT_FORMATS:
        return [f"--output: '{vals[0].value}' is not one of {', '.join(sorted(OUTPUT_FORMATS))}"]
    return []


def split_args(words: list[Word]) -> tuple[list[tuple[str, list[Word]]], list[Word]]:
    """[(flag, values)], positionals (non-flag words before the first flag)."""
    args: list[tuple[str, list[Word]]] = []
    positionals: list[Word] = []
    for w in words:
        if is_flag(w):
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
            problems += [f"--capabilities: '{v.value}' is not one of {', '.join(sorted(CFN_CAPABILITIES))}"
                         for v in vals if not v.opaque and v.value not in CFN_CAPABILITIES]
        if flag == "--template-file" and vals and not vals[0].opaque and base_dir is not None:
            if not os.path.exists(os.path.join(base_dir, vals[0].value)):
                problems.append(f"--template-file: {vals[0].value} does not exist next to the file")
    for req in CFN_DEPLOY_REQUIRED:
        if req not in seen:
            problems.append(f"missing required {req} for cloudformation deploy")
    return problems


def check_global_arity(flag: str, vals: list[Word]) -> list[str]:
    if GLOBALS[flag] and not vals:
        return [f"{flag} needs a value"]
    if GLOBALS[flag] and len(vals) > 1:
        return [f"{flag} takes one value, got extra '{vals[1].raw}'"]
    if not GLOBALS[flag] and vals:
        return [f"{flag} takes no value (got '{vals[0].raw}')"]
    return []


def check_command(cmd: Command, model: Model, base_dir: str | None = None) -> list[str]:
    words = cmd.words[1:]  # drop `aws`
    # Leading globals (aws --region x iam ...) are allowed before the service.
    lead: list[tuple[str, list[Word]]] = []
    while words and is_flag(words[0]):
        flag = words[0].value
        if flag not in GLOBALS:
            return [f"unknown global flag {flag}"]
        n = 2 if GLOBALS[flag] else 1
        lead.append((flag, words[1:n]))
        words = words[n:]
    if len(words) < 2 or any(w.opaque for w in words[:2]):
        return ["expected `aws <service> <command>`"]
    svc_name, op_cli = words[0].value, words[1].value
    rest = words[2:]
    problems: list[str] = [p for f, v in lead for p in check_global_arity(f, v)]

    if svc_name == "cloudformation" and op_cli == "deploy":
        args, positionals = split_args(rest)
        problems += [f"unexpected argument '{w.raw}'" for w in positionals]
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

    op = service.operation_model(op_name)
    shape = op.input_shape
    members = {xform_name(m, "-"): m for m in shape.members} if shape else {}
    args, positionals = split_args(rest)
    problems += [f"{label}: unexpected argument '{w.raw}'" for w in positionals]
    present: set[str] = set()
    seen_flags: set[str] = set()
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
        present.add(member)
        what = f"{label} {flag}"
        if mshape.type_name == "boolean":
            if vals:
                problems.append(f"{what}: boolean flag takes no value (got '{vals[0].raw}'); use {flag} or --no-{name}")
            continue
        if negated:
            problems.append(f"{label}: --no-{name} is only valid for boolean members ({member} is {mshape.type_name})")
            continue
        if not vals:
            problems.append(f"{what}: needs a value")
            continue
        if mshape.type_name != "list" and len(vals) > 1:
            problems.append(f"{what}: takes one value, got extra '{vals[1].raw}'")
        for v in vals:
            if v.opaque:
                continue
            problems += [f"{p}" for p in check_file_ref(v.value, base_dir, what)]
            if v.value.startswith(("file://", "fileb://")):
                continue
            t = mshape.type_name
            if t in ("structure", "map"):
                problems += check_shorthand_or_json(v.value, mshape, what)
            elif t == "list":
                item = mshape.member
                if v.value.lstrip().startswith("["):
                    problems += check_shorthand_or_json(v.value, mshape, what)
                elif item.type_name in ("structure", "map"):
                    problems += check_shorthand_or_json(v.value, item, what)
                else:
                    problems += check_scalar(v.value, item, what)
            else:
                problems += check_scalar(v.value, mshape, what)
    if shape is not None and "--cli-input-json" not in seen_flags:
        for req in shape.required_members:
            if req not in present:
                problems.append(f"{label}: missing required --{xform_name(req, '-')}")
    return problems


def commands_in_file(path: str) -> list[Command]:
    with open(path, encoding="utf-8") as f:
        text = f.read()
    name = os.path.basename(path)
    if name.endswith(".sh"):
        return extract_commands(text, "bash")
    if name.endswith(".ps1"):
        return extract_commands(text, "ps")
    if name == "README.md":
        return markdown_commands(text)
    if name in ("template.yaml", "main.tf"):
        return comment_commands(text)
    return []


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
            try:
                cmds = commands_in_file(path)
            except ValueError as e:
                problems.append(f"{path}: cannot tokenize: {e}")
                continue
            files += 1
            for cmd in cmds:
                commands += 1
                ops.add(" ".join(w.value for w in cmd.words[1:3]))
                for p in check_command(cmd, model, dirpath):
                    problems.append(f"{path}:{cmd.line}: {p}")
    if problems:
        print("\n".join(problems))
        print(f"\n{len(problems)} problem(s) in {commands} aws commands across {files} files.", file=sys.stderr)
        return 1
    if commands == 0:
        print(f"No aws commands found under {root}.", file=sys.stderr)
        return 1
    print(f"OK: {commands} aws commands ({len(ops)} distinct operations) in {files} files match the AWS CLI model.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
