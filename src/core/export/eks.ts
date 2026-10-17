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
