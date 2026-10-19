import type { RoleModel } from "../../core/model/model";
import type { Issue } from "../../core/types";
import type { Step } from "../../state/builder";

/** Issues at exactly this path, errors first. */
export function issuesAt(issues: Issue[], path: string): Issue[] {
  const here = issues.filter((i) => i.path === path);
  return [...here.filter((i) => i.severity === "error"), ...here.filter((i) => i.severity !== "error")];
}

export function errorTextAt(issues: Issue[], path: string): string | undefined {
  return issuesAt(issues, path).find((i) => i.severity === "error")?.message;
}

export function grantIssues(issues: Issue[], grantId: string): Issue[] {
  return issues.filter((i) => i.grantId === grantId);
}

/** The trust builder reports these without a path; they belong to fields on step 0. */
const TRUST_ISSUE_FIELDS: Record<string, string> = {
  E_GITHUB_NEEDS_ACCOUNT: "accountId",
  E_GITHUB_OWNER_REPO_MISSING: "trust.owner",
  E_GITHUB_OWNER_REPO_WILDCARD: "trust.owner",
  E_GITHUB_REF_VALUE: "trust.ref.value",
};
const DETAIL_PATH = /^(name|accountId|region|policyMode|managedPolicyArns(\[\d+\])?)$/;

/** Where the user has to go to fix an issue: the step to show and the focus target to set. */
export function focusIdFor(issue: Issue): { step: Step; target: string } | null {
  if (issue.grantId) return { step: 1, target: "grant:" + issue.grantId };
  const path = issue.path;
  if (path === undefined) {
    const field = TRUST_ISSUE_FIELDS[issue.id];
    return field ? { step: 0, target: "field:" + field } : null;
  }
  if (path.startsWith("trust.")) return { step: 0, target: "field:" + path };
  if (DETAIL_PATH.test(path)) return { step: 2, target: "field:" + path };
  return null;
}

/** Grant errors that no field of the grant can fix (a broken link, an unknown service): never a to-do. */
const NO_FIELD = new Set([
  "E_INTERNAL",
  "E_UNKNOWN_SERVICE",
  "E_UNKNOWN_MODULE",
  "E_MODULE_SERVICE",
  "E_MODULE_PRESET",
  "E_MODULE_SCOPE",
  "E_MODULE_SCOPE_GENERIC",
  "E_PRESET_WITHOUT_MODULE",
  "E_UNKNOWN_ACTION",
]);

/**
 * Errors on fields the user has not reached yet are pending: a "to do", not a red error. An error is pending when
 * it maps to a field and that field is not revealed. Warnings, infos and errors with no field are never pending.
 */
export function splitPending(issues: Issue[], revealed: (id: string) => boolean): { pending: Issue[]; shown: Issue[] } {
  const pending: Issue[] = [];
  const shown: Issue[] = [];
  for (const issue of issues) {
    const to = issue.severity === "error" && !NO_FIELD.has(issue.id) ? focusIdFor(issue) : null;
    (to && !revealed(to.target) ? pending : shown).push(issue);
  }
  return { pending, shown };
}

/** Short instructions for an empty field, keyed by issue id, or by id and path where one id covers many fields. */
const TODO_TEXT: Record<string, string> = {
  V_GITHUB_OWNER: "Enter the GitHub owner",
  V_GITHUB_REPO: "Enter the repository name",
  E_GITHUB_NEEDS_ACCOUNT: "Enter the 12-digit AWS account ID",
  V_ACCOUNT_ID: "Enter the 12-digit AWS account ID",
  V_PRINCIPAL_NAME: "Enter the group or user name",
  V_ROLE_NAME: "Enter a name",
  V_MANAGED_POLICY_ARN: "Enter the managed policy ARN",
  "E_MODULE_DATA data.bucket": "Enter the bucket name",
  "E_MODULE_DATA data.repository": "Enter the repository name",
  "E_MODULE_DATA data.cluster": "Enter the cluster name",
  "E_MODULE_DATA data.functionName": "Enter the function name",
  "E_MODULE_DATA data.table": "Enter the table name",
  "E_MODULE_DATA data.logGroup": "Enter the log group name",
  "E_MODULE_DATA data.secretName": "Enter the secret name",
  "E_MODULE_DATA data.keyArn": "Enter the key ARN",
  "E_MODULE_DATA data.queueName": "Enter the queue name",
  "E_MODULE_DATA data.selector.key": "Enter the tag key",
  "E_MODULE_DATA data.selector.ids[]": "Enter the instance ID",
  E_S3_PREFIX_EMPTY: "Enter the folder name, or remove the row",
};

/** The value the issue is about: under the grant's scope for grant issues, else under the model. */
function valueAt(model: RoleModel, issue: Issue): unknown {
  const path = issue.path ?? TRUST_ISSUE_FIELDS[issue.id];
  if (path === undefined) return undefined;
  let node: unknown = issue.grantId ? model.grants.find((g) => g.id === issue.grantId)?.scope : model;
  for (const key of path.match(/[^.[\]]+/g) ?? []) {
    node = typeof node === "object" && node !== null ? (node as Record<string, unknown>)[key] : undefined;
  }
  return node;
}

/** What a to-do says: a short instruction while its field is empty, else the core message. */
export function todoText(issue: Issue, model: RoleModel): string {
  const value = valueAt(model, issue);
  if (value !== undefined && value !== "") return issue.message;
  const path = (issue.path ?? "").replace(/\[\d+\]/g, "[]");
  return TODO_TEXT[`${issue.id} ${path}`] ?? TODO_TEXT[issue.id] ?? issue.message;
}

/** Info issues that say part of the user's input was left out of the policy. The row shows them as notes. */
const DROPPED_INPUT = new Set(["I_ACTION_NOT_SCOPED"]);

/** Whether a grant's row lists this issue: errors, warnings, and the info notes about dropped input. */
export function shownOnRow(issue: Issue): boolean {
  return issue.severity !== "info" || DROPPED_INPUT.has(issue.id);
}
