import { z } from "zod";
import type { Grant } from "../../model/model";
import type { Issue, Statement } from "../../types";
import { pascal } from "../sid";
import { prefixed, stmt, type Module, type ModulePreset } from "./types";

const TAG_KEY_RE = /^[\w .:/=+\-@]{1,128}$/;
const TAG_VALUE_RE = /^[\w .:/=+\-@]{0,256}$/;
const INSTANCE_ID_RE = /^i-[0-9a-f]{8,17}$/;

export const ec2DataSchema = z
  .object({
    selector: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("tag"),
        key: z.string().regex(TAG_KEY_RE, "not a valid tag key"),
        value: z.string().regex(TAG_VALUE_RE, "not a valid tag value"),
      }).strict(),
      z.object({
        type: z.literal("ids"),
        ids: z
          .array(z.string().regex(INSTANCE_ID_RE, "not a valid instance id"))
          .min(1, "add at least one instance id")
          .max(50, "at most 50 instance ids"),
      }).strict(),
      z.object({ type: z.literal("all") }).strict(),
    ]),
  })
  .strict();

export type Ec2Data = z.infer<typeof ec2DataSchema>;

const VIEW = [
  "DescribeInstances",
  "DescribeInstanceStatus",
  "DescribeTags",
  "DescribeInstanceTypes",
  "DescribeVolumes",
  "DescribeAvailabilityZones",
];

const PRESETS: ModulePreset[] = [
  { id: "view", label: "view", actions: VIEW },
  {
    id: "start-stop",
    label: "start + stop",
    actions: [...VIEW, "StartInstances", "StopInstances"],
  },
  {
    id: "start-stop-reboot",
    label: "start + stop + reboot",
    actions: [...VIEW, "StartInstances", "StopInstances", "RebootInstances"],
  },
  {
    id: "terminate",
    label: "terminate",
    actions: [...VIEW, "TerminateInstances"],
  },
  {
    id: "tags",
    label: "edit tags",
    actions: [...VIEW, "CreateTags", "DeleteTags"],
  },
];

const presetOf = (grant: Grant): string =>
  grant.access.type === "preset" ? grant.access.preset : "";
const presetActions = (preset: string): string[] =>
  PRESETS.find((p) => p.id === preset)?.actions ?? [];
const manageActions = (preset: string): string[] =>
  presetActions(preset).filter((a) => !VIEW.includes(a));

function build(
  grant: Grant,
  data: Ec2Data,
  region: string,
  account: string,
): { statements: Statement[]; issues: Issue[] } {
  const preset = presetOf(grant);
  const sid = `Ec2${pascal(preset)}`;
  const manage = manageActions(preset);
  const issues: Issue[] = [];
  const statements: Statement[] = [
    stmt(`${sid}View`, prefixed("ec2", VIEW), ["*"]),
  ];
  if (manage.length === 0) return { statements, issues };

  const base = `arn:aws:ec2:${region}:${account}:instance/`;
  const sel = data.selector;
  const resources =
    sel.type === "ids" ? sel.ids.map((id) => `${base}${id}`) : [`${base}*`];
  statements.push(
    stmt(
      `${sid}Manage`,
      prefixed("ec2", manage),
      resources,
      sel.type === "tag"
        ? {
            StringEquals: { [`aws:ResourceTag/${sel.key}`]: sel.value },
            // Stop the grant from retagging instances out of (or into) its own scope, in any letter case of the key.
            // DeleteTags without a tag list deletes every tag; require an explicit list.
            ...(preset === "tags"
              ? {
                  "ForAllValues:StringNotEqualsIgnoreCase": { "aws:TagKeys": [sel.key] },
                  Null: { "aws:TagKeys": "false" },
                }
              : {}),
          }
        : undefined,
    ),
  );
  if (manage.includes("StartInstances")) {
    issues.push({
      id: "I_EC2_KMS_GRANT",
      severity: "info",
      grantId: grant.id,
      message:
        "If the instances' EBS volumes use a customer managed KMS key, also allow kms:CreateGrant on that key (scope it with the condition kms:GrantIsForAWSResource = true). Without it the instance silently returns to stopped. The AWS managed aws/ebs key needs nothing extra.",
    });
  }
  if (sel.type === "all") {
    issues.push({
      id: "W_EC2_ALL_INSTANCES",
      severity: "warning",
      grantId: grant.id,
      message:
        "This applies to every EC2 instance in the account. Choose a tag or specific instance ids to narrow it.",
    });
  }
  return { statements, issues };
}

function explain(grant: Grant, data: Ec2Data): string {
  const preset = presetOf(grant);
  const verbs = [
    "view",
    ...manageActions(preset).map((a) =>
      a === "CreateTags" || a === "DeleteTags"
        ? "edit tags on"
        : a.replace("Instances", "").toLowerCase(),
    ),
  ];
  const uniq = [...new Set(verbs)].filter((v) => v !== "edit tags on");
  const tagEdit = verbs.includes("edit tags on");
  const parts = tagEdit ? [...uniq, "edit tags on"] : uniq;
  const joined =
    parts.length > 1
      ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1] as string}`
      : (parts[0] as string);
  const sel = data.selector;
  if (preset === "view") return "Can view EC2 instances.";
  if (sel.type === "all") {
    return `Can ${joined} ${tagEdit ? "" : "all "}EC2 instances.`.replace(
      "edit tags on EC2",
      "edit tags on all EC2",
    );
  }
  if (sel.type === "tag") {
    return `Can ${joined} EC2 instances tagged ${sel.key}=${sel.value}.`;
  }
  return `Can ${joined} EC2 instances ${sel.ids.join(", ")}.`;
}

export const ec2Module: Module<Ec2Data> = {
  id: "ec2",
  service: "ec2",
  label: "Amazon EC2",
  presets: PRESETS,
  dataSchema: ec2DataSchema,
  build: (grant, data, _svc, ctx) =>
    build(grant, data, ctx.region ?? "*", ctx.accountId ?? "*"),
  explain,
};
