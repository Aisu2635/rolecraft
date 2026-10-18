import { exportCliBash } from "./cli-bash";
import { exportCliPowerShell } from "./cli-ps";
import { cfnCanDeploy, cfnDeleteCommand, cfnDeployCommand } from "./cloudformation";
import { EKS_GROUP_COMMENT, EKS_RETRY, eksClusters } from "./eks";
import type { ExportFile } from "./json";
import { TF_AWS_PROVIDER_VERSION, tfNeedsRegion } from "./terraform";
import { githubAccount, shQuote, tfLabel, type ExportInput } from "./types";

/**
 * Model-derived text as literal Markdown on one trimmed line: inline syntax characters are backslash-escaped,
 * as are entity-like `&…;` and anything at the start that would open a block (heading, list, quote) inside a
 * bullet. Intraword `_` (`my_app_role`) can't emphasize in CommonMark, so it stays; plain prose (`.`, `-`, `/`,
 * `+`, parentheses) is left alone so the raw file stays readable.
 */
export function escapeMarkdown(s: string): string {
  return s
    .replace(/\s*[\r\n]+\s*/g, " ")
    .trim()
    .replace(/[\\`*[\]<>|~]/g, "\\$&")
    .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "\\_")
    .replace(/&(?=#?[A-Za-z0-9]+;)/g, "\\&")
    .replace(/^[#+-]/, "\\$&")
    .replace(/^(\d+)([.)])/, "$1\\$2");
}

/** Inline code for validated values (ARNs, regions); anything with a backtick falls back to escaped text. */
const code = (s: string): string => (s.includes("`") ? escapeMarkdown(s) : `\`${s}\``);

const joinAnd = (xs: string[]): string =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1] as string}`;

/**
 * Minimum AWS CLI v2 version: 2.15.3 added EKS access entries (botocore 1.34.3), 2.15.38 made
 * CreateOpenIDConnectProvider's ThumbprintList optional (botocore 1.34.83); older CLIs reject the scripts'
 * commands before calling AWS.
 */
export const MIN_AWS_CLI = "2.15.38";

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
function permissions(s: Shape): Record<"cli" | "terraform" | "cfn" | "tfOidc" | "cfnOidc", string[]> {
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
      cfn.push(...EKS_ACTIONS, "eks:TagResource");
    }
  } else {
    // The scripts and Terraform check the credentials' account against the GitHub trust policy's first.
    if (s.github) {
      cli.push("sts:GetCallerIdentity", "iam:ListOpenIDConnectProviders", "iam:CreateOpenIDConnectProvider");
      tf.push("sts:GetCallerIdentity");
    }
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
      cfn.push(...EKS_ACTIONS, "eks:TagResource");
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
  // Terraform/CloudFormation only create the GitHub OIDC provider when the user uncomments/adds it.
  const oidc = s.github ? ["iam:CreateOpenIDConnectProvider", "iam:GetOpenIDConnectProvider"] : [];
  return {
    cli: uniq(cli),
    terraform: uniq(tf),
    cfn: uniq([...stack, ...cfn]),
    tfOidc: oidc,
    cfnOidc: s.github ? [...oidc, "iam:TagOpenIDConnectProvider"] : [],
  };
}

/** The re-run note for the CLI scripts (without the cleanup commands). */
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

/**
 * Bash commands that delete what the CLI script created, in an order IAM accepts (a policy can't be deleted
 * while attached, a role while it has policies or an instance profile). Null when re-running is already safe.
 */
function cleanupCommands(model: ExportInput["model"], s: Shape): string[] | null {
  if (s.principal && !s.managed && !s.eksEntries) return null;
  const region = model.region ? ` --region ${shQuote(model.region)}` : "";
  const entries = (arnVar: string): string[] =>
    s.clusters.map((c) => `aws eks delete-access-entry --cluster-name=${shQuote(c)} --principal-arn="$${arnVar}"${region}`);
  const vars: string[] = [];
  const steps: string[] = [];
  if (s.managed || !s.principal) vars.push(`ROLE_NAME=${shQuote(model.name)}`);
  if (s.managed) {
    vars.push(
      "ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)",
      'POLICY_ARN="arn:aws:iam::${ACCOUNT_ID}:policy/${ROLE_NAME}-policy"',
    );
  }
  if (s.principal) {
    const k = s.principal;
    const trust = model.trust as Extract<ExportInput["model"]["trust"], { kind: "principal" }>;
    vars.push(`PRINCIPAL_NAME=${shQuote(trust.name)}`);
    if (s.eksEntries) {
      vars.push('PRINCIPAL_ARN=$(aws iam get-user --user-name="$PRINCIPAL_NAME" --query User.Arn --output text)');
      steps.push(...entries("PRINCIPAL_ARN"));
    }
    if (s.managed) {
      steps.push(
        `aws iam detach-${k}-policy --${k}-name="$PRINCIPAL_NAME" --policy-arn="$POLICY_ARN"`,
        'aws iam delete-policy --policy-arn="$POLICY_ARN"',
      );
    }
    return [...vars, ...steps];
  }
  if (s.eksEntries) {
    vars.push('ROLE_ARN=$(aws iam get-role --role-name="$ROLE_NAME" --query Role.Arn --output text)');
    steps.push(...entries("ROLE_ARN"));
  }
  if (s.ec2) {
    steps.push(
      'aws iam remove-role-from-instance-profile --instance-profile-name="$ROLE_NAME" --role-name="$ROLE_NAME"',
      'aws iam delete-instance-profile --instance-profile-name="$ROLE_NAME"',
    );
  }
  if (s.managed) {
    steps.push(
      'aws iam detach-role-policy --role-name="$ROLE_NAME" --policy-arn="$POLICY_ARN"',
      'aws iam delete-policy --policy-arn="$POLICY_ARN"',
    );
  }
  if (s.inline) steps.push('aws iam delete-role-policy --role-name="$ROLE_NAME" --policy-name="${ROLE_NAME}-inline"');
  for (const arn of s.arns) steps.push(`aws iam detach-role-policy --role-name="$ROLE_NAME" --policy-arn ${shQuote(arn)}`);
  steps.push('aws iam delete-role --role-name="$ROLE_NAME"');
  return [...vars, ...steps];
}

const GITHUB_PROVIDER_NOTE = "If your account doesn't have the GitHub OIDC provider yet,";

function howToApply(input: ExportInput, s: Shape): string[] {
  const { model, result } = input;
  const bash = exportCliBash(input).filename;
  const ps = exportCliPowerShell(input).filename;
  const out: string[] = [];
  const p = (...lines: string[]): void => {
    out.push(lines.join(" "), "");
  };
  const block = (lang: string, command: string): void => {
    out.push(`\`\`\`${lang}`, command, "```", "");
  };

  const ways = `Use **one** of the ${s.cfn ? "four" : "three"} ways below`;
  const except = [
    ...(s.github ? ["only the AWS CLI scripts create the GitHub OIDC provider (see below)"] : []),
    ...(s.cfn && s.principal && s.arns.length > 0
      ? [`CloudFormation doesn't attach the existing managed policies (run the commented commands in \`template.yaml\`)`]
      : []),
  ];
  p(except.length > 0 ? `${ways}. They create the same resources, except that ${joinAnd(except)}.` : `${ways}: each creates the same resources.`);
  p(
    `**Prerequisites:** AWS CLI v2 (${MIN_AWS_CLI} or later; \`aws --version\` shows it) configured with credentials for the target account (\`aws sts get-caller-identity\` shows which one).`,
    `Terraform also needs Terraform ≥ 1.9; \`terraform init\` installs the AWS provider (\`${TF_AWS_PROVIDER_VERSION}\`).`,
  );
  if (s.eksEntries) {
    const clusters = s.clusters.map(escapeMarkdown);
    const subject = clusters.length === 1 ? `The cluster ${clusters[0] as string} must` : `The clusters ${joinAnd(clusters)} must`;
    p(
      `**EKS:** ${subject} use the authentication mode API or API_AND_CONFIG_MAP (EKS console → cluster → Access), or creating the access entry fails.`,
      model.region
        ? `The access entries are created in ${code(model.region)}.`
        : "The scripts create the access entries in your AWS CLI default region; set `AWS_REGION` to the cluster's region first if it differs. They stop before creating anything if no region is configured.",
      `EKS can reject a new IAM ${s.principal ? "user" : "role"} for a few seconds, so the scripts retry creating the access entry (${EKS_RETRY.attempts} attempts, ${EKS_RETRY.seconds} seconds apart).`,
    );
  } else if (s.clusters.length > 0) {
    p(`**kubectl access:** ${EKS_GROUP_COMMENT.replace("# kubectl access: ", "")}`);
  }
  if (s.github) {
    p(
      "**GitHub OIDC provider:** The scripts create the GitHub OIDC provider if your account doesn't have it; Terraform and CloudFormation only create it if you uncomment or add it (see below).",
    );
  }
  const account = githubAccount(model);
  if (account) {
    p(
      `**Account:** The trust policy trusts GitHub through account ${code(account)}'s OIDC provider, so apply this with credentials for that account.`,
      "The scripts and Terraform stop before creating anything if the credentials are for another account.",
    );
  }

  const written = [...(result.trust ? ["`trust.json`"] : []), ...(result.policy ? ["`policy.json`"] : [])];
  const writes = written.length > 0 ? ` It writes ${joinAnd(written)} there first.` : "";

  out.push("### AWS CLI — bash", "");
  block("sh", `bash ${bash}`);
  p(
    `Run it in the folder that contains \`${bash}\` (Linux, macOS, WSL or AWS CloudShell).${writes}`,
    `Keep its LF line endings: re-saving \`${bash}\` with CRLF line endings (as some Windows editors do) breaks it; on Windows, run it from WSL, Git Bash or AWS CloudShell.`,
  );

  out.push("### AWS CLI — PowerShell", "");
  block("powershell", `pwsh -File .\\${ps}`);
  p(
    `Run it in the folder that contains \`${ps}\`.${writes}`,
    `In Windows PowerShell 5.1, run \`powershell -ExecutionPolicy Bypass -File .\\${ps}\` instead.`,
    `Windows blocks scripts downloaded from the internet: if you see "is not digitally signed", run \`Unblock-File .\\${ps}\` first.`,
  );

  out.push("### Re-running the AWS CLI scripts", "");
  const cleanup = cleanupCommands(model, s);
  if (!cleanup) {
    p(rerunNote(s));
  } else {
    p(
      rerunNote(s),
      `To start over, run these bash commands in order (AWS CloudShell, WSL or Git Bash work; IAM refuses to delete ${s.principal ? "a policy that is still attached" : "a role that still has policies or an instance profile, or a policy that is still attached"}, with DeleteConflict):`,
    );
    block("sh", cleanup.join("\n"));
    p(`Commands for resources that weren't created fail with NoSuchEntity${s.eksEntries ? " (ResourceNotFoundException for the EKS access entry)" : ""}; that's fine.`);
    if (s.github) p("The GitHub OIDC provider stays: other roles in the account may use it.");
  }

  out.push("### Terraform", "");
  block("sh", "terraform init && terraform apply");
  const tf = ["Run it in the folder that contains `main.tf` (in Windows PowerShell 5.1, which has no `&&`, run the two commands one after the other)."];
  if (tfNeedsRegion(input)) {
    tf.push(
      "`terraform apply` asks for `region`, the AWS region of your EKS cluster(s); pass it with `-var region=<region>` or set `TF_VAR_region` to skip the prompt.",
    );
  }
  if (s.github) {
    tf.push(
      `${GITHUB_PROVIDER_NOTE} uncomment the \`aws_iam_openid_connect_provider\` block in \`main.tf\` and add \`depends_on = [aws_iam_openid_connect_provider.github]\` to \`aws_iam_role.${tfLabel(model.name)}\` first.`,
    );
  }
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
    cfn.push(
      `${GITHUB_PROVIDER_NOTE} add the \`GitHubOidcProvider\` resource described at the top of \`template.yaml\` and \`DependsOn: GitHubOidcProvider\` on \`Role\` first.`,
    );
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
  const optional = (xs: string[]): string => (xs.length > 0 ? `; ${list(xs)} (only if you add the GitHub OIDC provider)` : "");
  const perms = permissions(s);
  return [
    "## Permissions you need to apply this",
    "",
    "The credentials you apply with need these actions (AdministratorAccess has all of them):",
    "",
    `- **AWS CLI scripts:** ${list(perms.cli)}`,
    `- **Terraform:** ${list(perms.terraform)}${optional(perms.tfOidc)}`,
    ...(s.cfn ? [`- **CloudFormation:** ${list(perms.cfn)}${optional(perms.cfnOidc)}`] : []),
    "",
    [
      ...(s.cfn ? [`CloudFormation creates the resources with your credentials, so it needs the ${s.eksEntries ? "IAM and EKS" : "IAM"} actions too.`] : []),
      "Removing the resources later needs these plus the matching `Delete*`, `Detach*` and `Remove*` actions and `List*` reads.",
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
    ...(s.eksEntries
      ? s.clusters.map(
          (c) =>
            `The EKS access entry gives cluster-wide read-only Kubernetes access (AmazonEKSViewPolicy, all namespaces) on cluster ${escapeMarkdown(c)}.`,
        )
      : []),
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
