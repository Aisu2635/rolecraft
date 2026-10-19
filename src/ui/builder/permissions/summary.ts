import type { Grant } from "../../../core/model/model";
import { MODULE_FIELDS } from "../scope/module-fields";

const NOT_SET = "Not set";
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const rec = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown): string => (typeof v === "string" ? v : "");

function s3Summary(data: Record<string, unknown>): string {
  const bucket = text(data.bucket);
  if (bucket === "") return NOT_SET;
  const prefixes = Array.isArray(data.prefixes) ? data.prefixes.map(text) : [];
  // A lone empty prefix is the whole bucket; next to other rows it is an unfilled row and never a folder.
  if (prefixes.length <= 1 && (prefixes[0] ?? "") === "") return `${bucket} / whole bucket`;
  const folders = prefixes.filter((p) => p !== "");
  if (folders.length === 0) return NOT_SET;
  return folders.length === 1 ? `${bucket} / ${folders[0]}` : `${bucket} / ${plural(folders.length, "folder", "folders")}`;
}

function ec2Summary(data: Record<string, unknown>): string {
  const sel = rec(data.selector);
  if (sel.type === "all") return "All instances";
  if (sel.type === "ids") {
    const n = Array.isArray(sel.ids) ? sel.ids.filter((i) => text(i) !== "").length : 0;
    return n === 0 ? NOT_SET : plural(n, "instance", "instances");
  }
  return text(sel.key) === "" ? NOT_SET : `${text(sel.key)}=${text(sel.value)}`;
}

/** The short scope text shown on a grant row, e.g. "data-lake / reports/". */
export function scopeSummary(grant: Grant): string {
  const scope = grant.scope;
  if (scope.type === "all") return "All resources";
  if (scope.type === "arns") {
    const n = scope.arns.filter((a) => a.trim() !== "").length;
    return n === 0 ? NOT_SET : plural(n, "resource", "resources");
  }
  const data = rec(scope.data);
  if (grant.module === "s3") return s3Summary(data);
  if (grant.module === "ec2") return ec2Summary(data);
  const first = grant.module && Object.hasOwn(MODULE_FIELDS, grant.module)
    ? MODULE_FIELDS[grant.module as keyof typeof MODULE_FIELDS][0]
    : undefined;
  return (first && text(data[first.key])) || NOT_SET;
}
