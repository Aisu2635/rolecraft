#!/usr/bin/env python3
"""Derives extra Layer-4 inputs from the generated exports (called by check-exports.sh).

derive_exports.py readme-blocks <exports> <out>
    Writes every README ```sh/bash/shell fence to <out>/<case>-<n>.sh (for shellcheck) and every
    ```powershell/pwsh/ps1 fence to <out>/<case>-<n>.ps1 (for the PowerShell checks). Fails on a fence
    in any other language that contains `aws `, and on an unterminated fence.

derive_exports.py github-oidc <case-dir> <out>
    Copies a GitHub-trust case and applies the README's "your account has no OIDC provider yet" path
    mechanically from the generated comments: uncomments aws_iam_openid_connect_provider and adds the
    depends_on the comment names (main.tf); uncomments GitHubOidcProvider and adds the DependsOn the
    comment names (template.yaml). Fails when the expected comment text isn't there.
"""

from __future__ import annotations

import os
import re
import shutil
import sys

SH_FENCES = {"sh", "bash", "shell"}
PS_FENCES = {"powershell", "pwsh", "ps1"}


class DeriveError(Exception):
    pass


def readme_blocks(readme: str) -> list[tuple[str, int, str]]:
    """(kind 'sh'|'ps1', first body line, body) per fence."""
    lines = readme.split("\n")
    out: list[tuple[str, int, str]] = []
    i = 0
    while i < len(lines):
        m = re.match(r"^```(\S*)\s*$", lines[i])
        if not m:
            i += 1
            continue
        lang = m.group(1).lower()
        j = i + 1
        while j < len(lines) and not lines[j].startswith("```"):
            j += 1
        if j >= len(lines):
            raise DeriveError(f"line {i + 1}: unterminated ``` fence")
        body = "\n".join(lines[i + 1 : j])
        if lang in SH_FENCES:
            out.append(("sh", i + 2, body))
        elif lang in PS_FENCES:
            out.append(("ps1", i + 2, body))
        elif re.search(r"\baws\s", body):
            raise DeriveError(f"line {i + 1}: ```{lang} fence contains aws commands but is not a shell/PowerShell fence")
        i = j + 1
    return out


def write_readme_blocks(exports: str, out: str) -> int:
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    count = 0
    for case in sorted(os.listdir(exports)):
        path = os.path.join(exports, case, "README.md")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as f:
            try:
                blocks = readme_blocks(f.read())
            except DeriveError as e:
                raise DeriveError(f"{path}: {e}") from None
        for n, (kind, line, body) in enumerate(blocks, start=1):
            header = f"README.md line {line} of {case}"
            shebang = "#!/usr/bin/env bash\n" if kind == "sh" else ""
            text = f"{shebang}# {header}\n{body}\n"
            with open(os.path.join(out, f"{case}-{n}.{kind}"), "w", encoding="utf-8", newline="\n") as f:
                f.write(text)
            count += 1
    return count


def uncomment(line: str) -> str:
    return line[2:] if line.startswith("# ") else line[1:]


def block_end(lines: list[str], start: int) -> int | None:
    """Index of the `}` closing the top-level block at `start`, skipping heredoc bodies (JSON has `}` lines)."""
    marker = None
    for i in range(start, len(lines)):
        if marker is not None:
            if lines[i].strip() == marker:
                marker = None
            continue
        m = re.search(r"<<-?([A-Za-z_]\w*)$", lines[i])
        if m:
            marker = m.group(1)
        elif lines[i] == "}":
            return i
    return None


def derive_terraform(text: str) -> str:
    lines = text.split("\n")
    hints = [
        m for m in (re.match(r"^# Then also add (depends_on = \[[^\]]+\]) to aws_iam_role\.(\w+)\.$", ln) for ln in lines) if m
    ]
    if not hints:
        raise DeriveError("main.tf: no '# Then also add depends_on = [...] to aws_iam_role.<label>.' comment")
    hint = hints[0]
    start = next((i for i, ln in enumerate(lines) if ln.startswith('# resource "aws_iam_openid_connect_provider" ')), None)
    if start is None:
        raise DeriveError('main.tf: no commented resource "aws_iam_openid_connect_provider" block')
    end = next((i for i in range(start, len(lines)) if lines[i] == "# }"), None)
    if end is None:
        raise DeriveError("main.tf: commented OIDC provider block has no '# }'")
    lines[start : end + 1] = [uncomment(ln) for ln in lines[start : end + 1]]
    role = next((i for i, ln in enumerate(lines) if ln == f'resource "aws_iam_role" "{hint.group(2)}" {{'), None)
    if role is None:
        raise DeriveError(f'main.tf: no resource "aws_iam_role" "{hint.group(2)}"')
    close = block_end(lines, role)
    if close is None:
        raise DeriveError("main.tf: role block is not closed")
    lines[close:close] = ["", f"  {hint.group(1)}"]
    return "\n".join(lines)


def derive_cloudformation(text: str) -> str:
    lines = text.split("\n")
    idx = next(
        (
            i
            for i, ln in enumerate(lines)
            if re.search(r"add this resource and DependsOn: \w+ on \w+:$", ln) and ln.startswith("#")
        ),
        None,
    )
    if idx is None:
        raise DeriveError("template.yaml: no '... add this resource and DependsOn: <X> on <Resource>:' comment")
    m = re.search(r"DependsOn: (\w+) on (\w+):$", lines[idx])
    assert m is not None
    dep, target = m.group(1), m.group(2)
    block: list[str] = []
    for ln in lines[idx + 1 :]:
        if not ln.startswith("#   "):
            break
        block.append(uncomment(ln))
    if not block or block[0] != f"  {dep}:":
        raise DeriveError(f"template.yaml: the commented block after the hint doesn't define {dep}")
    try:
        res = lines.index("Resources:")
        tgt = lines.index(f"  {target}:")
    except ValueError as e:
        raise DeriveError(f"template.yaml: {e}") from None
    if any(ln.startswith("    DependsOn:") for ln in lines[tgt + 1 : tgt + 3]):
        raise DeriveError(f"template.yaml: {target} already has DependsOn")
    lines[tgt + 1 : tgt + 1] = [f"    DependsOn: {dep}"]
    lines[res + 1 : res + 1] = block
    return "\n".join(lines)


def write_github_oidc(case_dir: str, out: str) -> None:
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    for name in ("policy.json", "trust.json"):
        if os.path.exists(os.path.join(case_dir, name)):
            shutil.copy(os.path.join(case_dir, name), out)
    for name, fn in (("main.tf", derive_terraform), ("template.yaml", derive_cloudformation)):
        with open(os.path.join(case_dir, name), encoding="utf-8") as f:
            derived = fn(f.read())
        with open(os.path.join(out, name), "w", encoding="utf-8", newline="\n") as f:
            f.write(derived)


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 4 and argv[1] == "readme-blocks":
            n = write_readme_blocks(argv[2], argv[3])
            if n == 0:
                raise DeriveError(f"no README fences found under {argv[2]}")
            print(f"Wrote {n} README code blocks to {argv[3]}/")
            return 0
        if len(argv) == 4 and argv[1] == "github-oidc":
            write_github_oidc(argv[2], argv[3])
            print(f"Derived {argv[3]}/ from {argv[2]} with the GitHub OIDC provider uncommented")
            return 0
    except DeriveError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
