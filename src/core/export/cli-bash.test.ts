import { describe, expect, it } from "vitest";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { exportCliBash } from "./cli-bash";
import { EKS_PROPAGATION_ERROR, EKS_RETRY_FAILED, EKS_RETRY_MESSAGE } from "./eks";
import { stringifyPolicy } from "./json";
import type { ExportInput } from "./types";

const names = Object.keys(REFERENCE_CASES);
const make = (n: string): ExportInput => (REFERENCE_CASES[n] as () => ExportInput)();

describe("exportCliBash", () => {
  it.each(names)("snapshot: %s", async (n) => {
    const f = exportCliBash(make(n));
    const file = make(n).model.trust.kind === "principal" ? "attach-policy.sh" : "create-role.sh";
    expect(f.filename).toBe(file);
    expect(f.language).toBe("bash");
    await expect(f.content).toMatchFileSnapshot(`./__snapshots__/${n}/${file}`);
  });

  it.each(names)("structure: %s", (n) => {
    const input = make(n);
    const c = exportCliBash(input).content;
    expect(c.startsWith("#!/usr/bin/env bash\nset -euo pipefail\n")).toBe(true);
    expect(c).not.toContain("\r");
    expect(c.endsWith("\n") && !c.endsWith("\n\n")).toBe(true);
    if (input.result.policy) {
      expect(c).toContain(`<<'ROLECRAFT_EOF'\n${stringifyPolicy(input.result.policy)}ROLECRAFT_EOF\n`);
    }
    if (input.result.trust && input.model.trust.kind !== "principal") {
      expect(c).toContain(`<<'ROLECRAFT_EOF'\n${stringifyPolicy(input.result.trust)}ROLECRAFT_EOF\n`);
    }
  });

  it("github has the OIDC provider check", () => {
    expect(exportCliBash(make("github-deploy")).content).toContain(
      "aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com",
    );
  });
  it("github OIDC check treats empty or None as absent", () => {
    const c = exportCliBash(make("github-deploy")).content;
    expect(c).toContain("existing=$(aws iam list-open-id-connect-providers --query ");
    expect(c).toContain('if [ -z "$existing" ] || [ "$existing" = "None" ]; then aws iam create-open-id-connect-provider');
    expect(c).not.toContain("grep -q");
  });
  it("ec2 cases create instance profile; others do not", () => {
    for (const n of ["ec2-ssm", "eks-kubectl"]) {
      const c = exportCliBash(make(n)).content;
      expect(c).toContain("create-instance-profile");
      expect(c).toContain("add-role-to-instance-profile");
    }
    expect(exportCliBash(make("lambda-api")).content).not.toContain("instance-profile");
  });
  it("s3-group attaches to the group and creates no role", () => {
    const c = exportCliBash(make("s3-group")).content;
    expect(c).toContain("attach-group-policy");
    expect(c).not.toContain("create-role");
  });
  it("managed ARNs are attached; inline mode uses put-role-policy", () => {
    expect(exportCliBash(make("ec2-ssm")).content).toContain(
      "--policy-arn 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'",
    );
    const c = exportCliBash(make("lambda-api")).content;
    expect(c).toContain("put-role-policy");
    expect(c).not.toContain("create-policy");
  });
  it("eks access entries; region only when set", () => {
    const input = make("eks-kubectl");
    const c = exportCliBash(input).content;
    expect(c).toContain(
      "  if err=$(aws eks create-access-entry --cluster-name='prod' --principal-arn=\"$ROLE_ARN\" 2>&1 >/dev/null); then break; fi\n",
    );
    expect(c).toContain("AmazonEKSViewPolicy --access-scope type=cluster >/dev/null\n");
    const r = exportCliBash({ ...input, model: { ...input.model, region: "eu-west-1" } }).content;
    expect(r).toContain("--cluster-name='prod' --principal-arn=\"$ROLE_ARN\" --region 'eu-west-1' 2>&1 >/dev/null)");
  });
  it("eks retry: only the propagation error is retried, anything else fails at once", () => {
    const c = exportCliBash(make("eks-kubectl")).content;
    const loop = c.slice(c.indexOf("for attempt in"), c.indexOf("done\n") + 5);
    expect(loop).toBe(
      [
        "for attempt in 1 2 3 4 5 6; do",
        "  if err=$(aws eks create-access-entry --cluster-name='prod' --principal-arn=\"$ROLE_ARN\" 2>&1 >/dev/null); then break; fi",
        "  printf '%s\\n' \"$err\" >&2",
        "  # Retry only while EKS rejects the new principal; any other error (no such cluster, access denied) is final.",
        `  if ! grep -qiE '${EKS_PROPAGATION_ERROR}' <<<"$err"; then exit 1; fi`,
        '  if [ "$attempt" -eq 6 ]; then',
        `    echo "${EKS_RETRY_FAILED}." >&2`,
        "    exit 1",
        "  fi",
        `  echo "${EKS_RETRY_MESSAGE} ($attempt/6)." >&2`,
        "  sleep 10",
        "done",
        "",
      ].join("\n"),
    );
    // A permanent error exits non-zero before any retry message or sleep.
    expect(loop.indexOf("then exit 1; fi")).toBeLessThan(loop.indexOf("sleep 10"));
  });
  it("eks under group trust emits a comment, no aws eks calls", () => {
    const input = make("s3-group");
    const model = {
      ...input.model,
      grants: [
        {
          id: "k",
          service: "eks",
          module: "eks",
          scope: { type: "module" as const, data: { cluster: "prod" } },
          access: { type: "preset" as const, preset: "kubectl" },
        },
      ],
    };
    const c = exportCliBash({ ...input, model }).content;
    expect(c).toContain(
      "EKS access entries can't target IAM groups. Ask the cluster admin to add an access entry for each user, or use a role instead.",
    );
    expect(c).not.toContain("aws eks");
  });
  it("ignores malformed or duplicate eks grants", () => {
    const input = make("eks-kubectl");
    const g = input.model.grants[0]!;
    const bad = [
      { ...g, id: "a", scope: { type: "all" as const } },
      { ...g, id: "b", scope: { type: "module" as const, data: null } },
      { ...g, id: "c", scope: { type: "module" as const, data: { cluster: 5 } } },
      { ...g, id: "d", access: { type: "preset" as const, preset: "describe" } },
      { ...g, id: "e", access: { type: "levels" as const, levels: [] } },
      { ...g, id: "f", module: "s3" },
      g,
      { ...g, id: "dup" },
    ];
    const c = exportCliBash({ ...input, model: { ...input.model, grants: bad } }).content;
    expect(c.match(/create-access-entry/g)).toHaveLength(1);
  });
  it("principal user, inline and managed ARNs", () => {
    const input = make("s3-group");
    const base = {
      ...input.model,
      trust: { kind: "principal" as const, target: "user" as const, name: "bob" },
      managedPolicyArns: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
    };
    const inline = exportCliBash({ ...input, model: { ...base, policyMode: "inline" } }).content;
    expect(inline).toContain('put-user-policy --user-name="$PRINCIPAL_NAME"');
    expect(inline).toContain(
      "attach-user-policy --user-name=\"$PRINCIPAL_NAME\" --policy-arn 'arn:aws:iam::aws:policy/ReadOnlyAccess'",
    );
    expect(exportCliBash({ ...input, model: base }).content).toContain(
      'attach-user-policy --user-name="$PRINCIPAL_NAME" --policy-arn="$POLICY_ARN"',
    );
  });
  it("managed ARNs only (no policy)", () => {
    const input = make("ec2-ssm");
    const c = exportCliBash({ ...input, result: { ...input.result, policy: null } }).content;
    expect(c).not.toContain("policy.json");
    expect(c).toContain("attach-role-policy");
    const g = make("s3-group");
    const gc = exportCliBash({ ...g, result: { ...g.result, policy: null } }).content;
    expect(gc).not.toContain("create-policy");
    // Unused variables are shellcheck SC2034 warnings.
    expect(gc).not.toContain("ROLE_NAME");
  });
  it("never throws when trust is null for a role", () => {
    const input = make("ec2-ssm");
    const c = exportCliBash({ ...input, result: { ...input.result, trust: null } }).content;
    expect(c).not.toContain("create-role");
    expect(c).toContain("No trust policy");
    expect(c).toContain("Nothing was created");
    expect(c).not.toContain("ROLE_NAME");
  });
  it("reliability: pager, role wait, quiet output, auth mode note", () => {
    const c = exportCliBash(make("eks-kubectl")).content;
    expect(c.startsWith('#!/usr/bin/env bash\nset -euo pipefail\nexport AWS_PAGER=""\n')).toBe(true);
    expect(c).toContain('aws iam wait role-exists --role-name="$ROLE_NAME"\n');
    expect(c.indexOf("wait role-exists")).toBeLessThan(c.indexOf("create-access-entry"));
    expect(c).toContain("authentication mode must be API or API_AND_CONFIG_MAP");
    for (const cmd of ["iam create-role", "iam create-instance-profile", "eks create-access-entry", "eks associate-access-policy"]) {
      // create-access-entry captures stderr (to tell retryable errors apart) and discards stdout.
      const line = c.split("\n").find((l) => l.replace(/^\s*if (err=\$\()?/, "").startsWith(`aws ${cmd}`));
      expect(line?.replace(/\); then break; fi$/, "").endsWith(" >/dev/null")).toBe(true);
    }
  });
  it("eks for principal user looks up the user's ARN", () => {
    const input = make("s3-group");
    const model = {
      ...input.model,
      region: "eu-west-1",
      trust: { kind: "principal" as const, target: "user" as const, name: "o'brien" },
      grants: [
        {
          id: "k",
          service: "eks",
          module: "eks",
          scope: { type: "module" as const, data: { cluster: "prod" } },
          access: { type: "preset" as const, preset: "kubectl" },
        },
      ],
    };
    const c = exportCliBash({ ...input, model }).content;
    expect(c).toContain(String.raw`PRINCIPAL_NAME='o'\''brien'`);
    expect(c).toContain(
      'PRINCIPAL_ARN=$(aws iam get-user --user-name="$PRINCIPAL_NAME" --query User.Arn --output text)\n',
    );
    expect(c).not.toContain("get-caller-identity");
    expect(c).not.toContain(":user/");
    expect(c).toContain(
      `aws eks create-access-entry --cluster-name='prod' --principal-arn="$PRINCIPAL_ARN" --region 'eu-west-1' 2>&1 >/dev/null)`,
    );
    expect(c).toContain("associate-access-policy");
    expect(c).not.toContain("wait role-exists");
  });
  it("hostile values are never interpolated unquoted", () => {
    const input = make("eks-kubectl");
    const evil = "x'; touch /tmp/pwn; echo '\n$(id)";
    const model = {
      ...input.model,
      name: evil,
      region: evil,
      managedPolicyArns: [evil],
      grants: [{ ...input.model.grants[0]!, scope: { type: "module" as const, data: { cluster: evil } } }],
    };
    const c = exportCliBash({ ...input, model }).content;
    const q = "'x'\\''; touch /tmp/pwn; echo '\\''\n$(id)'";
    expect(c).toContain(`ROLE_NAME=${q}\n`);
    expect(c.replaceAll(q, "Q")).not.toContain("touch");
    expect(c.replaceAll(q, "Q")).not.toContain("$(id)");
  });
});
