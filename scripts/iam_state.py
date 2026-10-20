#!/usr/bin/env python3
"""Apply-exports job: dump and compare the IAM state an export left in the emulator (moto).

Usage:
  iam_state.py dump [--eks-log <file>]          normalised JSON on stdout
  iam_state.py diff <base.json> <other.json> [--ignore <path>]...

dump reads every role, user, group, customer managed policy, instance profile and OIDC provider through
boto3 (AWS_ENDPOINT_URL points it at the emulator), with their trust policies, inline policies, attached
policies, group memberships and tags. ARNs lose their account id, and ids and dates are dropped, so two
applies of the same case compare equal. --eks-log adds the access entries the aws stub recorded
(scripts/aws_stub.py). Lists are sorted and keys are sorted, so the output is stable.

diff exits 1, printing a unified diff, if the two dumps differ outside the ignored paths: "key", "key.sub",
or "list[].field" (that field in every item of the list).
"""

from __future__ import annotations

import difflib
import json
import os
import re
import sys
from typing import Any
from urllib.parse import unquote

ACCOUNT_ARN = re.compile(r"^(arn:aws[a-z-]*:[a-z0-9-]+:[a-z0-9-]*:)\d{12}:")


def strip_account(arn: str) -> str:
    """arn:aws:iam::123456789012:role/x -> arn:aws:iam::<account>:role/x (AWS managed ARNs stay)."""
    return ACCOUNT_ARN.sub(r"\1<account>:", arn)


def document(doc: Any) -> Any:
    """A policy document as a dict: boto3 decodes most of them, some come URL-encoded."""
    if isinstance(doc, str):
        return json.loads(unquote(doc))
    return doc


def tags(items: list[dict[str, str]] | None) -> dict[str, str]:
    return {t["Key"]: t["Value"] for t in items or []}


def pages(client: Any, operation: str, key: str, **kwargs: Any) -> list[Any]:
    out: list[Any] = []
    for page in client.get_paginator(operation).paginate(**kwargs):
        out.extend(page[key])
    return out


def inline_policies(client: Any, kind: str, name: str) -> dict[str, Any]:
    cap = kind.capitalize()
    names = pages(client, f"list_{kind}_policies", "PolicyNames", **{f"{cap}Name": name})
    get = getattr(client, f"get_{kind}_policy")
    return {n: document(get(**{f"{cap}Name": name, "PolicyName": n})["PolicyDocument"]) for n in names}


def attached_policies(client: Any, kind: str, name: str) -> list[str]:
    cap = kind.capitalize()
    attached = pages(client, f"list_attached_{kind}_policies", "AttachedPolicies", **{f"{cap}Name": name})
    return sorted(strip_account(p["PolicyArn"]) for p in attached)


def dump(client: Any, eks_log: str | None) -> dict[str, Any]:
    state: dict[str, Any] = {}

    roles = []
    for r in pages(client, "list_roles", "Roles"):
        role = client.get_role(RoleName=r["RoleName"])["Role"]
        boundary = role.get("PermissionsBoundary", {}).get("PermissionsBoundaryArn")
        roles.append(
            {
                "name": role["RoleName"],
                "path": role["Path"],
                "description": role.get("Description"),
                "max_session_duration": role.get("MaxSessionDuration"),
                "permissions_boundary": strip_account(boundary) if boundary else None,
                "tags": tags(role.get("Tags")),
                "trust_policy": document(role["AssumeRolePolicyDocument"]),
                "inline_policies": inline_policies(client, "role", role["RoleName"]),
                "attached_policies": attached_policies(client, "role", role["RoleName"]),
            }
        )
    state["roles"] = sorted(roles, key=lambda x: x["name"])

    users = []
    for u in pages(client, "list_users", "Users"):
        name = u["UserName"]
        groups = pages(client, "list_groups_for_user", "Groups", UserName=name)
        users.append(
            {
                "name": name,
                "path": u["Path"],
                "tags": tags(pages(client, "list_user_tags", "Tags", UserName=name)),
                "groups": sorted(g["GroupName"] for g in groups),
                "inline_policies": inline_policies(client, "user", name),
                "attached_policies": attached_policies(client, "user", name),
            }
        )
    state["users"] = sorted(users, key=lambda x: x["name"])

    groups = []
    for g in pages(client, "list_groups", "Groups"):
        name = g["GroupName"]
        groups.append(
            {
                "name": name,
                "path": g["Path"],
                "inline_policies": inline_policies(client, "group", name),
                "attached_policies": attached_policies(client, "group", name),
            }
        )
    state["groups"] = sorted(groups, key=lambda x: x["name"])

    policies = []
    for p in pages(client, "list_policies", "Policies", Scope="Local"):
        full = client.get_policy(PolicyArn=p["Arn"])["Policy"]
        version = client.get_policy_version(PolicyArn=p["Arn"], VersionId=full["DefaultVersionId"])
        policies.append(
            {
                "name": full["PolicyName"],
                "path": full["Path"],
                "description": full.get("Description"),
                "tags": tags(full.get("Tags")),
                "attachment_count": full.get("AttachmentCount"),
                "document": document(version["PolicyVersion"]["Document"]),
            }
        )
    state["policies"] = sorted(policies, key=lambda x: x["name"])

    profiles = []
    for ip in pages(client, "list_instance_profiles", "InstanceProfiles"):
        profiles.append(
            {
                "name": ip["InstanceProfileName"],
                "path": ip["Path"],
                "roles": sorted(r["RoleName"] for r in ip["Roles"]),
            }
        )
    state["instance_profiles"] = sorted(profiles, key=lambda x: x["name"])

    providers = []
    for p in client.list_open_id_connect_providers()["OpenIDConnectProviderList"]:
        full = client.get_open_id_connect_provider(OpenIDConnectProviderArn=p["Arn"])
        providers.append(
            {
                "url": full["Url"],
                "client_ids": sorted(full.get("ClientIDList", [])),
                "thumbprints": sorted(full.get("ThumbprintList", [])),
            }
        )
    state["oidc_providers"] = sorted(providers, key=lambda x: x["url"])

    if eks_log is not None:
        state["eks_access_entries"] = eks_entries(eks_log)
    return state


def eks_entries(path: str) -> list[dict[str, Any]]:
    """The stub's log (one JSON object per line) as sorted entries with their policy associations."""
    entries: dict[tuple[str, str, str], dict[str, Any]] = {}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                event = json.loads(line)
                key = (event["region"], event["cluster"], strip_account(event["principal"]))
                if key not in entries:
                    entries[key] = {"region": key[0], "cluster": key[1], "principal": key[2]}
                    entries[key].update({"rejected_calls": 0, "create_calls": 0, "policies": []})
                entry = entries[key]
                if event["op"] == "rejected":
                    entry["rejected_calls"] += 1
                elif event["op"] == "create-access-entry":
                    entry["create_calls"] += 1
                else:
                    entry["policies"].append({"policy": event["policy"], "scope": event["scope"]})
    out = list(entries.values())
    for entry in out:
        entry["policies"].sort(key=lambda p: json.dumps(p, sort_keys=True))
    return sorted(out, key=lambda e: (e["region"], e["cluster"], e["principal"]))


def render(state: dict[str, Any]) -> str:
    return json.dumps(state, indent=2, sort_keys=True) + "\n"


def drop_path(state: Any, path: str) -> None:
    """Removes the field at `path` in place: "key", "key.sub", or "list[].field" (that field of every item)."""
    parts = path.split(".")
    if not all(parts) or parts[-1].endswith("[]"):
        raise ValueError(f"bad ignore path {path!r}")
    nodes = [state]
    for part in parts[:-1]:
        found: list[Any] = []
        for node in nodes:
            if not isinstance(node, dict):
                continue
            if part.endswith("[]"):
                items = node.get(part[:-2])
                found.extend(items if isinstance(items, list) else [])
            elif part in node:
                found.append(node[part])
        nodes = found
    for node in nodes:
        if isinstance(node, dict):
            node.pop(parts[-1], None)


def compare(a: Any, b: Any, ignore: list[str], names: tuple[str, str] = ("base", "other")) -> list[str]:
    """Unified diff lines of the two dumps after dropping the ignored paths (empty when they match)."""
    a, b = json.loads(json.dumps(a)), json.loads(json.dumps(b))
    for path in ignore:
        drop_path(a, path)
        drop_path(b, path)
    if a == b:
        return []
    return list(difflib.unified_diff(render(a).splitlines(True), render(b).splitlines(True), *names))


def diff(base: str, other: str, ignore: list[str]) -> int:
    with open(base, encoding="utf-8") as f:
        a = json.load(f)
    with open(other, encoding="utf-8") as f:
        b = json.load(f)
    lines = compare(a, b, ignore, (base, other))
    sys.stdout.writelines(lines)
    return 1 if lines else 0


def main(argv: list[str]) -> int:
    args = argv[1:]
    if args[:1] == ["dump"] and len(args) in (1, 3) and (len(args) == 1 or args[1] == "--eks-log"):
        import boto3  # only the dump needs boto3 (moto[server] installs it)

        client = boto3.client("iam")
        sys.stdout.write(render(dump(client, args[2] if len(args) == 3 else None)))
        return 0
    if args[:1] == ["diff"] and len(args) >= 3 and len(args) % 2 == 1:
        flags = args[3:]
        if all(flag == "--ignore" for flag in flags[0::2]):
            return diff(args[1], args[2], flags[1::2])
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
