import { ACCESS_LEVELS, type Statement } from "../types";
import type { AccessSelection } from "../model/model";

/** "execute-api" -> "ExecuteApi". Non-alphanumerics act as separators. */
export function pascal(serviceKey: string): string {
  return serviceKey
    .split(/[^A-Za-z0-9]+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

export function baseSid(
  svc: string,
  access: AccessSelection,
  part: "All" | "Scoped" | "Global",
): string {
  let mid: string;
  if (access.type === "levels") {
    mid = ACCESS_LEVELS.filter((l) => access.levels.includes(l))
      .map((l) => pascal(l))
      .join("");
  } else if (access.type === "actions") {
    mid = "Custom";
  } else {
    mid = pascal(access.preset);
  }
  return pascal(svc) + mid + part;
}

/** Second "X" becomes "X2", third "X3", and so on. */
export function dedupeSids(statements: Statement[]): Statement[] {
  const seen = new Map<string, number>();
  return statements.map((s) => {
    if (s.Sid === undefined) return s;
    const n = (seen.get(s.Sid) ?? 0) + 1;
    seen.set(s.Sid, n);
    return n === 1 ? s : { ...s, Sid: s.Sid + String(n) };
  });
}
