import { hasErrors, type GenerateResult } from "../generate";
import type { RoleModel } from "../model/model";
import type { ExportFile } from "./json";

export interface ExportInput {
  model: RoleModel;
  result: GenerateResult;
  summary: { can: { grantId: string; text: string }[]; cannot: string[] };
}

export type ExportOutcome = { ok: true; files: ExportFile[] } | { ok: false; reason: string };

export function exportable(result: GenerateResult, model: RoleModel): boolean {
  return !hasErrors(result.issues) && (result.policy !== null || model.managedPolicyArns.length > 0);
}

/** POSIX single-quote. */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, String.raw`'\''`)}'`;
}

/** PowerShell single-quote. */
export function psQuote(s: string): string {
  return `'${s.replace(/['‘’‚‛]/g, (c) => c + c)}'`;
}

/** HCL string literal: JSON string with template sequences escaped. */
export function hclString(s: string): string {
  return JSON.stringify(s).replace(/\$\{/g, () => "$${").replace(/%\{/g, () => "%%{");
}

/** Terraform resource label: [a-z0-9_], never starting with a digit. */
export function tfLabel(s: string): string {
  const l = s.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  if (l === "") return "r";
  return /^[0-9]/.test(l) ? `r_${l}` : l;
}
