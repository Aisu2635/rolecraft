import { describe, expect, it } from "vitest";
import { build, moduleGrant } from "./__fixtures__/cases";
import { exportCliBash } from "./cli-bash";
import { exportCliPowerShell } from "./cli-ps";
import { EKS_PROPAGATION_ERROR } from "./eks";
import type { ExportInput } from "./types";

// Test-only inputs: IAM allows names starting with "-", which the AWS CLI's argparse reads as an option.
const s3 = moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] });
const kubectl = moduleGrant("g2", "eks", "kubectl", { cluster: "prod" });
const dashRole = (): ExportInput => build({ name: "-lead-role", trust: { kind: "service", service: "ec2" }, grants: [s3, kubectl] });
const dashUser = (): ExportInput =>
  build({ name: "-bot-policy", trust: { kind: "principal", target: "user", name: "-bot" }, grants: [s3, kubectl] });
const github = (): ExportInput =>
  build({
    name: "gh",
    accountId: "123456789012",
    trust: { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "main" } },
    grants: [s3],
  });

/** Every word in the aws command lines that is a name/ARN flag followed by a separate value word. */
function separateNameValues(content: string): string[] {
  const re = /--(?:role-name|policy-name|instance-profile-name|user-name|group-name|cluster-name|principal-arn)\s/g;
  return content
    .split("\n")
    .filter((l) => /^\s*(\S+ ?= ?\$\(|\$\w+ = |if |for |)aws /.test(l.trimStart()) || /\baws (iam|eks) /.test(l))
    .flatMap((l) => l.match(re) ?? []);
}

describe("names starting with '-' reach the AWS CLI as --flag=value", () => {
  it("bash role: every name flag uses --flag=\"$VAR\"", () => {
    const c = exportCliBash(dashRole()).content;
    expect(c).toContain("ROLE_NAME='-lead-role'\n");
    expect(separateNameValues(c)).toEqual([]);
    expect(c).toContain('aws iam create-role --role-name="$ROLE_NAME" ');
    expect(c).toContain('aws iam create-policy --policy-name="${ROLE_NAME}-policy" ');
    expect(c).toContain('aws iam attach-role-policy --role-name="$ROLE_NAME" --policy-arn="$POLICY_ARN"');
    expect(c).toContain('aws iam create-instance-profile --instance-profile-name="$ROLE_NAME"');
    expect(c).toContain('aws iam add-role-to-instance-profile --instance-profile-name="$ROLE_NAME" --role-name="$ROLE_NAME"');
    expect(c).toContain('aws iam wait role-exists --role-name="$ROLE_NAME"');
    expect(c).toContain("aws eks create-access-entry --cluster-name='prod' --principal-arn=\"$ROLE_ARN\"");
  });
  it("bash user: --user-name=\"$PRINCIPAL_NAME\"", () => {
    const c = exportCliBash(dashUser()).content;
    expect(c).toContain("PRINCIPAL_NAME='-bot'\n");
    expect(separateNameValues(c)).toEqual([]);
    expect(c).toContain('aws iam attach-user-policy --user-name="$PRINCIPAL_NAME" --policy-arn="$POLICY_ARN"');
    expect(c).toContain('aws iam get-user --user-name="$PRINCIPAL_NAME" ');
  });
  it("PowerShell role: every name flag is one quoted token", () => {
    const c = exportCliPowerShell(dashRole()).content;
    expect(c).toContain("$RoleName = '-lead-role'\n");
    expect(separateNameValues(c)).toEqual([]);
    expect(c).toContain('aws iam create-role "--role-name=$RoleName" ');
    expect(c).toContain('aws iam create-policy "--policy-name=${RoleName}-policy" ');
    expect(c).toContain('aws iam attach-role-policy "--role-name=$RoleName" "--policy-arn=$PolicyArn"');
    expect(c).toContain('aws iam add-role-to-instance-profile "--instance-profile-name=$RoleName" "--role-name=$RoleName"');
    expect(c).toContain("aws eks create-access-entry '--cluster-name=prod' \"--principal-arn=$RoleArn\"");
  });
  it("PowerShell user: \"--user-name=$PrincipalName\"", () => {
    const c = exportCliPowerShell(dashUser()).content;
    expect(separateNameValues(c)).toEqual([]);
    expect(c).toContain('aws iam attach-user-policy "--user-name=$PrincipalName" "--policy-arn=$PolicyArn"');
    expect(c).toContain('aws iam get-user "--user-name=$PrincipalName" ');
  });
});

describe("EKS access entry retry", () => {
  it("bash retries create-access-entry 6 times, 10 s apart, then fails; associates after", () => {
    for (const c of [exportCliBash(dashRole()).content, exportCliBash(dashUser()).content]) {
      expect(c).toContain("for attempt in 1 2 3 4 5 6; do\n  if err=$(aws eks create-access-entry ");
      expect(c).toContain(`  if ! grep -qiE '${EKS_PROPAGATION_ERROR}' <<<"$err"; then exit 1; fi\n`);
      expect(c).toContain('  if [ "$attempt" -eq 6 ]; then\n');
      expect(c).toContain("  sleep 10\ndone\naws eks associate-access-policy ");
      expect(c).toContain("    exit 1\n");
    }
  });
  it("PowerShell retries with $LASTEXITCODE and throws after 6 attempts", () => {
    for (const c of [exportCliPowerShell(dashRole()).content, exportCliPowerShell(dashUser()).content]) {
      expect(c).toContain("for ($Attempt = 1; ; $Attempt++) {\n  $EksError = & {\n");
      expect(c).toContain("    aws eks create-access-entry ");
      expect(c).toContain("  if ($LASTEXITCODE -eq 0) { break }\n");
      expect(c).toContain(`  if ("$EksError" -notmatch '${EKS_PROPAGATION_ERROR}') { throw "aws failed: create-access-entry. $EksError" }\n`);
      expect(c).toContain("  if ($Attempt -ge 6) { throw \"aws failed: create-access-entry.");
      expect(c).toContain("  Start-Sleep -Seconds 10\n}\naws eks associate-access-policy ");
    }
  });
});

describe("preflight before creating anything", () => {
  it("EKS without a region: region check first (bash and PowerShell)", () => {
    for (const input of [dashRole(), dashUser()]) {
      const sh = exportCliBash(input).content;
      expect(sh).toContain(
        'if [ -z "${AWS_REGION:-}" ] && [ -z "${AWS_DEFAULT_REGION:-}" ] && [ -z "$(aws configure get region || true)" ]; then',
      );
      expect(sh.indexOf("aws configure get region")).toBeLessThan(sh.indexOf("aws iam "));
      const ps = exportCliPowerShell(input).content;
      expect(ps).toContain("if (-not $env:AWS_REGION -and -not $env:AWS_DEFAULT_REGION) {\n  $ConfiguredRegion = aws configure get region\n");
      expect(ps.indexOf("aws configure get region")).toBeLessThan(ps.indexOf("aws iam "));
    }
  });
  it("no region check when the model has a region or no EKS", () => {
    const withRegion = dashRole();
    withRegion.model = { ...withRegion.model, region: "eu-west-1" };
    for (const input of [withRegion, github()]) {
      expect(exportCliBash(input).content).not.toContain("configure get");
      expect(exportCliPowerShell(input).content).not.toContain("configure get");
    }
  });
  it("GitHub trust: account check before anything is created", () => {
    const sh = exportCliBash(github()).content;
    expect(sh).toContain("CALLER_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)\nif [ \"$CALLER_ACCOUNT\" != '123456789012' ]; then\n");
    expect(sh.indexOf("get-caller-identity")).toBeLessThan(sh.indexOf("aws iam "));
    const ps = exportCliPowerShell(github()).content;
    expect(ps).toContain("$CallerAccount = aws sts get-caller-identity --query Account --output text --no-cli-pager\n");
    expect(ps).toContain("if ($CallerAccount -ne '123456789012') { throw ");
    expect(ps.indexOf("get-caller-identity")).toBeLessThan(ps.indexOf("aws iam "));
    for (const input of [dashRole(), dashUser()]) {
      expect(exportCliBash(input).content).not.toContain("get-caller-identity");
      expect(exportCliPowerShell(input).content).not.toContain("get-caller-identity");
    }
  });
});
