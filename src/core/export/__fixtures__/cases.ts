import { loadRealCatalog } from "../../engine/modules/__test__/catalog";
import { explain } from "../../explain/explain";
import { generate } from "../../generate";
import { createEmptyModel, type Grant, type RoleModel } from "../../model/model";
import type { ExportInput } from "../types";

const catalog = loadRealCatalog(["s3", "ec2", "lambda", "dynamodb", "logs", "eks", "cloudfront", "textract"]);

const moduleGrant = (id: string, mod: string, preset: string, data: unknown): Grant => ({
  id,
  service: mod,
  module: mod,
  scope: { type: "module", data },
  access: { type: "preset", preset },
});

function build(over: Partial<RoleModel>): ExportInput {
  const model: RoleModel = { ...createEmptyModel(), ...over };
  return { model, result: generate(model, catalog), summary: explain(model, catalog) };
}

export const REFERENCE_CASES: Record<string, () => ExportInput> = {
  "s3-group": () =>
    build({
      name: "analytics-reader",
      trust: { kind: "principal", target: "group", name: "analytics-team" },
      grants: [moduleGrant("g1", "s3", "list-read", { bucket: "data-lake", prefixes: ["reports/"] })],
    }),
  "ec2-ssm": () =>
    build({
      name: "ec2-ops",
      trust: { kind: "service", service: "ec2" },
      grants: [
        moduleGrant("g1", "ec2", "start-stop", {
          selector: { type: "tag", key: "Env", value: "dev" },
        }),
      ],
      managedPolicyArns: ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"],
    }),
  "github-deploy": () =>
    build({
      name: "github-deploy",
      accountId: "123456789012",
      trust: { kind: "github", owner: "omhinge", repo: "site", ref: { type: "branch", value: "main" } },
      grants: [
        moduleGrant("g1", "s3", "read-write", { bucket: "site-assets", prefixes: [""] }),
        {
          id: "g2",
          service: "cloudfront",
          scope: { type: "arns", arns: ["arn:aws:cloudfront::123456789012:distribution/E2EXAMPLE"] },
          access: { type: "actions", actions: ["CreateInvalidation"] },
        },
      ],
    }),
  "lambda-api": () =>
    build({
      name: "lambda-api",
      trust: { kind: "service", service: "lambda" },
      policyMode: "inline",
      grants: [
        moduleGrant("g1", "lambda", "invoke", { functionName: "orders-api" }),
        moduleGrant("g2", "dynamodb", "read-write", { table: "orders" }),
        moduleGrant("g3", "logs", "write", { logGroup: "/aws/lambda/orders-api" }),
      ],
    }),
  "cross-account": () =>
    build({
      name: "audit-reader",
      trust: { kind: "account", accountId: "210987654321", externalId: "rolecraft-ext-01", requireMfa: true },
      grants: [
        {
          id: "g1",
          service: "textract",
          scope: { type: "all" },
          access: { type: "levels", levels: ["Read"] },
        },
      ],
    }),
  "eks-kubectl": () =>
    build({
      name: "eks-admin-cli",
      trust: { kind: "service", service: "ec2" },
      grants: [moduleGrant("g1", "eks", "kubectl", { cluster: "prod" })],
    }),
};
