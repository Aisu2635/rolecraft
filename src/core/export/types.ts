import { hasErrors, type GenerateResult } from "../generate";
import type { RoleModel } from "../model/model";
import type { ExportFile } from "./json";

export interface ExportInput {
  model: RoleModel;
  result: GenerateResult;
  summary: { can: { grantId: string; text: string }[]; cannot: string[] };
}

export type ExportOutcome = { ok: true; files: ExportFile[] } | { ok: false; reason: string };

/** Description every format gives the role and the managed policy (scripts/apply-exports.sh compares them on moto). */
export const TAG = "Created with RoleCraft";

export function exportable(result: GenerateResult, model: RoleModel): boolean {
  return !hasErrors(result.issues) && (result.policy !== null || model.managedPolicyArns.length > 0);
}

/**
 * Account the GitHub trust policy is tied to (its OIDC provider ARN names it), when the scripts and Terraform
 * should refuse to run with credentials for another account. Null for every other trust.
 */
export function githubAccount(model: RoleModel): string | null {
  return model.trust.kind === "github" && model.accountId ? model.accountId : null;
}

/** Message when the credentials' account differs from the trust policy's (`caller` is how the script names it). */
export const accountMismatch = (account: string, caller: string): string =>
  `These credentials are for account ${caller}, but the trust policy trusts GitHub through account ${account}. Use credentials for account ${account}.`;

/** POSIX single-quote. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, String.raw`'\''`)}'`;
}

/** PowerShell single-quote. */
export function psQuote(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`;
}

const HCL_ESCAPES: Record<string, string> = { "\\b": "\\u0008", "\\f": "\\u000c" };

/**
 * HCL string literal: JSON string with template sequences escaped. JSON's \b and \f aren't HCL escapes,
 * so they become \u0008 / \u000c (each match consumes a whole escape, so an escaped backslash
 * followed by b/f is left alone).
 */
export function hclString(s: string): string {
  return JSON.stringify(s)
    .replace(/\\[\\bf]/g, (m) => HCL_ESCAPES[m] ?? m)
    .replace(/\$\{/g, () => "$${")
    .replace(/%\{/g, () => "%%{");
}

/** Terraform resource label: [a-z0-9_], never starting with a digit. */
export function tfLabel(s: string): string {
  const l = s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (l === "") return "r";
  return /^[0-9]/.test(l) ? `r_${l}` : l;
}
