import { describe, expect, it } from "vitest";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { stringifyPolicy } from "./json";
import { exportTerraform } from "./terraform";
import type { ExportInput } from "./types";

const names = Object.keys(REFERENCE_CASES);
const make = (n: string): ExportInput => (REFERENCE_CASES[n] as () => ExportInput)();
const unescape = (s: string): string => s.replace(/\$\$\{/g, "${").replace(/%%\{/g, "%{");
const heredocs = (c: string): string[] =>
  [...c.matchAll(/<<-ROLECRAFT_JSON\n([\s\S]*?)ROLECRAFT_JSON\n/g)].map((m) => unescape(m[1] as string));

describe("exportTerraform", () => {
  it.each(names)("snapshot: %s", async (n) => {
    const f = exportTerraform(make(n));
    expect(f.filename).toBe("main.tf");
    expect(f.language).toBe("hcl");
    await expect(f.content).toMatchFileSnapshot(`./__snapshots__/${n}/main.tf`);
  });

  it.each(names)("structure: %s", (n) => {
    const input = make(n);
    const c = exportTerraform(input).content;
    expect(c).not.toContain("\r");
    expect(c.endsWith("\n") && !c.endsWith("\n\n")).toBe(true);
    expect(c).toContain('source  = "hashicorp/aws"');
    const expected: string[] = [];
    if (input.result.trust && input.model.trust.kind !== "principal") expected.push(stringifyPolicy(input.result.trust));
    if (input.result.policy) expected.push(stringifyPolicy(input.result.policy));
    expect(heredocs(c)).toStrictEqual(expected);
    const seen = new Set<string>();
    for (const m of c.matchAll(/^resource "(\w+)" "([^"]*)"/gm)) {
      expect(m[2]).toMatch(/^[a-z0-9_]+$/);
      const key = `${m[1] as string}.${m[2] as string}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("escapes template sequences in heredoc JSON", () => {
    const input = make("lambda-api");
    const policy = {
      Version: "2012-10-17" as const,
      Statement: [
        {
          Effect: "Allow" as const,
          Action: ["s3:GetObject"],
          Resource: ["arn:aws:s3:::b/${aws:username}/%{x}/*"],
        },
      ],
    };
    const c = exportTerraform({ ...input, result: { ...input.result, policy } }).content;
    expect(c).toContain("arn:aws:s3:::b/$${aws:username}/%%{x}/*");
    expect(heredocs(c)).toContain(stringifyPolicy(policy));
  });

  it("escapes template sequences in names", () => {
    const input = make("lambda-api");
    const c = exportTerraform({ ...input, model: { ...input.model, name: "a${b}%{c}" } }).content;
    expect(c).toContain('name        = "a$${b}%%{c}"');
    expect(c).toContain('resource "aws_iam_role" "a__b___c_"');
  });

  it("role: managed policy, inline, managed ARNs, instance profile, outputs", () => {
    const ec2 = exportTerraform(make("ec2-ssm")).content;
    expect(ec2).toContain('resource "aws_iam_instance_profile" "ec2_ops"');
    expect(ec2).toContain('resource "aws_iam_role_policy_attachment" "ec2_ops_managed_1"');
    expect(ec2).toContain('policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"');
    expect(ec2).toContain('resource "aws_iam_policy" "ec2_ops_policy"');
    expect(ec2).toContain('resource "aws_iam_role_policy_attachment" "ec2_ops_policy"');
    expect(ec2).toContain('output "role_arn"');
    const lam = exportTerraform(make("lambda-api")).content;
    expect(lam).toContain('resource "aws_iam_role_policy" "lambda_api_inline"');
    expect(lam).not.toContain("aws_iam_policy");
    expect(lam).not.toContain("instance_profile");
  });

  it("github has a commented OIDC provider block", () => {
    const c = exportTerraform(make("github-deploy")).content;
    expect(c).toContain("# Uncomment if your account doesn't have the GitHub OIDC provider yet.");
    expect(c).toContain('# resource "aws_iam_openid_connect_provider" "github" {');
    expect(c).not.toMatch(/^resource "aws_iam_openid_connect_provider"/m);
  });

  it("eks role trust: access entry and policy association", () => {
    const c = exportTerraform(make("eks-kubectl")).content;
    expect(c).toContain('resource "aws_eks_access_entry" "eks_admin_cli_eks_1"');
    expect(c).toContain('cluster_name  = "prod"');
    expect(c).toContain("principal_arn = aws_iam_role.eks_admin_cli.arn");
    expect(c).toContain('policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy"');
    expect(c).toContain('access_scope {\n    type = "cluster"\n  }');
    expect(c).toContain("depends_on = [aws_eks_access_entry.eks_admin_cli_eks_1]");
    expect(c).toContain("API or API_AND_CONFIG_MAP");
    expect(c).not.toContain("aws_caller_identity");
  });

  const eksGrant = (): ExportInput["model"]["grants"] => [
    {
      id: "k",
      service: "eks",
      module: "eks",
      scope: { type: "module" as const, data: { cluster: "prod" } },
      access: { type: "preset" as const, preset: "kubectl" },
    },
  ];

  it("principal user: policy/attachments and eks access entry via caller identity", () => {
    const input = make("s3-group");
    const model = {
      ...input.model,
      trust: { kind: "principal" as const, target: "user" as const, name: "bob" },
      managedPolicyArns: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
      grants: eksGrant(),
    };
    const c = exportTerraform({ ...input, model }).content;
    expect(c).toContain('resource "aws_iam_user_policy_attachment" "analytics_reader_policy"');
    expect(c).toContain('resource "aws_iam_user_policy_attachment" "analytics_reader_managed_1"');
    expect(c).toContain('user       = "bob"');
    expect(c).toContain('data "aws_caller_identity" "current" {}');
    expect(c).toContain('principal_arn = "arn:aws:iam::${data.aws_caller_identity.current.account_id}:user/bob"');
    expect(c).toContain('output "policy_arn"');
    expect(c).not.toContain("aws_iam_role");
    const inline = exportTerraform({ ...input, model: { ...model, policyMode: "inline" } }).content;
    expect(inline).toContain('resource "aws_iam_user_policy" "analytics_reader_inline"');
    expect(inline).not.toContain('output "policy_arn"');
  });

  it("principal user name with template characters stays escaped", () => {
    const input = make("s3-group");
    const model = {
      ...input.model,
      trust: { kind: "principal" as const, target: "user" as const, name: "b${x}" },
      grants: eksGrant(),
    };
    expect(exportTerraform({ ...input, model }).content).toContain(':user/b$${x}"');
  });

  it("s3-group attaches to the group", () => {
    const c = exportTerraform(make("s3-group")).content;
    expect(c).toContain('resource "aws_iam_group_policy_attachment" "analytics_reader_policy"');
    expect(c).toContain('group      = "analytics-team"');
    expect(c).not.toContain("aws_iam_role");
  });

  it("group inline policy", () => {
    const input = make("s3-group");
    const c = exportTerraform({ ...input, model: { ...input.model, policyMode: "inline" } }).content;
    expect(c).toContain('resource "aws_iam_group_policy" "analytics_reader_inline"');
  });

  it("eks under group trust emits a comment only", () => {
    const input = make("s3-group");
    const c = exportTerraform({ ...input, model: { ...input.model, grants: eksGrant() } }).content;
    expect(c).toContain(
      "# kubectl access: EKS access entries can't target IAM groups. Ask the cluster admin to add an access entry for each user, or use a role instead.",
    );
    expect(c).not.toContain("aws_eks");
  });

  it("managed ARNs only (no policy)", () => {
    const input = make("ec2-ssm");
    const c = exportTerraform({ ...input, result: { ...input.result, policy: null } }).content;
    expect(c).not.toContain("aws_iam_policy");
    expect(c).toContain("ec2_ops_managed_1");
    const g = make("s3-group");
    const gc = exportTerraform({ ...g, result: { ...g.result, policy: null } }).content;
    expect(gc).not.toContain("aws_iam_policy");
    expect(gc).not.toContain('output "policy_arn"');
  });

  it("null trust for a role yields a comment-only file", () => {
    const input = make("ec2-ssm");
    const c = exportTerraform({ ...input, result: { ...input.result, trust: null } }).content;
    expect(c).not.toContain("resource ");
    expect(c).toContain("# No trust policy could be generated");
    expect(c.split("\n").every((l) => l === "" || l.startsWith("#"))).toBe(true);
  });

  it("ignores duplicate eks clusters and numbers multiple ones", () => {
    const input = make("eks-kubectl");
    const g = input.model.grants[0]!;
    const g2 = { ...g, id: "z", scope: { type: "module" as const, data: { cluster: "dev" } } };
    const c = exportTerraform({ ...input, model: { ...input.model, grants: [g, { ...g, id: "dup" }, g2] } }).content;
    expect(c.match(/resource "aws_eks_access_entry"/g)).toHaveLength(2);
    expect(c).toContain('"eks_admin_cli_eks_2"');
  });
});
