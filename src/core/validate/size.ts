import type { PolicyDocument } from "../types";

export const LIMITS = { managed: 6144, inline: 10240, trust: 2048 } as const;

/** Policy size as AWS counts it: characters excluding whitespace. */
export function policySize(doc: PolicyDocument): number {
  return JSON.stringify(doc).replace(/\s/g, "").length;
}
