import type { RoleModel } from "../model/model";
import type { Issue } from "../types";

const ROLE_NAME = /^[\w+=,.@-]{1,64}$/;
const ACCOUNT_ID = /^\d{12}$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const EXTERNAL_ID = /^[\w+=,.@:/-]{2,1224}$/;
const MANAGED_POLICY_ARN = /^arn:aws:iam::(aws|\d{12}):policy\/[\w+=,.@/-]{1,512}$/;
/** AWS default quota for managed policies attached to a role, user or group (adjustable up to 20). */
export const MAX_MANAGED_POLICIES = 10;
const NON_AWS_REGION = /-gov-|^cn-|^us-iso/;
const PRINCIPAL_NAME = /^[\w+=,.@-]{1,128}$/;

function issue(id: string, path: string, message: string): Issue {
  return { id, severity: "error", message, path };
}

function check(
  out: Issue[],
  value: unknown,
  re: RegExp,
  id: string,
  path: string,
  message: string,
): void {
  if (typeof value !== "string" || !re.test(value)) out.push(issue(id, path, message));
}

/** Validates user-entered values on the model. Blank optional fields count as unset. */
export function validateModelValues(model: RoleModel): Issue[] {
  const out: Issue[] = [];
  if (typeof model !== "object" || model === null) {
    return [issue("V_ROLE_NAME", "name", "Role model is missing.")];
  }
  check(out, model.name, ROLE_NAME, "V_ROLE_NAME", "name", "Role name must be 1-64 characters: letters, digits and + = , . @ _ -");
  if (model.accountId !== undefined && model.accountId !== "") {
    check(out, model.accountId, ACCOUNT_ID, "V_ACCOUNT_ID", "accountId", "Account ID must be exactly 12 digits.");
  }
  if (model.region !== undefined && model.region !== "") {
    if (typeof model.region === "string" && NON_AWS_REGION.test(model.region)) {
      out.push(issue("V_REGION", "region", "Only regions in the standard AWS partition are supported (not GovCloud, China or isolated regions)."));
    } else {
      check(out, model.region, REGION, "V_REGION", "region", "Region must look like us-east-1.");
    }
  }
  if (Array.isArray(model.managedPolicyArns)) {
    model.managedPolicyArns.forEach((arn, i) => {
      check(out, arn, MANAGED_POLICY_ARN, "V_MANAGED_POLICY_ARN", `managedPolicyArns[${i}]`, "Managed policy ARN must look like arn:aws:iam::aws:policy/Name.");
      if (model.managedPolicyArns.indexOf(arn) < i) {
        out.push(issue("V_DUPLICATE_MANAGED_POLICY_ARN", `managedPolicyArns[${i}]`, "This managed policy is already in the list. Remove the duplicate."));
      }
    });
  }
  const trust = model.trust;
  if (typeof trust !== "object" || trust === null) return out;
  switch (trust.kind) {
    case "account":
      check(out, trust.accountId, ACCOUNT_ID, "V_ACCOUNT_ID", "trust.accountId", "Trusted account ID must be exactly 12 digits.");
      if (trust.externalId !== undefined && trust.externalId !== "") {
        check(out, trust.externalId, EXTERNAL_ID, "V_EXTERNAL_ID", "trust.externalId", "External ID must be 2-1224 characters: letters, digits and + = , . @ : / _ -");
      }
      break;
    case "github":
      check(out, trust.owner, GITHUB_OWNER, "V_GITHUB_OWNER", "trust.owner", "GitHub owner must be 1-39 letters, digits or hyphens, starting with a letter or digit.");
      check(out, trust.repo, GITHUB_REPO, "V_GITHUB_REPO", "trust.repo", "GitHub repository must be 1-100 letters, digits, dots, underscores or hyphens.");
      break;
    case "principal":
      check(out, trust.name, PRINCIPAL_NAME, "V_PRINCIPAL_NAME", "trust.name", "Name must be 1-128 characters: letters, digits and + = , . @ _ -");
      break;
    case "service":
      break;
  }
  return out;
}

/**
 * The attached managed policy quota: the existing ARNs plus the managed policy RoleCraft generates (when the
 * model is in managed mode and has permissions). Checked by generate(), which knows whether a policy exists.
 */
export function managedPolicyCountIssue(model: RoleModel, generatedManagedPolicy: boolean): Issue | null {
  const arns = Array.isArray(model.managedPolicyArns) ? model.managedPolicyArns.length : 0;
  const total = arns + (generatedManagedPolicy ? 1 : 0);
  if (total <= MAX_MANAGED_POLICIES) return null;
  const who = model.trust?.kind === "principal" ? `an IAM ${model.trust.target}` : "a role";
  const counted = generatedManagedPolicy
    ? `${total} managed policies would be attached (${arns} ARNs, and the policy RoleCraft generates counts too)`
    : `${total} managed policies would be attached`;
  return issue(
    "V_TOO_MANY_MANAGED_POLICIES",
    "managedPolicyArns",
    `${counted}; AWS allows ${MAX_MANAGED_POLICIES} per ${who.replace(/^an? /, "")} by default. Remove some${generatedManagedPolicy ? " or switch to inline mode" : ""}, or request a quota increase (up to 20) in Service Quotas before applying.`,
  );
}
