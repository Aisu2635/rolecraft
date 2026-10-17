import { z } from "zod";
import type { Grant } from "../../model/model";
import type { Issue, Statement } from "../../types";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

export const eksDataSchema = z
  .object({
    cluster: z
      .string()
      .regex(/^[0-9A-Za-z][A-Za-z0-9\-_]{0,99}$/, "not a valid EKS cluster name"),
  })
  .strict();

export type EksData = z.infer<typeof eksDataSchema>;

const PRESETS: ModulePreset[] = [
  { id: "describe", label: "describe", actions: ["DescribeCluster"] },
  {
    id: "kubectl",
    label: "kubectl access",
    actions: ["DescribeCluster", "ListClusters"],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";

export const eksModule: Module<EksData> = {
  id: "eks",
  service: "eks",
  label: "Amazon EKS",
  presets: PRESETS,
  dataSchema: eksDataSchema,
  build: (grant, data, _svc, ctx) => {
    const preset = presetOf(grant);
    const sid = `Eks${pascal(preset)}`;
    const statements: Statement[] = [
      stmt(`${sid}Cluster`, prefixed("eks", ["DescribeCluster"]), [
        `arn:aws:eks:${ctx.region ?? "*"}:${ctx.accountId ?? "*"}:cluster/${data.cluster}`,
      ]),
    ];
    const issues: Issue[] = [];
    if (preset === "kubectl") {
      statements.push(stmt(`${sid}List`, ["eks:ListClusters"], ["*"]));
      issues.push({
        id: "I_EKS_ACCESS_ENTRY",
        severity: "info",
        grantId: grant.id,
        message:
          "kubectl access also needs an EKS access entry or aws-auth mapping for this role — the CLI export includes it.",
      });
    }
    return { statements, issues };
  },
  explain: (grant, data) =>
    presetOf(grant) === "kubectl"
      ? `Can describe the EKS cluster ${data.cluster} and list clusters, to configure kubectl.`
      : `Can describe the EKS cluster ${data.cluster}.`,
};
