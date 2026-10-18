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
