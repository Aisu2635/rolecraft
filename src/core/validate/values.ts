import type { RoleModel } from "../model/model";
import type { Issue } from "../types";

const ROLE_NAME = /^[\w+=,.@-]{1,64}$/;
const ACCOUNT_ID = /^\d{12}$/;
const GITHUB_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO = /^[A-Za-z0-9._-]{1,100}$/;
const REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
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
    check(out, model.region, REGION, "V_REGION", "region", "Region must look like us-east-1.");
  }
  const trust = model.trust;
  if (typeof trust !== "object" || trust === null) return out;
  switch (trust.kind) {
    case "account":
      check(out, trust.accountId, ACCOUNT_ID, "V_ACCOUNT_ID", "trust.accountId", "Trusted account ID must be exactly 12 digits.");
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
