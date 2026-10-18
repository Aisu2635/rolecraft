import type { Trust } from "../model/model";
import type { PolicyDocument } from "../types";

/**
 * IAM policy size quotas (characters excluding whitespace). Inline quotas are per identity and aggregate:
 * every inline policy on the user/group/role counts toward the same total.
 */
export const LIMITS = { managed: 6144, inline: 10240, inlineUser: 2048, inlineGroup: 5120, trust: 2048 } as const;

/** Policy size as AWS counts it: characters excluding whitespace. */
export function policySize(doc: PolicyDocument): number {
  return JSON.stringify(doc).replace(/\s/g, "").length;
}

/** Size quota for the generated policy: managed 6,144; inline 2,048 (user), 5,120 (group) or 10,240 (role). */
export function policyLimit(policyMode: "inline" | "managed", trust: Trust): number {
  if (policyMode === "managed") return LIMITS.managed;
  if (trust.kind !== "principal") return LIMITS.inline;
  return trust.target === "user" ? LIMITS.inlineUser : LIMITS.inlineGroup;
}
