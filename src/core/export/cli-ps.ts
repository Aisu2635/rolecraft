import { EKS_COMMENTS, EKS_GROUP_COMMENT, EKS_PROPAGATION_ERROR, EKS_RETRY, EKS_RETRY_FAILED, EKS_RETRY_MESSAGE, EKS_VIEW_POLICY, NO_REGION_MESSAGE, eksClusters } from "./eks";
import { stringifyPolicy, type ExportFile } from "./json";
import { accountMismatch, githubAccount, psQuote, TAG, type ExportInput } from "./types";

// Every flag whose value comes from a name is one token "--flag=$Var" (or '--flag=literal'): IAM names may
// start with "-", which the AWS CLI's argument parser would read as an option if the value were a separate
// argument. A quoted token reaches aws.exe as one argument in Windows PowerShell 5.1 and PowerShell 7.

const check = (step: string, indent = ""): string => `${indent}if ($LASTEXITCODE -ne 0) { throw "aws failed: ${step}" }`;

/** One aws call (or captured assignment) followed by its exit-code check. */
function aws(step: string, command: string): string[] {
  return [command.replace(/( \| Out-Null)?$/, " --no-cli-pager$1"), check(step)];
}

/** Escape every char above 0x7E as \uXXXX (surrogate pairs become two escapes): keeps the .ps1 pure ASCII. */
function asciiJson(s: string): string {
  return s.replace(/[\u007f-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

/** Same description as Terraform's and CloudFormation's managed policy (scripts/apply-exports.sh compares them). */
const CREATE_POLICY =
  `$PolicyArn = aws iam create-policy "--policy-name=\${RoleName}-policy" --policy-document file://policy.json --description ${psQuote(TAG)} --query Policy.Arn --output text`;

const GITHUB_OIDC_CHECK = [
  `$existing = aws iam list-open-id-connect-providers --query "OpenIDConnectProviderList[?ends_with(Arn, '/token.actions.githubusercontent.com')].Arn" --output text --no-cli-pager`,
  check("list-open-id-connect-providers"),
  "if (-not $existing -or $existing -eq 'None') {",
  "  aws iam create-open-id-connect-provider --url https://token.actions.githubusercontent.com --client-id-list sts.amazonaws.com --no-cli-pager | Out-Null",
  check("create-open-id-connect-provider", "  "),
  "}",
];

/**
 * Single-quoted here-string written as UTF-8 without BOM. `body` ends with a newline and never has a
 * line starting with '@ (stringifyPolicy output starts lines with {, } or spaces), so the terminator is safe.
 */
function jsonFile(file: string, body: string): string[] {
  return [`[System.IO.File]::WriteAllText((Join-Path $PWD.ProviderPath '${file}'), @'`, `${asciiJson(body)}'@)`];
}

/** Checks that run before anything is created: credentials' account (GitHub trust) and a region for EKS. */
function preflight(input: ExportInput, eksEntries: boolean): string[] {
  const { model } = input;
  const out: string[] = [];
  const account = githubAccount(model);
  if (account && input.result.trust) {
    out.push(
      `# Stop before creating anything if these credentials aren't for account ${account} (the trust policy's account).`,
      ...aws("get-caller-identity", "$CallerAccount = aws sts get-caller-identity --query Account --output text"),
      `if ($CallerAccount -ne '${account}') { throw "${accountMismatch(account, "$CallerAccount")}" }`,
      "",
    );
  }
  if (eksEntries && !model.region) {
    out.push(
      "# The EKS steps need a region: stop before creating anything if none is configured.",
      "if (-not $env:AWS_REGION -and -not $env:AWS_DEFAULT_REGION) {",
      // Exit code 1 just means "not set": the output is what's checked.
      "  $ConfiguredRegion = aws configure get region",
      `  if (-not $ConfiguredRegion) { throw "${NO_REGION_MESSAGE}" }`,
      "}",
      "",
    );
  }
  return out;
}

function eksSteps(clusters: string[], arnVar: string, regionName: string | undefined): string[] {
  const region = regionName ? ` --region ${psQuote(regionName)}` : "";
  const { attempts, seconds } = EKS_RETRY;
  return clusters.flatMap((c) => {
    const cluster = `${psQuote(`--cluster-name=${c}`)} "--principal-arn=$${arnVar}"`;
    return [
      "for ($Attempt = 1; ; $Attempt++) {",
      // Scoped to the script block: stderr text and a non-zero exit must not stop the script here.
      "  $EksError = & {",
      "    $ErrorActionPreference = 'Continue'",
      "    $PSNativeCommandUseErrorActionPreference = $false",
      `    aws eks create-access-entry ${cluster}${region} --no-cli-pager 2>&1 | ForEach-Object { "$_" }`,
      "  }",
      "  if ($LASTEXITCODE -eq 0) { break }",
      "  # Retry only while EKS rejects the new principal; any other error (no such cluster, access denied) is final.",
      `  if ("$EksError" -notmatch ${psQuote(EKS_PROPAGATION_ERROR)}) { throw "aws failed: create-access-entry. $EksError" }`,
      '  Write-Warning "$EksError"',
      `  if ($Attempt -ge ${attempts}) { throw "aws failed: create-access-entry. ${EKS_RETRY_FAILED}." }`,
      `  Write-Output "${EKS_RETRY_MESSAGE} ($Attempt/${attempts})."`,
      `  Start-Sleep -Seconds ${seconds}`,
      "}",
      ...aws(
        "associate-access-policy",
        `aws eks associate-access-policy ${cluster} --policy-arn ${EKS_VIEW_POLICY} --access-scope type=cluster${region} | Out-Null`,
      ),
    ];
  });
}

/** PowerShell script (5.1 and 7) that creates the role, or attaches the policy to a group/user, with the AWS CLI. */
export function exportCliPowerShell(input: ExportInput): ExportFile {
  const { model, result } = input;
  const trust = model.trust;
  const lines: string[] = [];
  const add = (...l: string[]): void => {
    lines.push(...l);
  };
  const inline = model.policyMode === "inline";

  add("$ErrorActionPreference = 'Stop'", "");
  add("# Generated by RoleCraft - https://rolecraft.omhinge.cloud");

  if (trust.kind === "principal") {
    const kind = trust.target;
    add(`# Creates a permissions policy and attaches it to an existing IAM ${kind}.`, "");
    // $RoleName only names the policy; an unused variable is a PSScriptAnalyzer warning.
    if (result.policy) add(`$RoleName = ${psQuote(model.name)}`);
    add(`$PrincipalName = ${psQuote(trust.name)}`, "");
    add(...preflight(input, kind === "user" && eksClusters(model.grants).length > 0));
    if (result.policy) add("# Permissions policy", ...jsonFile("policy.json", stringifyPolicy(result.policy)), "");
    if (result.policy) {
      if (inline) {
        add(
          ...aws(
            `put-${kind}-policy`,
            `aws iam put-${kind}-policy "--${kind}-name=$PrincipalName" "--policy-name=\${RoleName}-inline" --policy-document file://policy.json`,
          ),
        );
      } else {
        add(
          ...aws("create-policy", CREATE_POLICY),
          ...aws(
            `attach-${kind}-policy`,
            `aws iam attach-${kind}-policy "--${kind}-name=$PrincipalName" "--policy-arn=$PolicyArn"`,
          ),
        );
      }
    }
    for (const arn of model.managedPolicyArns) {
      add(
        ...aws(
          `attach-${kind}-policy`,
          `aws iam attach-${kind}-policy "--${kind}-name=$PrincipalName" --policy-arn ${psQuote(arn)}`,
        ),
      );
    }
    const clusters = eksClusters(model.grants);
    if (clusters.length > 0) {
      if (kind === "user") {
        add(
          "",
          ...EKS_COMMENTS,
          ...aws("get-user", '$PrincipalArn = aws iam get-user "--user-name=$PrincipalName" --query User.Arn --output text'),
          ...eksSteps(clusters, "PrincipalArn", model.region),
        );
      } else {
        add("", EKS_GROUP_COMMENT);
      }
    }
    add("", `Write-Output "Attached the policy to ${kind} $PrincipalName."`);
    return finish("attach-policy.ps1", lines);
  }

  add("# Creates an IAM role with its trust policy and permissions.", "");

  if (!result.trust) {
    if (result.policy) add("# Permissions policy", ...jsonFile("policy.json", stringifyPolicy(result.policy)), "");
    add(
      "# No trust policy could be generated, so no role was created. Fix the issues in RoleCraft and export again.",
      "",
      'Write-Output "Nothing was created."',
    );
    return finish("create-role.ps1", lines);
  }

  add(`$RoleName = ${psQuote(model.name)}`, "");
  add(...preflight(input, eksClusters(model.grants).length > 0));
  add("# Trust policy: who can assume the role", ...jsonFile("trust.json", stringifyPolicy(result.trust)), "");
  if (result.policy) add("# Permissions policy", ...jsonFile("policy.json", stringifyPolicy(result.policy)), "");

  if (trust.kind === "github") {
    add("# GitHub Actions needs an OIDC identity provider in this account (created once).", ...GITHUB_OIDC_CHECK, "");
  }
  add(
    ...aws(
      "create-role",
      `aws iam create-role "--role-name=$RoleName" --assume-role-policy-document file://trust.json --description ${psQuote(TAG)} | Out-Null`,
    ),
  );
  if (result.policy) {
    if (inline) {
      add(
        ...aws(
          "put-role-policy",
          'aws iam put-role-policy "--role-name=$RoleName" "--policy-name=${RoleName}-inline" --policy-document file://policy.json',
        ),
      );
    } else {
      add(
        ...aws("create-policy", CREATE_POLICY),
        ...aws("attach-role-policy", 'aws iam attach-role-policy "--role-name=$RoleName" "--policy-arn=$PolicyArn"'),
      );
    }
  }
  for (const arn of model.managedPolicyArns) {
    add(...aws("attach-role-policy", `aws iam attach-role-policy "--role-name=$RoleName" --policy-arn ${psQuote(arn)}`));
  }
  const ec2 = trust.kind === "service" && trust.service === "ec2";
  if (ec2) {
    add(
      "",
      "# EC2 instances use roles through an instance profile.",
      ...aws("create-instance-profile", 'aws iam create-instance-profile "--instance-profile-name=$RoleName" | Out-Null'),
      ...aws(
        "add-role-to-instance-profile",
        'aws iam add-role-to-instance-profile "--instance-profile-name=$RoleName" "--role-name=$RoleName"',
      ),
    );
  }

  const clusters = eksClusters(model.grants);
  if (clusters.length > 0) {
    add(
      "",
      ...EKS_COMMENTS,
      ...aws("wait role-exists", 'aws iam wait role-exists "--role-name=$RoleName"'),
      ...aws("get-role", '$RoleArn = aws iam get-role "--role-name=$RoleName" --query Role.Arn --output text'),
      ...eksSteps(clusters, "RoleArn", model.region),
    );
  }

  add("", 'Write-Output "Created role $RoleName."');
  if (ec2) add('Write-Output "Created instance profile $RoleName."');
  if (result.policy) {
    add(
      inline
        ? 'Write-Output "Added inline policy ${RoleName}-inline."'
        : 'Write-Output "Created and attached policy ${RoleName}-policy."',
    );
  }
  return finish("create-role.ps1", lines);
}

function finish(filename: string, lines: string[]): ExportFile {
  return { filename, language: "powershell", content: lines.join("\n").replace(/\n+$/, "") + "\n" };
}
