import type { RoleModel } from "../core/model/model";

/** Touched flags, keyed by the focus id `focusIdFor` gives a field's issues: `field:<path>` or `grant:<id>`. */
export type Touched = Record<string, true>;

const TRUST_FIELD = "field:trust.";
const ARN_ROW = /^field:managedPolicyArns\[(\d+)\]$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const hasText = (v: unknown): boolean =>
  typeof v === "string" ? v !== "" : isObject(v) ? Object.values(v).some(hasText) : false;

function drop(touched: Touched, gone: (id: string) => boolean): Touched {
  const kept = Object.entries(touched).filter(([id]) => !gone(id));
  return kept.length === Object.keys(touched).length ? touched : (Object.fromEntries(kept) as Touched);
}

/** Without the trust fields, which a new trust kind replaces. */
export const withoutTrustFields = (touched: Touched): Touched => drop(touched, (id) => id.startsWith(TRUST_FIELD));

/** Without a removed grant. */
export const withoutGrant = (touched: Touched, grantId: string): Touched =>
  drop(touched, (id) => id === "grant:" + grantId);

/**
 * After managed policy ARN rows are removed, the rows from the first removed one on hold other values (or none), so
 * their flags go: a row added later is not born red.
 */
export function withoutRemovedRows(touched: Touched, before: readonly string[], after: readonly string[]): Touched {
  if (after.length >= before.length) return touched;
  let first = 0;
  while (first < after.length && after[first] === before[first]) first++;
  return drop(touched, (id) => Number(ARN_ROW.exec(id)?.[1] ?? -1) >= first);
}

/**
 * The fields of a loaded role that hold a value. Their errors are the sender's mistakes and show at once; a blank
 * field stays a to-do until the user reaches it. A grant counts once any scope text is filled in.
 */
export function filledFieldIds(model: RoleModel): Touched {
  const out: Touched = {};
  const walk = (v: unknown, path: string): void => {
    if (typeof v === "string" && v !== "") out["field:" + path] = true;
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) if (k !== "kind") walk(x, `${path}.${k}`);
  };
  for (const key of ["name", "accountId", "region", "policyMode", "managedPolicyArns"] as const) walk(model[key], key);
  if (model.managedPolicyArns.length > 0) out["field:managedPolicyArns"] = true;
  walk(model.trust, "trust");
  for (const g of model.grants) {
    const text = g.scope.type === "module" ? g.scope.data : g.scope.type === "arns" ? g.scope.arns : undefined;
    if (hasText(text)) out["grant:" + g.id] = true;
  }
  return out;
}
