import type { ExportInput } from "../types";
import { build, moduleGrant } from "./cases";

/**
 * Tooling-only cases (no snapshots): branches the reference cases miss, exported by
 * `npm run export-fixtures` to tmp/exports/variant-<id>/ so the Layer-4 tools check them too.
 */
export const VARIANT_CASES: Record<string, () => ExportInput> = {
  "group-inline": () =>
    build({
      name: "analytics-inline",
      trust: { kind: "principal", target: "group", name: "analytics-team" },
      policyMode: "inline",
      grants: [moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] })],
    }),
  "user-inline-eks": () =>
    build({
      name: "deploy-bot-inline",
      trust: { kind: "principal", target: "user", name: "deploy-bot" },
      policyMode: "inline",
      grants: [moduleGrant("g1", "eks", "kubectl", { cluster: "prod" })],
    }),
  "role-inline-managed": () =>
    build({
      name: "lambda-worker",
      trust: { kind: "service", service: "lambda" },
      policyMode: "inline",
      grants: [moduleGrant("g1", "dynamodb", "read-write", { table: "jobs" })],
      managedPolicyArns: ["arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"],
    }),
  "role-two-eks": () =>
    build({
      name: "eks-multi",
      region: "eu-central-1",
      trust: { kind: "service", service: "ec2" },
      grants: [
        moduleGrant("g1", "eks", "kubectl", { cluster: "prod" }),
        moduleGrant("g2", "eks", "kubectl", { cluster: "staging" }),
      ],
    }),
  "group-managed-arns": () =>
    build({
      name: "analytics-managed",
      trust: { kind: "principal", target: "group", name: "analytics-team" },
      grants: [moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] })],
      managedPolicyArns: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
    }),
  "user-managed-only": () =>
    build({
      name: "auditor-managed",
      trust: { kind: "principal", target: "user", name: "auditor" },
      grants: [],
      managedPolicyArns: ["arn:aws:iam::aws:policy/SecurityAudit"],
    }),
  "ec2-inline": () =>
    build({
      name: "ec2-inline",
      trust: { kind: "service", service: "ec2" },
      policyMode: "inline",
      grants: [moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] })],
    }),
};
