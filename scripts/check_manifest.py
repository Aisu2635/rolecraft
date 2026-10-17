#!/usr/bin/env python3
"""Layer-4 check: each case directory holds exactly the files exportAll returned, and they form a full set.

Usage: check_manifest.py <exports dir>   (reads <exports dir>/manifest.json written by export-fixtures.ts)

Per case: the directory listing equals the manifest's file list (nothing missing, nothing extra), and the
set is coherent: README.md, main.tf and template.yaml; one bash and one PowerShell script with the same
stem (create-role for a role, attach-policy for a group/user); trust.json only next to create-role; no
other files besides policy.json.
"""

from __future__ import annotations

import json
import os
import sys

SCRIPT_STEMS = ("create-role", "attach-policy")
ALWAYS = {"README.md", "main.tf", "template.yaml"}


def coherence(files: set[str]) -> list[str]:
    problems = [f"missing {name}" for name in sorted(ALWAYS - files)]
    stems = [s for s in SCRIPT_STEMS if f"{s}.sh" in files or f"{s}.ps1" in files]
    if len(stems) != 1:
        problems.append(f"expected one of {', '.join(f'{s}.sh/.ps1' for s in SCRIPT_STEMS)}, found {stems or 'none'}")
    for stem in stems:
        for ext in (".sh", ".ps1"):
            if f"{stem}{ext}" not in files:
                problems.append(f"missing {stem}{ext}")
    if "trust.json" in files and stems != ["create-role"]:
        problems.append("trust.json without create-role scripts")
    known = ALWAYS | {"policy.json", "trust.json"} | {f"{s}{e}" for s in SCRIPT_STEMS for e in (".sh", ".ps1")}
    problems += [f"unexpected file {name}" for name in sorted(files - known)]
    return problems


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_manifest.py <exports dir>", file=sys.stderr)
        return 2
    root = argv[1]
    try:
        with open(os.path.join(root, "manifest.json"), encoding="utf-8") as f:
            cases: dict[str, list[str]] = json.load(f)["cases"]
    except (OSError, ValueError, KeyError) as e:
        print(f"{root}/manifest.json: {e}")
        return 1
    problems: list[str] = []
    dirs = {d for d in os.listdir(root) if os.path.isdir(os.path.join(root, d))}
    problems += [f"{root}/{d}: directory not in manifest.json" for d in sorted(dirs - cases.keys())]
    problems += [f"{root}/{c}: case in manifest.json has no directory" for c in sorted(cases.keys() - dirs)]
    files_total = 0
    for case in sorted(cases.keys() & dirs):
        expected = set(cases[case])
        actual = set(os.listdir(os.path.join(root, case)))
        files_total += len(actual)
        problems += [f"{root}/{case}: missing {name}" for name in sorted(expected - actual)]
        problems += [f"{root}/{case}: {name} not returned by exportAll" for name in sorted(actual - expected)]
        problems += [f"{root}/{case}: {p}" for p in coherence(expected)]
    if not cases:
        problems.append(f"{root}/manifest.json lists no cases")
    if problems:
        print("\n".join(problems))
        return 1
    print(f"OK: {len(cases)} case directories hold exactly the {files_total} files exportAll returned.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
