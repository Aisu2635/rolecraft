import type { Grant } from "../model/model";

export const EKS_VIEW_POLICY = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy";

/** Comment lines preceding the EKS access entry steps, identical in every format. */
export const EKS_COMMENTS: readonly string[] = [
  "# Give kubectl access to your EKS cluster(s) through EKS access entries.",
  "# The cluster's authentication mode must be API or API_AND_CONFIG_MAP for access entries.",
  "# Change AmazonEKSViewPolicy to AmazonEKSEditPolicy or AmazonEKSClusterAdminPolicy if more access is needed.",
];

/** Emitted instead of access entries when the policy is attached to an IAM group. */
export const EKS_GROUP_COMMENT =
  "# kubectl access: EKS access entries can't target IAM groups. Ask the cluster admin to add an access entry for each user, or use a role instead.";

/** Distinct cluster names of the EKS kubectl preset grants, in grant order. */
export function eksClusters(grants: Grant[]): string[] {
  const out: string[] = [];
  for (const g of grants) {
    if (g.module !== "eks" || g.service !== "eks" || g.access.type !== "preset") continue;
    if (g.access.preset !== "kubectl" || g.scope.type !== "module") continue;
    const data = g.scope.data as { cluster?: unknown } | null;
    const cluster = data && typeof data === "object" ? data.cluster : undefined;
    if (typeof cluster === "string" && cluster !== "" && !out.includes(cluster)) out.push(cluster);
  }
  return out;
}

/** FNV-1a 32-bit hash of the UTF-8 bytes of `s`, as 8 lowercase hex characters (stable short suffix for ids). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  const byte = (b: number): void => {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  };
  for (const c of s) {
    const cp = c.codePointAt(0) as number;
    if (cp < 0x80) {
      byte(cp);
    } else if (cp < 0x800) {
      byte(0xc0 | (cp >> 6));
      byte(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      byte(0xe0 | (cp >> 12));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    } else {
      byte(0xf0 | (cp >> 18));
      byte(0x80 | ((cp >> 12) & 0x3f));
      byte(0x80 | ((cp >> 6) & 0x3f));
      byte(0x80 | (cp & 0x3f));
    }
  }
  return h.toString(16).padStart(8, "0");
}
