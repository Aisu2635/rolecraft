#!/usr/bin/env python3
"""Reads `terraform validate -json` on stdin; fails on any error or warning (e.g. deprecated attributes).

Usage: terraform validate -json | check_tf_validate.py <label>
"""

from __future__ import annotations

import json
import sys


def main(argv: list[str]) -> int:
    label = argv[1] if len(argv) > 1 else "main.tf"
    try:
        result = json.load(sys.stdin)
    except ValueError as e:
        print(f"{label}: terraform validate -json printed no JSON ({e})")
        return 1
    for d in result.get("diagnostics", []):
        line = (d.get("range") or {}).get("start", {}).get("line", "?")
        print(f"{label}:{line}: {d.get('severity')}: {d.get('summary')}: {d.get('detail', '')}")
    print(f"valid={result['valid']} errors={result['error_count']} warnings={result['warning_count']}")
    return 0 if result["valid"] and result["error_count"] == 0 and result["warning_count"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
