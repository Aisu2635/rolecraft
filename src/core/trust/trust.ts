import type { BuildContext } from "../arn";
import type { Trust } from "../model/model";
import type { ConditionBlock, Issue, PolicyDocument, Statement } from "../types";

export interface TrustResult {
  doc: PolicyDocument | null;
  issues: Issue[];
}

const OIDC_HOST = "token.actions.githubusercontent.com";

function wrap(statement: Statement): PolicyDocument {
  return { Version: "2012-10-17", Statement: [statement] };
}

function buildGithub(trust: Extract<Trust, { kind: "github" }>, ctx: BuildContext): TrustResult {
  const { owner, repo, ref } = trust;
  const issues: Issue[] = [];
  if (!ctx.accountId) {
    issues.push({
      id: "E_GITHUB_NEEDS_ACCOUNT",
      severity: "error",
      message: "GitHub Actions trust needs an AWS account ID to reference the OIDC provider.",
    });
  }
  if (!owner || !repo) {
    issues.push({
      id: "E_GITHUB_OWNER_REPO_MISSING",
      severity: "error",
      message: "Enter both the GitHub owner and repository name.",
    });
  } else if (owner.includes("*") || repo.includes("*")) {
    issues.push({
      id: "E_GITHUB_OWNER_REPO_WILDCARD",
      severity: "error",
      message: "The GitHub owner and repository cannot contain wildcards; trust must be locked to one repository.",
    });
  }
  const value = ref.value ?? "";
  if (ref.type !== "pull_request" && value === "") {
    issues.push({
      id: "E_GITHUB_REF_VALUE",
      severity: "error",
      message: `Enter a ${ref.type} name to lock the trust to.`,
    });
  }
  if (issues.length > 0 || !ctx.accountId) return { doc: null, issues };

  const base = `repo:${owner}/${repo}`;
  let sub: string;
  switch (ref.type) {
    case "branch":
      sub = `${base}:ref:refs/heads/${value}`;
      break;
    case "tag":
      sub = `${base}:ref:refs/tags/${value}`;
      break;
    case "environment":
      sub = `${base}:environment:${value}`;
      break;
    case "pull_request":
      sub = `${base}:pull_request`;
      break;
  }
  const wildcard = (ref.type === "branch" || ref.type === "tag") && value.includes("*");
  const aud = { [`${OIDC_HOST}:aud`]: "sts.amazonaws.com" };
  const condition: ConditionBlock = wildcard
    ? { StringEquals: aud, StringLike: { [`${OIDC_HOST}:sub`]: sub } }
    : { StringEquals: { ...aud, [`${OIDC_HOST}:sub`]: sub } };
  if (wildcard) {
    issues.push({
      id: "W_GITHUB_WILDCARD",
      severity: "warning",
      message: `The ${ref.type} pattern "${value}" uses a wildcard, so any matching ref in this repository can assume the role.`,
    });
  }
  return {
    doc: wrap({
      Effect: "Allow",
      Principal: { Federated: `arn:aws:iam::${ctx.accountId}:oidc-provider/${OIDC_HOST}` },
      Action: "sts:AssumeRoleWithWebIdentity",
      Condition: condition,
    }),
    issues,
  };
}

export function buildTrust(trust: Trust, ctx: BuildContext): TrustResult {
  switch (trust.kind) {
    case "service":
      return {
        doc: wrap({
          Effect: "Allow",
          Principal: { Service: `${trust.service}.amazonaws.com` },
          Action: "sts:AssumeRole",
        }),
        issues: [],
      };
    case "github":
      return buildGithub(trust, ctx);
    case "account": {
      const issues: Issue[] = [];
      const condition: ConditionBlock = {};
      if (trust.externalId) {
        condition["StringEquals"] = { "sts:ExternalId": trust.externalId };
      } else {
        issues.push({
          id: "W_NO_EXTERNAL_ID",
          severity: "warning",
          message: "No external ID is set. Add one if a third party will assume this role (confused deputy protection).",
        });
      }
      if (trust.requireMfa) condition["Bool"] = { "aws:MultiFactorAuthPresent": "true" };
      const statement: Statement = {
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${trust.accountId}:root` },
        Action: "sts:AssumeRole",
      };
      if (Object.keys(condition).length > 0) statement.Condition = condition;
      return { doc: wrap(statement), issues };
    }
    case "principal":
      return {
        doc: null,
        issues:
          trust.target === "user"
            ? [
                {
                  id: "I_PREFER_GROUP",
                  severity: "info",
                  message: "Prefer granting permissions through an IAM group rather than directly to a user.",
                },
              ]
            : [],
      };
  }
}
