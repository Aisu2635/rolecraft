import { describe, expect, it } from "vitest";
import { loadRealCatalog } from "../engine/modules/__test__/catalog";
import { explain } from "../explain/explain";
import { generate } from "../generate";
import { createEmptyModel, type Grant, type RoleModel } from "../model/model";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { exportCliBash } from "./cli-bash";
import { exportCliPowerShell } from "./cli-ps";
import { cfnDeleteCommand, cfnDeployCommand, exportCloudFormation } from "./cloudformation";
import { escapeMarkdown, exportReadme } from "./readme";
import { exportTerraform, TF_AWS_PROVIDER_VERSION } from "./terraform";
import type { ExportInput } from "./types";

const names = Object.keys(REFERENCE_CASES);
const make = (n: string): ExportInput => (REFERENCE_CASES[n] as () => ExportInput)();
const readme = (input: ExportInput): string => exportReadme(input).content;

const catalog = loadRealCatalog(["s3", "ec2", "eks"]);
const build = (over: Partial<RoleModel>): ExportInput => {
  const model: RoleModel = { ...createEmptyModel(), ...over };
  return { model, result: generate(model, catalog), summary: explain(model, catalog) };
};
const s3Grant: Grant = {
  id: "g1",
  service: "s3",
  module: "s3",
  scope: { type: "module", data: { bucket: "data-lake", prefixes: ["reports/"] } },
  access: { type: "preset", preset: "list-read" },
};
const eksGrant: Grant = {
  id: "k1",
  service: "eks",
  module: "eks",
  scope: { type: "module", data: { cluster: "prod" } },
  access: { type: "preset", preset: "kubectl" },
};
const SSM = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore";

/** The body of a `## heading` section (up to the next `## `). */
function section(md: string, heading: string): string | undefined {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) return undefined;
  const rest = md.slice(start + heading.length + 5);
  const end = rest.indexOf("\n## ");
  return end < 0 ? rest : rest.slice(0, end);
}
/** The body of a `### heading` subsection. */
function subsection(md: string, heading: string): string | undefined {
  const start = md.indexOf(`\n### ${heading}\n`);
  if (start < 0) return undefined;
  const rest = md.slice(start + heading.length + 6);
  const end = rest.search(/\n##/);
  return end < 0 ? rest : rest.slice(0, end);
}
const CREATE_ONCE =
  "These scripts create resources once; re-running fails with EntityAlreadyExists. Delete the role first or use Terraform/CloudFormation for repeatable deploys.";

describe("exportReadme", () => {
  it.each(names)("snapshot: %s", async (n) => {
    const f = exportReadme(make(n));
    expect(f.filename).toBe("README.md");
    expect(f.language).toBe("markdown");
    await expect(f.content).toMatchFileSnapshot(`./__snapshots__/${n}/README.md`);
  });

  it.each(names)("commands and file names match the generated files: %s", (n) => {
    const input = make(n);
    const md = readme(input);
    const bash = exportCliBash(input).filename;
    const ps = exportCliPowerShell(input).filename;
    expect(subsection(md, "AWS CLI — bash")).toContain(`bash ${bash}`);
    const psText = subsection(md, "AWS CLI — PowerShell") as string;
    expect(psText).toContain(`pwsh -File .\\${ps}`);
    expect(psText).toContain(`powershell -ExecutionPolicy Bypass -File .\\${ps}`);
    expect(psText).toContain(`Unblock-File .\\${ps}`);
    // Never mention the other script name.
    const other = bash === "create-role.sh" ? "attach-policy" : "create-role";
    expect(md).not.toContain(other);
    expect(subsection(md, "Terraform")).toContain("terraform init && terraform apply");
    expect(md).toContain(`Terraform ≥ 1.9`);
    expect(md).toContain(TF_AWS_PROVIDER_VERSION);

    const tpl = exportCloudFormation(input).content;
    const deploy = /^# Deploy: (.*)$/m.exec(tpl);
    const cfn = subsection(md, "CloudFormation") as string;
    if (deploy) {
      expect(deploy[1]).toBe(cfnDeployCommand(input.model));
      expect(cfn).toContain(deploy[1]);
      expect(cfn).toContain(cfnDeleteCommand(input.model));
      expect(tpl).toContain(cfnDeleteCommand(input.model));
    } else {
      expect(cfn).not.toContain("aws cloudformation deploy");
      expect(cfn).toContain("CloudFormation can't create this");
    }

    const tf = exportTerraform(input).content;
    const tfText = subsection(md, "Terraform") as string;
    if (tf.includes('variable "region"')) {
      expect(tfText).toContain("-var region=<region>");
      expect(tfText).toContain("TF_VAR_region");
    } else {
      expect(tfText).not.toContain("TF_VAR_region");
    }
  });

  it.each(names)("sections: %s", (n) => {
    const input = make(n);
    const md = readme(input);
    expect(md.startsWith(`# ${input.model.name}\n`)).toBe(true);
    const principal = input.model.trust.kind === "principal";
    const can = section(md, principal ? "What this policy allows" : "What this role can do") as string;
    for (const c of input.summary.can) expect(can).toContain(`- ${escapeMarkdown(c.text)}`);
    const cannot = section(md, "What it cannot do") as string;
    for (const c of input.summary.cannot) expect(cannot).toContain(`- ${escapeMarkdown(c)}`);
    // No reference case has a warning.
    expect(section(md, "Warnings")).toBeUndefined();
    expect(section(md, "How to apply")).toBeDefined();
    expect(section(md, "Permissions you need to apply this")).toBeDefined();
    expect(md.endsWith("\n")).toBe(true);
    expect(md).not.toMatch(/\n\n\n/);
    expect(md).not.toMatch(/[ \t]$/m);
  });

  it("role cases carry the create-once note verbatim and the role wording", () => {
    for (const n of ["ec2-ssm", "github-deploy", "lambda-api", "cross-account", "eks-kubectl"]) {
      const md = readme(make(n));
      expect(md).toContain(CREATE_ONCE);
      expect(md).toContain("## What this role can do");
    }
  });

  it("principal trust says policy, not role", () => {
    const md = readme(make("s3-group"));
    expect(md).toContain("## What this policy allows");
    expect(md).not.toContain("## What this role can do");
    expect(md).toContain("existing IAM group analytics-team");
    expect(md).toContain(
      "These scripts create resources once; re-running fails with EntityAlreadyExists. Delete the policy first or use Terraform/CloudFormation for repeatable deploys.",
    );
  });

  it("EKS access entries need the API authentication mode", () => {
    for (const n of ["eks-kubectl", "eks-user"]) {
      expect(readme(make(n))).toContain("API or API_AND_CONFIG_MAP");
    }
    for (const n of ["s3-group", "ec2-ssm", "github-deploy", "lambda-api", "cross-account"]) {
      expect(readme(make(n))).not.toContain("API_AND_CONFIG_MAP");
    }
  });

  it("several EKS clusters are named together", () => {
    const md = readme(
      build({ name: "kube", trust: { kind: "service", service: "ec2" }, grants: [eksGrant, { ...eksGrant, id: "k2", scope: { type: "module", data: { cluster: "dev_1" } } }] }),
    );
    expect(md).toContain("**EKS:** The clusters prod and dev_1 must use the authentication mode API or API_AND_CONFIG_MAP");
  });

  it("EKS without a region explains where the scripts and stack run", () => {
    const md = readme(make("eks-kubectl"));
    expect(md).toContain("AWS_REGION");
    expect(subsection(md, "CloudFormation")).toContain("--region <region>");
    const user = readme(make("eks-user"));
    expect(user).toContain("eu-west-1");
    expect(subsection(user, "CloudFormation")).not.toContain("--region <region>");
  });

  it("group with EKS kubectl grants explains access entries can't target groups", () => {
    const md = readme(
      build({ name: "kube-readers", trust: { kind: "principal", target: "group", name: "devs" }, grants: [eksGrant] }),
    );
    expect(md).toContain("EKS access entries can't target IAM groups");
    expect(md).not.toContain("API_AND_CONFIG_MAP");
    expect(md).not.toContain("eks:CreateAccessEntry");
  });

  it("managed-ARN-only principal: CloudFormation can't create it, scripts re-run safely", () => {
    const input = build({
      name: "ssm-users",
      trust: { kind: "principal", target: "group", name: "ops" },
      managedPolicyArns: [SSM],
    });
    expect(input.result.policy).toBeNull();
    const md = readme(input);
    const cfn = subsection(md, "CloudFormation") as string;
    expect(cfn).toContain("CloudFormation can't create this");
    expect(cfn).toContain("AWS CLI script or Terraform");
    expect(cfn).not.toContain("aws cloudformation");
    expect(md).not.toContain("EntityAlreadyExists");
    expect(md).toContain("Re-running these scripts is safe");
    expect(md).not.toContain("policy.json");
    expect(md).toContain(`\`${SSM}\``);
    expect(section(md, "What it cannot do")).toBeUndefined();
    const perms = section(md, "Permissions you need to apply this") as string;
    expect(perms).not.toContain("cloudformation:");
    expect(perms).toContain("iam:AttachGroupPolicy");
    expect(perms).not.toContain("iam:CreatePolicy");
  });

  it("principal with managed ARNs and a generated policy points at the commented commands", () => {
    const md = readme(
      build({
        name: "s3-ops",
        trust: { kind: "principal", target: "group", name: "ops" },
        grants: [s3Grant],
        managedPolicyArns: [SSM],
      }),
    );
    const cfn = subsection(md, "CloudFormation") as string;
    expect(cfn).toContain("aws cloudformation deploy");
    expect(cfn).toContain("commented");
    expect(cfn).toContain("template.yaml");
    expect(cfn).toContain("aws iam attach-group-policy");
  });

  it("inline principal policy: re-running only overwrites, unless an EKS access entry is created", () => {
    const inline = readme(
      build({
        name: "s3-inline",
        policyMode: "inline",
        trust: { kind: "principal", target: "user", name: "bob" },
        grants: [s3Grant],
      }),
    );
    expect(inline).toContain("Re-running these scripts is safe");
    expect(inline).toContain("iam:PutUserPolicy");
    const eks = readme(
      build({
        name: "kube-inline",
        policyMode: "inline",
        trust: { kind: "principal", target: "user", name: "bob" },
        grants: [eksGrant],
      }),
    );
    expect(eks).toContain("re-running fails at the EKS access entry");
    expect(eks).toContain("iam:GetUser");
    expect(eks).toContain("eks:CreateAccessEntry");
  });

  /** The bash cleanup block in the re-run subsection. */
  const cleanup = (md: string): string | undefined => {
    const sub = subsection(md, "Re-running the AWS CLI scripts") ?? "";
    const m = /```sh\n([\s\S]*?)\n```/.exec(sub);
    return m?.[1];
  };
  /** Asserts each needle appears in this order. */
  const inOrder = (text: string, needles: string[]): void => {
    let at = -1;
    for (const n of needles) {
      const i = text.indexOf(n, at + 1);
      expect(i, n).toBeGreaterThan(at);
      at = i;
    }
  };

  it.each(names)("re-run note is shared by both scripts: %s", (n) => {
    const md = readme(make(n));
    const rerun = subsection(md, "Re-running the AWS CLI scripts") as string;
    expect(rerun).toBeDefined();
    expect(subsection(md, "AWS CLI — PowerShell")).not.toMatch(/re-running|Re-running/);
    expect(subsection(md, "AWS CLI — bash")).not.toMatch(/re-running|Re-running/);
  });

  it("role cleanup: every created resource, in an order IAM accepts", () => {
    const ec2 = cleanup(readme(make("ec2-ssm"))) as string;
    inOrder(ec2, [
      "ROLE_NAME='ec2-ops'",
      "ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)",
      'POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${ROLE_NAME}-policy"',
      'aws iam remove-role-from-instance-profile --instance-profile-name "$ROLE_NAME" --role-name "$ROLE_NAME"',
      'aws iam delete-instance-profile --instance-profile-name "$ROLE_NAME"',
      'aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"',
      'aws iam delete-policy --policy-arn "$POLICY_ARN"',
      "aws iam detach-role-policy --role-name \"$ROLE_NAME\" --policy-arn 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'",
      'aws iam delete-role --role-name "$ROLE_NAME"',
    ]);
    const lambda = cleanup(readme(make("lambda-api"))) as string;
    inOrder(lambda, [
      'aws iam delete-role-policy --role-name "$ROLE_NAME" --policy-name "${ROLE_NAME}-inline"',
      'aws iam delete-role --role-name "$ROLE_NAME"',
    ]);
    expect(lambda).not.toContain("delete-policy ");
    expect(lambda).not.toContain("ACCOUNT_ID");
    const eks = cleanup(readme(make("eks-kubectl"))) as string;
    inOrder(eks, [
      'ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)',
      "aws eks delete-access-entry --cluster-name 'prod' --principal-arn \"$ROLE_ARN\"\n",
      'aws iam delete-instance-profile',
      'aws iam delete-role --role-name "$ROLE_NAME"',
    ]);
    const gh = readme(make("github-deploy"));
    expect(cleanup(gh)).not.toContain("open-id-connect");
    expect(subsection(gh, "Re-running the AWS CLI scripts")).toContain("The GitHub OIDC provider stays");
  });

  it("principal user with a managed policy and EKS: access entry, then detach and delete the policy", () => {
    const md = readme(make("eks-user"));
    const rerun = subsection(md, "Re-running the AWS CLI scripts") as string;
    expect(rerun).toContain(
      "These scripts create resources once; re-running fails with EntityAlreadyExists. Delete the policy first or use Terraform/CloudFormation for repeatable deploys.",
    );
    expect(rerun).toContain("DeleteConflict");
    const c = cleanup(md) as string;
    inOrder(c, [
      "ROLE_NAME='deploy-bot-kubectl'",
      "PRINCIPAL_NAME='deploy-bot'",
      'PRINCIPAL_ARN=$(aws iam get-user --user-name "$PRINCIPAL_NAME" --query User.Arn --output text)',
      "aws eks delete-access-entry --cluster-name 'prod' --principal-arn \"$PRINCIPAL_ARN\" --region 'eu-west-1'",
      'aws iam detach-user-policy --user-name "$PRINCIPAL_NAME" --policy-arn "$POLICY_ARN"',
      'aws iam delete-policy --policy-arn "$POLICY_ARN"',
    ]);
    expect(c).not.toContain("delete-user ");
  });

  it("principal group cleanup detaches before deleting", () => {
    const c = cleanup(readme(make("s3-group"))) as string;
    inOrder(c, [
      "PRINCIPAL_NAME='analytics-team'",
      'aws iam detach-group-policy --group-name "$PRINCIPAL_NAME" --policy-arn "$POLICY_ARN"',
      'aws iam delete-policy --policy-arn "$POLICY_ARN"',
    ]);
    expect(c).not.toContain("eks");
  });

  it("re-run-safe scripts get no cleanup block; inline user with EKS only deletes the access entry", () => {
    const safe = readme(
      build({ name: "ssm-users", trust: { kind: "principal", target: "group", name: "ops" }, managedPolicyArns: [SSM] }),
    );
    expect(cleanup(safe)).toBeUndefined();
    const eks = cleanup(
      readme(
        build({
          name: "kube-inline",
          policyMode: "inline",
          trust: { kind: "principal", target: "user", name: "bob" },
          grants: [eksGrant],
        }),
      ),
    ) as string;
    expect(eks).toContain("aws eks delete-access-entry --cluster-name 'prod' --principal-arn \"$PRINCIPAL_ARN\"");
    expect(eks).not.toContain("delete-policy");
    expect(eks).not.toContain("delete-user-policy");
  });

  it("cleanup quotes model values", () => {
    const input = make("eks-kubectl");
    input.model = { ...input.model, name: "x'y", grants: [{ ...eksGrant, scope: { type: "module", data: { cluster: "c$(rm)" } } }] };
    const c = cleanup(readme(input)) as string;
    expect(c).toContain("ROLE_NAME='x'\\''y'");
    expect(c).toContain("--cluster-name 'c$(rm)'");
  });

  it("three ways when CloudFormation can't deploy, four otherwise", () => {
    const arnOnly = readme(
      build({ name: "ssm-users", trust: { kind: "principal", target: "group", name: "ops" }, managedPolicyArns: [SSM] }),
    );
    expect(arnOnly).toContain("Use **one** of the three ways below");
    for (const n of names) expect(readme(make(n))).toContain("Use **one** of the four ways below");
  });

  it("GitHub: OIDC provider caveat and dependency notes", () => {
    const md = readme(make("github-deploy"));
    expect(section(md, "How to apply")).toContain(
      "The scripts create the GitHub OIDC provider if your account doesn't have it; Terraform and CloudFormation only create it if you uncomment or add it",
    );
    expect(subsection(md, "Terraform")).toContain(
      "uncomment the `aws_iam_openid_connect_provider` block in `main.tf` and add `depends_on = [aws_iam_openid_connect_provider.github]` to `aws_iam_role.github_deploy`",
    );
    expect(subsection(md, "CloudFormation")).toContain("and `DependsOn: GitHubOidcProvider` on `Role`");
    expect(readme(make("lambda-api"))).not.toContain("OIDC");
  });

  it("lists the permissions each method needs", () => {
    const perms = (n: string): string => section(readme(make(n)), "Permissions you need to apply this") as string;
    const line = (n: string, label: string): string =>
      perms(n)
        .split("\n")
        .find((l) => l.startsWith(`- **${label}:**`)) as string;

    expect(line("s3-group", "AWS CLI scripts")).toContain("`iam:CreatePolicy`, `iam:AttachGroupPolicy`");
    expect(perms("s3-group")).not.toContain("iam:CreateRole");
    expect(line("s3-group", "Terraform")).toContain("iam:ListAttachedGroupPolicies");

    expect(line("ec2-ssm", "AWS CLI scripts")).toContain("iam:CreateInstanceProfile");
    expect(line("ec2-ssm", "AWS CLI scripts")).toContain("iam:AddRoleToInstanceProfile");
    expect(line("ec2-ssm", "AWS CLI scripts")).toContain("iam:PassRole");
    expect(line("ec2-ssm", "Terraform")).toContain("iam:GetInstanceProfile");

    expect(line("github-deploy", "AWS CLI scripts")).toContain("iam:ListOpenIDConnectProviders");
    expect(line("github-deploy", "AWS CLI scripts")).toContain("iam:CreateOpenIDConnectProvider");
    const OPTIONAL = "(only if you add the GitHub OIDC provider)";
    expect(line("github-deploy", "Terraform")).toContain(
      `\`iam:CreateOpenIDConnectProvider\`, \`iam:GetOpenIDConnectProvider\` ${OPTIONAL}`,
    );
    expect(line("github-deploy", "CloudFormation")).toContain(
      `\`iam:CreateOpenIDConnectProvider\`, \`iam:GetOpenIDConnectProvider\`, \`iam:TagOpenIDConnectProvider\` ${OPTIONAL}`,
    );
    expect(line("github-deploy", "AWS CLI scripts")).not.toContain(OPTIONAL);
    expect(perms("lambda-api")).not.toContain("OpenIDConnect");
    for (const n of ["eks-kubectl", "eks-user"]) expect(line(n, "CloudFormation")).toContain("`eks:TagResource`");
    expect(line("eks-kubectl", "Terraform")).not.toContain("eks:TagResource");
    expect(perms("s3-group")).not.toContain("eks:");
    expect(perms("s3-group")).toContain(
      "plus the matching `Delete*`, `Detach*` and `Remove*` actions and `List*` reads",
    );

    expect(line("lambda-api", "AWS CLI scripts")).toContain("iam:PutRolePolicy");
    expect(line("lambda-api", "AWS CLI scripts")).not.toContain("iam:CreatePolicy");
    expect(line("lambda-api", "Terraform")).toContain("iam:GetRolePolicy");

    expect(line("eks-kubectl", "AWS CLI scripts")).toContain("iam:GetRole`, `eks:CreateAccessEntry`, `eks:AssociateAccessPolicy`");
    expect(line("eks-kubectl", "Terraform")).toContain("eks:ListAssociatedAccessPolicies");
    expect(line("eks-user", "AWS CLI scripts")).toContain("iam:GetUser");

    for (const n of names) {
      const cfn = line(n, "CloudFormation");
      for (const a of ["CreateChangeSet", "ExecuteChangeSet", "DescribeChangeSet", "DescribeStacks", "GetTemplateSummary"]) {
        expect(cfn).toContain(`cloudformation:${a}`);
      }
    }
    expect(line("ec2-ssm", "CloudFormation")).toContain("iam:PassRole");
    expect(line("s3-group", "CloudFormation")).toContain("iam:ListEntitiesForPolicy");
  });

  it("lists warnings, escaped", () => {
    const input = build({
      name: "gh-release",
      accountId: "123456789012",
      trust: { kind: "github", owner: "omhinge", repo: "site", ref: { type: "branch", value: "release/*" } },
      grants: [s3Grant],
    });
    expect(input.result.issues.some((i) => i.severity === "warning")).toBe(true);
    const warnings = section(readme(input), "Warnings") as string;
    expect(warnings).toContain('- The branch pattern "release/\\*" uses a wildcard');
    // Info issues are not warnings.
    expect(readme(make("eks-kubectl"))).not.toContain("aws-auth");
  });

  it("escapes model-derived text", () => {
    const input = make("s3-group");
    input.summary = {
      can: [{ grantId: "g1", text: "Can *read* `x` _y_ [z](http://e) <b> a|b ~c~ &amp; \\ ok\nnext" }],
      cannot: ["# heading", "1. list", "- dash", "+ plus", "> quote"],
    };
    const md = readme(input);
    expect(md).toContain(
      "- Can \\*read\\* \\`x\\` \\_y\\_ \\[z\\](http://e) \\<b\\> a\\|b \\~c\\~ \\&amp; \\\\ ok next\n",
    );
    expect(md).toContain("- \\# heading\n");
    expect(md).toContain("- 1\\. list\n");
    expect(md).toContain("- \\- dash\n");
    expect(md).toContain("- \\+ plus\n");
    expect(md).toContain("- \\> quote\n");
  });

  it("escapeMarkdown trims, and leaves intraword underscores and mid-text + alone", () => {
    expect(escapeMarkdown("  my_app_role  ")).toBe("my_app_role");
    expect(escapeMarkdown("\n Can use a+b\n")).toBe("Can use a+b");
    expect(escapeMarkdown("_lead and trail_")).toBe("\\_lead and trail\\_");
    expect(escapeMarkdown("a _b_ c")).toBe("a \\_b\\_ c");
    // A run of underscores is not intraword at its inner edges, so it stays escaped.
    expect(escapeMarkdown("x__y")).toBe("x\\_\\_y");
    expect(escapeMarkdown("+ list")).toBe("\\+ list");
    expect(escapeMarkdown("  # heading")).toBe("\\# heading");
  });

  it("names with underscores stay readable in the title", () => {
    const input = make("lambda-api");
    input.model = { ...input.model, name: "my_app_role" };
    expect(readme(input).startsWith("# my_app_role\n")).toBe(true);
  });

  it("escapeMarkdown leaves plain text readable", () => {
    expect(escapeMarkdown("Can list and download files in reports/ of data-lake.")).toBe(
      "Can list and download files in reports/ of data-lake.",
    );
    expect(escapeMarkdown("Tom & Jerry (2)")).toBe("Tom & Jerry (2)");
    expect(escapeMarkdown("a\r\n  b")).toBe("a b");
  });

  it("no trust policy: nothing to apply", () => {
    const input = build({
      name: "gh-no-account",
      trust: { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "main" } },
      grants: [s3Grant],
    });
    expect(input.result.trust).toBeNull();
    const md = readme(input);
    expect(section(md, "How to apply")).toContain("Nothing can be applied yet");
    expect(md).not.toContain("terraform apply");
    expect(md).not.toContain("bash create-role.sh");
    expect(section(md, "Permissions you need to apply this")).toBeUndefined();
  });

  it("only managed ARNs on a role: lists them as what the role can do", () => {
    const md = readme(build({ name: "ssm-only", trust: { kind: "service", service: "ec2" }, managedPolicyArns: [SSM] }));
    const can = section(md, "What this role can do") as string;
    expect(can).toContain(`- Everything the managed policy \`${SSM}\` allows.`);
    expect(md).not.toContain("policy.json");
    expect(md).toContain(CREATE_ONCE);
  });

  it("no permissions at all (not exportable): says so instead of an empty list", () => {
    const input = build({ name: "empty", trust: { kind: "service", service: "ec2" } });
    expect(section(readme(input), "What this role can do")).toContain("- Nothing yet.");
  });

  it("falls back to escaped text for a value with a backtick", () => {
    const input = make("ec2-ssm");
    input.model.managedPolicyArns = ["arn:aws:iam::aws:policy/a`b"];
    expect(readme(input)).toContain("- Everything the managed policy arn:aws:iam::aws:policy/a\\`b allows.");
  });

  it("generated policy without an explainer sentence still points at policy.json", () => {
    const input = make("s3-group");
    input.summary = { can: [], cannot: [] };
    expect(section(readme(input), "What this policy allows")).toContain("policy.json");
  });
});
