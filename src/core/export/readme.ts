import { exportCliBash } from "./cli-bash";
import { exportCliPowerShell } from "./cli-ps";
import { cfnCanDeploy, cfnDeleteCommand, cfnDeployCommand } from "./cloudformation";
import { EKS_GROUP_COMMENT, eksClusters } from "./eks";
import type { ExportFile } from "./json";
import { exportTerraform, TF_AWS_PROVIDER_VERSION } from "./terraform";
import type { ExportInput } from "./types";

/**
 * Model-derived text as literal Markdown on one line: inline syntax characters are backslash-escaped, as are
 * entity-like `&…;` and anything at the start that would open a block (heading, list, quote) inside a bullet.
 * Plain prose (`.`, `-`, `/`, parentheses) is left alone so the raw file stays readable.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .replace(/[\\`*_[\]<>|~]/g, "\\$&")
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&")
    .replace(/^[#+-]/, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/** Inline code for validated values (ARNs, regions); anything with a backtick falls back to escaped text. */
const code = (s: string): string => (s.includes("`") ? escapeMarkdown(s) : `\`${s}\``);

const joinAnd = (xs: string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1] as string}`;

const CREATE_ONCE_ROLE =
  "These scripts create resources once; re-running fails with EntityAlreadyExists. Delete the role first or use Terraform/CloudFormation for repeatable deploys.";

/** Which branches the exporters take for this input (they all branch the same way). */
interface Shape {
  principal: "group" | "user" | null;
  /** IAM name fragment for principal actions: Group / User. */
  K: "Group" | "User";
  managed: boolean;
  inline: boolean;
  arns: string[];
  ec2: boolean;
  github: boolean;
  clusters: string[];
  /** EKS access entries are created (role, or principal user). */
  eksEntries: boolean;
  cfn: boolean;
}

function shapeOf(input: ExportInput): Shape {
  const { model, result } = input;
  const trust = model.trust;
  const principal = trust.kind === "principal" ? trust.target : null;
  const clusters = eksClusters(model.grants);
  return {
    principal,
    K: principal === "user" ? "User" : "Group",
    managed: result.policy !== null && model.policyMode !== "inline",
    inline: result.policy !== null && model.policyMode === "inline",
    arns: model.managedPolicyArns,
    ec2: trust.kind === "service" && trust.service === "ec2",
    github: trust.kind === "github",
    clusters,
    eksEntries: clusters.length > 0 && principal !== "group",
    cfn: cfnCanDeploy(input),
  };
}

const EKS_ACTIONS = ["eks:CreateAccessEntry", "eks:DescribeAccessEntry", "eks:AssociateAccessPolicy", "eks:ListAssociatedAccessPolicies"];

/** Actions each method calls (create + the reads it does while applying), in call order. */
function permissions(s: Shape): { cli: string[]; terraform: string[]; cfn: string[] } {
  const cli: string[] = [];
  const tf: string[] = [];
  const cfn: string[] = [];
  if (s.principal) {
    const attach = `iam:Attach${s.K}Policy`;
    const listAttached = `iam:ListAttached${s.K}Policies`;
    if (s.managed) {
      cli.push("iam:CreatePolicy", attach);
      tf.push("iam:CreatePolicy", "iam:GetPolicy", "iam:GetPolicyVersion", attach, listAttached);
      cfn.push("iam:CreatePolicy", attach, "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListEntitiesForPolicy");
    }
    if (s.inline) {
      cli.push(`iam:Put${s.K}Policy`);
      tf.push(`iam:Put${s.K}Policy`, `iam:Get${s.K}Policy`);
      cfn.push(`iam:Put${s.K}Policy`, `iam:Get${s.K}Policy`);
    }
    if (s.arns.length > 0) {
      cli.push(attach);
      tf.push(attach, listAttached);
      // Run by hand from the commented commands in template.yaml.
      cfn.push(attach);
    }
    if (s.eksEntries) {
      cli.push("iam:GetUser", "eks:CreateAccessEntry", "eks:AssociateAccessPolicy");
      tf.push("iam:GetUser", ...EKS_ACTIONS);
      cfn.push(...EKS_ACTIONS);
    }
  } else {
    if (s.github) cli.push("iam:ListOpenIDConnectProviders", "iam:CreateOpenIDConnectProvider");
    cli.push("iam:CreateRole");
    const roleReads = ["iam:GetRole", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies"];
    tf.push("iam:CreateRole", ...roleReads);
    cfn.push("iam:CreateRole", ...roleReads);
    if (s.managed) {
      cli.push("iam:CreatePolicy", "iam:AttachRolePolicy");
      tf.push("iam:CreatePolicy", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:AttachRolePolicy");
      cfn.push("iam:CreatePolicy", "iam:GetPolicy", "iam:GetPolicyVersion", "iam:ListEntitiesForPolicy", "iam:AttachRolePolicy");
    }
    if (s.inline) {
      cli.push("iam:PutRolePolicy");
      tf.push("iam:PutRolePolicy", "iam:GetRolePolicy");
      cfn.push("iam:PutRolePolicy", "iam:GetRolePolicy");
    }
    if (s.arns.length > 0) {
      cli.push("iam:AttachRolePolicy");
      tf.push("iam:AttachRolePolicy");
      cfn.push("iam:AttachRolePolicy");
    }
    if (s.ec2) {
      const profile = ["iam:CreateInstanceProfile", "iam:AddRoleToInstanceProfile", "iam:PassRole"];
      cli.push(...profile);
      tf.push(...profile, "iam:GetInstanceProfile");
      cfn.push(...profile, "iam:GetInstanceProfile");
    }
    if (s.eksEntries) {
      cli.push("iam:GetRole", "eks:CreateAccessEntry", "eks:AssociateAccessPolicy");
      tf.push(...EKS_ACTIONS);
      cfn.push(...EKS_ACTIONS);
    }
  }
  const stack = [
    "cloudformation:DescribeStacks",
    "cloudformation:CreateChangeSet",
    "cloudformation:DescribeChangeSet",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:GetTemplateSummary",
  ];
  const uniq = (xs: string[]): string[] => [...new Set(xs)];
  return { cli: uniq(cli), terraform: uniq(tf), cfn: uniq([...stack, ...cfn]) };
}

/** The re-run note for the CLI scripts. */
function rerunNote(s: Shape): string {
  if (!s.principal) return CREATE_ONCE_ROLE;
  const alternatives = s.cfn ? "Terraform/CloudFormation" : "Terraform";
  if (s.managed) {
    return `These scripts create resources once; re-running fails with EntityAlreadyExists. Delete the policy first or use ${alternatives} for repeatable deploys.`;
  }
  if (s.eksEntries) {
    return `These scripts create resources once; re-running fails at the EKS access entry, which already exists. Delete the access entry first or use ${alternatives} for repeatable deploys.`;
  }
  const parts = [
    ...(s.inline ? ["they overwrite the inline policy"] : []),
    ...(s.arns.length > 0 ? ["attaching an already attached policy changes nothing"] : []),
  ];
  return `Re-running these scripts is safe: ${parts.join(" and ")}.`;
}

const GITHUB_PROVIDER_NOTE = "If your account doesn't have the GitHub OIDC provider yet,";

function howToApply(input: ExportInput, s: Shape): string[] {
  const { model, result } = input;
  const bash = exportCliBash(input).filename;
  const ps = exportCliPowerShell(input).filename;
  const tfAsksRegion = exportTerraform(input).content.includes('variable "region"');
  const out: string[] = [];
  const p = (...lines: string[]): void => {
    out.push(lines.join(" "), "");
  };
  const block = (lang: string, command: string): void => {
    out.push(`\`\`\`${lang}`, command, "```", "");
  };

  p("Use **one** of the four ways below: each creates the same resources.");
  p(
    "**Prerequisites:** AWS CLI v2 configured with credentials for the target account (`aws sts get-caller-identity` shows which one).",
    `Terraform also needs Terraform ≥ 1.9; \`terraform init\` installs the AWS provider (\`${TF_AWS_PROVIDER_VERSION}\`).`,
  );
  if (s.eksEntries) {
    const clusters = s.clusters.map(escapeMarkdown);
    const subject = clusters.length === 1 ? `The cluster ${clusters[0] as string} must` : `The clusters ${joinAnd(clusters)} must`;
    p(
      `**EKS:** ${subject} use the authentication mode API or API_AND_CONFIG_MAP (EKS console → cluster → Access), or creating the access entry fails.`,
      model.region
        ? `The access entries are created in ${code(model.region)}.`
        : "The scripts create the access entries in your AWS CLI default region; set `AWS_REGION` to the cluster's region first if it differs.",
    );
  } else if (s.clusters.length > 0) {
    p(`**kubectl access:** ${EKS_GROUP_COMMENT.replace("# kubectl access: ", "")}`);
  }

  const written = [...(result.trust ? ["`trust.json`"] : []), ...(result.policy ? ["`policy.json`"] : [])];
  const writes = written.length > 0 ? ` It writes ${joinAnd(written)} there first.` : "";

  out.push("### AWS CLI — bash", "");
  block("sh", `bash ${bash}`);
  p(`Run it in the folder that contains \`${bash}\` (Linux, macOS, WSL or AWS CloudShell).${writes}`);

  out.push("### AWS CLI — PowerShell", "");
  block("powershell", `pwsh -File .\\${ps}`);
  p(
    `Run it in the folder that contains \`${ps}\`.${writes}`,
    `In Windows PowerShell 5.1, run \`powershell -ExecutionPolicy Bypass -File .\\${ps}\` instead.`,
    `Windows blocks scripts downloaded from the internet: if you see "is not digitally signed", run \`Unblock-File .\\${ps}\` first.`,
  );
  p(rerunNote(s));

  out.push("### Terraform", "");
  block("sh", "terraform init && terraform apply");
  const tf = ["Run it in the folder that contains `main.tf` (in Windows PowerShell 5.1, which has no `&&`, run the two commands one after the other)."];
  if (tfAsksRegion) {
    tf.push(
      "`terraform apply` asks for `region`, the AWS region of your EKS cluster(s); pass it with `-var region=<region>` or set `TF_VAR_region` to skip the prompt.",
    );
  }
  if (s.github) tf.push(`${GITHUB_PROVIDER_NOTE} uncomment the \`aws_iam_openid_connect_provider\` block in \`main.tf\` first.`);
  tf.push("Keep the `terraform.tfstate` file it writes: Terraform needs it to change or remove these resources later.");
  p(...tf);

  out.push("### CloudFormation", "");
  // Only a principal's template can be comment-only here (a role without trust never reaches this).
  if (!s.cfn) {
    p(
      `CloudFormation can't create this: it can't attach existing managed policies to an existing IAM ${s.principal as string}.`,
      "Use the AWS CLI script or Terraform instead.",
    );
    return out;
  }
  block("sh", cfnDeployCommand(model));
  const cfn: string[] = [];
  if (s.eksEntries && !model.region) {
    cfn.push("Deploy it in the region of your EKS cluster(s): add `--region <region>` to these commands.");
  }
  if (s.eksEntries) {
    cfn.push(
      `If the EKS access entry fails, read the comments above it in \`template.yaml\` (IAM propagation delay${s.principal ? ", users with an IAM path" : ""}).`,
    );
  }
  if (s.github) {
    cfn.push(`${GITHUB_PROVIDER_NOTE} add the \`GitHubOidcProvider\` resource described at the top of \`template.yaml\` first.`);
  }
  cfn.push(
    "Running the same command again updates the stack.",
    `If the first deploy fails, delete the stack before deploying again: \`${cfnDeleteCommand(model)}\`.`,
  );
  if (s.principal && s.arns.length > 0) {
    cfn.push(
      `CloudFormation can't attach existing managed policies to an existing IAM ${s.principal}: after deploying, run the commented \`aws iam attach-${s.principal}-policy\` commands at the top of \`template.yaml\`.`,
    );
  }
  p(...cfn);
  return out;
}

function permissionsSection(s: Shape): string[] {
  const list = (xs: string[]): string => xs.map((x) => `\`${x}\``).join(", ");
  const perms = permissions(s);
  return [
    "## Permissions you need to apply this",
    "",
    "The credentials you apply with need these actions (AdministratorAccess has all of them):",
    "",
    `- **AWS CLI scripts:** ${list(perms.cli)}`,
    `- **Terraform:** ${list(perms.terraform)}`,
    ...(s.cfn ? [`- **CloudFormation:** ${list(perms.cfn)}`] : []),
    "",
    [
      ...(s.cfn ? [`CloudFormation creates the resources with your credentials, so it needs the ${s.eksEntries ? "IAM and EKS" : "IAM"} actions too.`] : []),
      "Removing the resources later needs the matching `Delete*`, `Detach*` and `Remove*` actions.",
    ].join(" "),
  ];
}

/** README.md: what the role (or policy) allows, warnings, how to apply each format and the permissions that takes. */
export function exportReadme(input: ExportInput): ExportFile {
  const { model, result, summary } = input;
  const s = shapeOf(input);
  const trust = model.trust;
  const lines: string[] = [`# ${escapeMarkdown(model.name)}`, ""];
  const rolecraft = "[RoleCraft](https://rolecraft.omhinge.cloud)";
  lines.push(
    trust.kind === "principal"
      ? `A permissions policy for the existing IAM ${trust.target} ${escapeMarkdown(trust.name)}, generated by ${rolecraft}.`
      : `An IAM role generated by ${rolecraft}.`,
    "",
  );

  const can = [
    ...summary.can.map((c) => escapeMarkdown(c.text)),
    ...(summary.can.length === 0 && result.policy ? ["See `policy.json` for the exact permissions."] : []),
    ...model.managedPolicyArns.map((arn) => `Everything the managed policy ${code(arn)} allows.`),
  ];
  if (can.length === 0) can.push("Nothing yet.");
  lines.push(s.principal ? "## What this policy allows" : "## What this role can do", "", ...can.map((c) => `- ${c}`), "");
  if (summary.cannot.length > 0) {
    lines.push("## What it cannot do", "", ...summary.cannot.map((c) => `- ${escapeMarkdown(c)}`), "");
  }
  const warnings = result.issues.filter((i) => i.severity === "warning");
  if (warnings.length > 0) {
    lines.push("## Warnings", "", ...warnings.map((w) => `- ${escapeMarkdown(w.message)}`), "");
  }

  lines.push("## How to apply", "");
  if (!s.principal && !result.trust) {
    lines.push("Nothing can be applied yet: no trust policy could be generated. Fix the issues in RoleCraft and export again.");
  } else {
    lines.push(...howToApply(input, s), ...permissionsSection(s));
  }
  return { filename: "README.md", language: "markdown", content: lines.join("\n").replace(/\n+$/, "") + "\n" };
}
