#!/usr/bin/env python3
"""Layer-4 check: CloudFormation templates carry exactly the policy JSON that policy.json/trust.json hold.

Usage: check_cfn_yaml.py <dir>

For every template.yaml under <dir> that isn't comment-only (those contain "# Do not deploy this file."),
load it with PyYAML safe_load (YAML 1.1, like CloudFormation's parser) and assert that every embedded
PolicyDocument deep-equals policy.json and every AssumeRolePolicyDocument deep-equals trust.json in the
same directory, types included (a quoted "2012-10-17" must stay a string, true must stay a boolean).
"""

from __future__ import annotations

import json
import os
import sys

import yaml

DO_NOT_DEPLOY = "# Do not deploy this file."


def find_docs(node, key: str, path: str = "") -> list[tuple[str, object]]:
    """All values stored under `key` anywhere in the tree, with their paths."""
    out: list[tuple[str, object]] = []
    if isinstance(node, dict):
        for k, v in node.items():
            p = f"{path}.{k}" if path else str(k)
            if k == key:
                out.append((p, v))
            out += find_docs(v, key, p)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            out += find_docs(v, key, f"{path}[{i}]")
    return out


def strict_equal(a, b) -> bool:
    """Deep equality that also distinguishes bool/int/float/str (Python's 1 == True does not)."""
    if type(a) is not type(b):
        return False
    if isinstance(a, dict):
        return a.keys() == b.keys() and all(strict_equal(a[k], b[k]) for k in a)
    if isinstance(a, list):
        return len(a) == len(b) and all(strict_equal(x, y) for x, y in zip(a, b, strict=True))
    return a == b


def load_json(path: str):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check_dir(dirpath: str) -> tuple[list[str], int]:
    """Problems for dirpath/template.yaml and the number of documents compared."""
    tpl = os.path.join(dirpath, "template.yaml")
    with open(tpl, encoding="utf-8") as f:
        text = f.read()
    if DO_NOT_DEPLOY in text:
        stray = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
        return ([f"{tpl}: comment-only template has non-comment lines: {stray[0]!r}"] if stray else []), 0
    try:
        data = yaml.safe_load(text)
    except yaml.YAMLError as e:
        return [f"{tpl}: PyYAML cannot load it: {e}"], 0
    if not isinstance(data, dict) or not isinstance(data.get("Resources"), dict):
        return [f"{tpl}: no Resources mapping"], 0
    problems: list[str] = []
    compared = 0
    for key, ref_name in (("PolicyDocument", "policy.json"), ("AssumeRolePolicyDocument", "trust.json")):
        ref = load_json(os.path.join(dirpath, ref_name))
        docs = find_docs(data["Resources"], key)
        if ref is None:
            problems += [f"{tpl}: {p} present but there is no {ref_name}" for p, _ in docs]
            continue
        if not docs:
            problems.append(f"{tpl}: no {key} although {ref_name} exists")
        for p, doc in docs:
            compared += 1
            if not strict_equal(doc, ref):
                problems.append(
                    f"{tpl}: {p} differs from {ref_name} after a YAML 1.1 load:\n"
                    f"  yaml: {json.dumps(doc, sort_keys=True, default=repr)}\n  json: {json.dumps(ref, sort_keys=True)}"
                )
    if os.path.exists(os.path.join(dirpath, "trust.json")) and len(find_docs(data["Resources"], "AssumeRolePolicyDocument")) > 1:
        problems.append(f"{tpl}: more than one AssumeRolePolicyDocument")
    return problems, compared


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: check_cfn_yaml.py <dir>", file=sys.stderr)
        return 2
    problems: list[str] = []
    templates = skipped = compared = 0
    for dirpath, _, filenames in sorted(os.walk(argv[1])):
        if "template.yaml" not in filenames:
            continue
        templates += 1
        p, n = check_dir(dirpath)
        problems += p
        compared += n
        if n == 0 and not p:
            skipped += 1
    if problems:
        print("\n".join(problems))
        return 1
    if templates == 0:
        print(f"No template.yaml found under {argv[1]}.", file=sys.stderr)
        return 1
    print(
        f"OK: {compared} policy documents in {templates - skipped} templates match policy.json/trust.json "
        f"({skipped} comment-only skipped)."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
