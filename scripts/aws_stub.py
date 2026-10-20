#!/usr/bin/env python3
"""Apply-exports job: an `aws` stand-in that answers the EKS access-entry commands moto doesn't implement.

The job puts a shim named `aws` first on PATH that runs this file, for both bash and PowerShell, so the
exported scripts call it exactly as they call the real CLI (exit codes, stderr). Every command except
`aws eks ...` is handed to the real CLI ($REAL_AWS) unchanged.

`eks create-access-entry` checks that the principal exists in IAM (as EKS does), then fails its first call
for each region/cluster/principal with the error EKS gives while a new principal propagates, so the
scripts' retry path runs; the next call succeeds. A second create after success fails as EKS does
(ResourceInUseException). `eks associate-access-policy` needs the access entry. Every call is appended to
$EKS_STUB_LOG, which scripts/iam_state.py adds to the dump.

This tests the scripts' retry logic and arguments, not EKS.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

PROPAGATION_ERROR = (
    "An error occurred (InvalidParameterException) when calling the CreateAccessEntry operation: "
    "The specified principalArn is invalid: invalid principal"
)
SERVICE_ERROR_EXIT = 254  # the AWS CLI's exit code for an error returned by the service


def options(args: list[str]) -> dict[str, str]:
    """--name=value and --name value pairs; flags without a value (--no-cli-pager) map to ""."""
    out: dict[str, str] = {}
    i = 0
    while i < len(args):
        arg = args[i]
        if not arg.startswith("--"):
            raise SystemExit(f"aws stub: unexpected argument {arg!r}")
        if "=" in arg:
            name, value = arg[2:].split("=", 1)
        elif i + 1 < len(args) and not args[i + 1].startswith("--"):
            name, value = arg[2:], args[i + 1]
            i += 1
        else:
            name, value = arg[2:], ""
        out[name] = value
        i += 1
    return out


def fail(operation: str, code: str, message: str) -> int:
    print(f"\nAn error occurred ({code}) when calling the {operation} operation: {message}", file=sys.stderr)
    return SERVICE_ERROR_EXIT


def read_log(path: str) -> list[dict[str, str]]:
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f]


def principal_exists(real_aws: str, arn: str) -> bool:
    """arn:aws:iam::<account>:role/<path/>name or user/...: ask IAM (the real CLI, so the emulator) about it."""
    resource = arn.split(":", 5)[5] if arn.count(":") >= 5 else ""
    kind, _, rest = resource.partition("/")
    if kind not in ("role", "user") or not rest:
        return False
    name = rest.rsplit("/", 1)[-1]
    query = f"{kind.capitalize()}.Arn"
    command = [real_aws, "iam", f"get-{kind}", f"--{kind}-name={name}", "--query", query, "--output", "text"]
    found = subprocess.run(command, capture_output=True, text=True, check=False)
    return found.returncode == 0 and found.stdout.strip() == arn


def eks(real_aws: str, args: list[str]) -> int:
    if not args:
        raise SystemExit("aws stub: eks needs a subcommand")
    command, opts = args[0], options(args[1:])
    log_path = os.environ["EKS_STUB_LOG"]
    region = opts.get("region") or os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or ""
    cluster = opts.get("cluster-name", "")
    principal = opts.get("principal-arn", "")
    if not region or not cluster or not principal:
        raise SystemExit(f"aws stub: eks {command} without a region, --cluster-name or --principal-arn: {args}")
    key = {"region": region, "cluster": cluster, "principal": principal}
    events = [e for e in read_log(log_path) if all(e[k] == v for k, v in key.items())]
    created = any(e["op"] == "create-access-entry" for e in events)

    if command == "create-access-entry":
        unknown = set(opts) - {"cluster-name", "principal-arn", "region", "no-cli-pager"}
        if unknown:
            raise SystemExit(f"aws stub: create-access-entry with unexpected options {sorted(unknown)}")
        if created:
            return fail("CreateAccessEntry", "ResourceInUseException", "The access entry already exists.")
        if not principal_exists(real_aws, principal) or not any(e["op"] == "rejected" for e in events):
            event = {"op": "rejected", **key}
            output = PROPAGATION_ERROR
        else:
            event = {"op": "create-access-entry", **key}
            output = ""
    elif command == "associate-access-policy":
        unknown = set(opts) - {"cluster-name", "principal-arn", "region", "no-cli-pager", "policy-arn", "access-scope"}
        if unknown:
            raise SystemExit(f"aws stub: associate-access-policy with unexpected options {sorted(unknown)}")
        if not created:
            return fail("AssociateAccessPolicy", "ResourceNotFoundException", "No access entry for this principal.")
        event = {"op": "associate-access-policy", **key, "policy": opts["policy-arn"], "scope": opts["access-scope"]}
        output = ""
    else:
        raise SystemExit(f"aws stub: unsupported command eks {command}")

    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")
    if output:
        print(f"\n{output}", file=sys.stderr)
        return SERVICE_ERROR_EXIT
    print(json.dumps({"clusterName": cluster, "principalArn": principal}, indent=4))
    return 0


def main(argv: list[str]) -> int:
    real_aws = os.environ["REAL_AWS"]
    if argv[1:2] == ["eks"]:
        return eks(real_aws, argv[2:])
    os.execv(real_aws, [real_aws, *argv[1:]])
    return 1  # not reached


if __name__ == "__main__":
    sys.exit(main(sys.argv))
