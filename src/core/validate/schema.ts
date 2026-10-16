import { z } from "zod";
import type { Issue, Statement } from "../types";

const stringOrList = z.union([z.string(), z.array(z.string()).min(1)]);

const statementSchema = z
  .object({
    Sid: z.string().optional(),
    Effect: z.enum(["Allow", "Deny"]),
    Principal: z.union([z.literal("*"), z.record(z.string(), stringOrList)]).optional(),
    Action: stringOrList,
    Resource: stringOrList.optional(),
    Condition: z.record(z.string(), z.record(z.string(), stringOrList)).optional(),
  })
  .strict();

export function toList(v: string | string[]): string[] {
  return typeof v === "string" ? [v] : v;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const seg of path) {
    out += typeof seg === "number" ? `[${seg}]` : out === "" ? String(seg) : `.${String(seg)}`;
  }
  return out;
}

export interface ParsedDocument {
  issues: Issue[];
  /** Statements that passed structural validation, with their original index. */
  statements: { index: number; statement: Statement }[];
}

const SID = /^[A-Za-z0-9]*$/;

function schemaIssue(path: string, message: string): Issue {
  return { id: "V_SCHEMA", severity: "error", message, path };
}

/**
 * Structural validation shared by identity and trust validators. Never throws;
 * statements that fail structure are reported as V_SCHEMA and left out of
 * `statements`.
 */
export function parseDocument(doc: unknown): ParsedDocument {
  const issues: Issue[] = [];
  const statements: ParsedDocument["statements"] = [];
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    issues.push(schemaIssue("", "Policy must be a JSON object."));
    return { issues, statements };
  }
  const obj = doc as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key !== "Version" && key !== "Statement" && key !== "Id") {
      issues.push(schemaIssue(key, `Unsupported top-level element "${key}".`));
    }
  }
  if (typeof obj["Version"] !== "string") {
    issues.push(schemaIssue("Version", 'Policy needs a Version of "2012-10-17".'));
  } else if (obj["Version"] !== "2012-10-17") {
    issues.push({
      id: "V_VERSION",
      severity: "error",
      message: `Version must be "2012-10-17", found "${obj["Version"]}".`,
      path: "Version",
    });
  }
  const raw = obj["Statement"];
  if (!Array.isArray(raw)) {
    issues.push(schemaIssue("Statement", "Statement must be an array."));
    return { issues, statements };
  }
  if (raw.length === 0) {
    issues.push({
      id: "V_EMPTY_STATEMENTS",
      severity: "error",
      message: "Policy has no statements.",
      path: "Statement",
    });
    return { issues, statements };
  }
  raw.forEach((item: unknown, index) => {
    const result = statementSchema.safeParse(item);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.push(schemaIssue(formatPath(["Statement", index, ...issue.path]), issue.message));
      }
      return;
    }
    statements.push({ index, statement: result.data as Statement });
  });
  const seen = new Set<string>();
  for (const { index, statement } of statements) {
    const sid = statement.Sid;
    if (sid === undefined) continue;
    const path = `Statement[${index}].Sid`;
    if (!SID.test(sid)) {
      issues.push({
        id: "V_SID_FORMAT",
        severity: "error",
        message: `Sid "${sid}" may only contain letters and digits.`,
        path,
      });
    }
    if (sid !== "" && seen.has(sid)) {
      issues.push({ id: "V_SID_DUPLICATE", severity: "error", message: `Sid "${sid}" is used more than once.`, path });
    }
    seen.add(sid);
  }
  return { issues, statements };
}
