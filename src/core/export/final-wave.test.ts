import { describe, expect, it } from "vitest";
import { build, moduleGrant, REFERENCE_CASES } from "./__fixtures__/cases";
import { exportCloudFormation } from "./cloudformation";
import { shortHash } from "./eks";
import { exportReadme } from "./readme";
import { exportTerraform } from "./terraform";
import type { ExportInput } from "./types";

const make = (n: string): ExportInput => (REFERENCE_CASES[n] as () => ExportInput)();
const readme = (input: ExportInput): string => exportReadme(input).content;
const s3 = moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] });
const kubectl = (cluster: string) => moduleGrant(`k-${cluster}`, "eks", "kubectl", { cluster });
const A = "arn:aws:iam::aws:policy/ReadOnlyAccess";
const B = "arn:aws:iam::123456789012:policy/team/ops_policy";
const C = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole";

describe("Terraform managed ARN attachments are labeled by ARN, not position", () => {
  const labels = (arns: string[], trust: ExportInput["model"]["trust"] = { kind: "service", service: "lambda" }) => {
    const c = exportTerraform(build({ name: "app", trust, grants: [s3], managedPolicyArns: arns })).content;
    return Object.fromEntries(
      [...c.matchAll(/resource "aws_iam_(?:role|user|group)_policy_attachment" "(\w+)" \{\n[^}]*?policy_arn = "([^"]+)"/g)]
        .map((m) => [m[2], m[1]]),
    );
  };
  it("labels from the policy name plus a hash of the ARN", () => {
    expect(labels([A, B, C])).toEqual({
      [A]: `app_managed_readonlyaccess_${shortHash(A)}`,
      [B]: `app_managed_ops_policy_${shortHash(B)}`,
      [C]: `app_managed_awslambdabasicexecutionrole_${shortHash(C)}`,
    });
  });
  it("reorder and removal keep every other label", () => {
    const all = labels([A, B, C]);
    expect(labels([C, A, B])).toEqual(all);
    expect(labels([A, C])).toEqual({ [A]: all[A], [C]: all[C] });
  });
  it("same policy name in two accounts gets distinct labels", () => {
    const other = "arn:aws:iam::123456789012:policy/ReadOnlyAccess";
    const l = labels([A, other]);
    expect(l[A]).not.toBe(l[other]);
  });
  it("principal attachments too", () => {
    expect(Object.values(labels([A], { kind: "principal", target: "group", name: "devs" }))).toEqual([
      `app_managed_readonlyaccess_${shortHash(A)}`,
    ]);
  });
});

describe("GitHub trust: credentials' account check", () => {
  it("Terraform: aws_caller_identity + precondition on the role", () => {
    const c = exportTerraform(make("github-deploy")).content;
    expect(c).toContain('data "aws_caller_identity" "current" {}');
    expect(c).toContain(
      '  lifecycle {\n    precondition {\n      condition     = data.aws_caller_identity.current.account_id == "123456789012"\n      error_message = "',
    );
    expect(c.indexOf("lifecycle {")).toBeGreaterThan(c.indexOf('resource "aws_iam_role"'));
    expect(c.indexOf("lifecycle {")).toBeLessThan(c.indexOf('resource "aws_iam_policy"'));
    expect(exportTerraform(make("lambda-api")).content).not.toContain("aws_caller_identity");
  });
  it("CloudFormation: header comment naming the account", () => {
    const c = exportCloudFormation(make("github-deploy")).content;
    const head = c.slice(0, c.indexOf("AWSTemplateFormatVersion"));
    expect(head).toContain("# Deploy this stack in account 123456789012");
    expect(exportCloudFormation(make("lambda-api")).content).not.toContain("Deploy this stack in account");
  });
  it("README: account note and sts:GetCallerIdentity for the scripts and Terraform", () => {
    const md = readme(make("github-deploy"));
    expect(md).toContain("**Account:** The trust policy trusts GitHub through account `123456789012`");
    expect(md).toMatch(/\*\*AWS CLI scripts:\*\* `sts:GetCallerIdentity`/);
    expect(md).toMatch(/\*\*Terraform:\*\* `sts:GetCallerIdentity`/);
    expect(md).not.toMatch(/\*\*CloudFormation:\*\* [^\n]*sts:GetCallerIdentity/);
    expect(readme(make("lambda-api"))).not.toContain("sts:GetCallerIdentity`,");
  });
});

describe("README", () => {
  it("states the minimum AWS CLI v2 version", () => {
    for (const n of Object.keys(REFERENCE_CASES)) {
      expect(readme(make(n))).toContain("AWS CLI v2 (2.15.38 or later; `aws --version` shows it)");
    }
  });
  it("EKS access entries: cluster-wide read-only bullet per cluster (not for groups)", () => {
    const md = readme(build({ name: "r", trust: { kind: "service", service: "ec2" }, grants: [kubectl("prod"), kubectl("stage")] }));
    const can = md.slice(md.indexOf("## What this role can do"), md.indexOf("## How to apply"));
    for (const c of ["prod", "stage"]) {
      expect(can).toContain(
        `- The EKS access entry gives cluster-wide read-only Kubernetes access (AmazonEKSViewPolicy, all namespaces) on cluster ${c}.`,
      );
    }
    expect(readme(make("eks-user"))).toContain("cluster-wide read-only Kubernetes access");
    const group = build({ name: "r", trust: { kind: "principal", target: "group", name: "devs" }, grants: [kubectl("prod")] });
    expect(readme(group)).not.toContain("cluster-wide read-only");
  });
  it("qualifies 'same resources'", () => {
    expect(readme(make("lambda-api"))).toContain("Use **one** of the four ways below: each creates the same resources.");
    expect(readme(make("github-deploy"))).toContain(
      "Use **one** of the four ways below. They create the same resources, except that only the AWS CLI scripts create the GitHub OIDC provider (see below).",
    );
    const principal = build({
      name: "r",
      trust: { kind: "principal", target: "group", name: "devs" },
      grants: [s3],
      managedPolicyArns: [A],
    });
    expect(readme(principal)).toContain(
      "They create the same resources, except that CloudFormation doesn't attach the existing managed policies (run the commented commands in `template.yaml`).",
    );
  });
  it("bash LF line endings note", () => {
    expect(readme(make("lambda-api"))).toContain(
      "Keep its LF line endings: re-saving `create-role.sh` with CRLF line endings (as some Windows editors do) breaks it; on Windows, run it from WSL, Git Bash or AWS CloudShell.",
    );
  });
  it("cleanup: where to run it and NoSuchEntity is fine; --flag=value forms", () => {
    const md = readme(make("eks-kubectl"));
    expect(md).toContain("run these bash commands in order (AWS CloudShell, WSL or Git Bash work;");
    expect(md).toContain(
      "Commands for resources that weren't created fail with NoSuchEntity (ResourceNotFoundException for the EKS access entry); that's fine.",
    );
    expect(md).toContain('aws iam delete-role --role-name="$ROLE_NAME"');
    expect(md).toContain("aws eks delete-access-entry --cluster-name='prod' --principal-arn=\"$ROLE_ARN\"");
    expect(md).not.toMatch(/--(role|user|group|instance-profile|policy|cluster)-name ["']/);
  });
  it("EKS note mentions the region preflight and the retry", () => {
    const md = readme(make("eks-kubectl"));
    expect(md).toContain("They stop before creating anything if no region is configured.");
    expect(md).toContain("so the scripts retry creating the access entry (6 attempts, 10 seconds apart)");
  });
});
