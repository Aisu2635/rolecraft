import type { GenerateResult } from "../generate";
import type { PolicyDocument, Statement } from "../types";

export interface ExportFile {
  filename: string;
  language: "json" | "bash" | "powershell" | "hcl" | "yaml" | "markdown";
  content: string;
}

const STATEMENT_KEYS = ["Sid", "Effect", "Principal", "Action", "Resource", "Condition"] as const;

function orderStatement(s: Statement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of STATEMENT_KEYS) {
    if (s[k] !== undefined) out[k] = s[k];
  }
  return out;
}

export function stringifyPolicy(doc: PolicyDocument): string {
  const ordered = { Version: doc.Version, Statement: doc.Statement.map(orderStatement) };
  return JSON.stringify(ordered, null, 2) + "\n";
}

export function exportJson(result: GenerateResult): ExportFile[] {
  const files: ExportFile[] = [];
  if (result.policy) {
    files.push({ filename: "policy.json", language: "json", content: stringifyPolicy(result.policy) });
  }
  if (result.trust) {
    files.push({ filename: "trust.json", language: "json", content: stringifyPolicy(result.trust) });
  }
  return files;
}
