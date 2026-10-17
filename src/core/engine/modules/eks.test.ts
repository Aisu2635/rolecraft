import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { eksModule } from "./eks";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["eks"]);
const svc = { key: "eks" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "eks",
  module: "eks",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(eksModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

describe("eks module", () => {
  it("is registered", () => {
    expect(MODULES["eks"]).toBe(eksModule);
    expect(defaultBuilders()["eks"]).toBeTypeOf("function");
  });

  it("describe", () => {
    const r = run("describe", { cluster: "prod" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "EksDescribeCluster",
        Effect: "Allow",
        Action: "eks:DescribeCluster",
        Resource: "arn:aws:eks:us-east-1:123456789012:cluster/prod",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("kubectl adds ListClusters and an info issue", () => {
    const r = run("kubectl", { cluster: "prod-1_a" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "EksKubectlCluster",
        Effect: "Allow",
        Action: "eks:DescribeCluster",
        Resource: "arn:aws:eks:*:*:cluster/prod-1_a",
      },
      { Sid: "EksKubectlList", Effect: "Allow", Action: "eks:ListClusters", Resource: "*" },
    ]);
    expect(r.issues).toStrictEqual([
      {
        id: "I_EKS_ACCESS_ENTRY",
        severity: "info",
        grantId: "g1",
        message:
          "kubectl access also needs an EKS access entry or aws-auth mapping for this role — the CLI export includes it.",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects invalid data", () => {
    expect(run("describe", { cluster: "my cluster" }).issues[0]?.id).toBe("E_MODULE_DATA");
    expect(run("describe", { cluster: "-x" }).issues[0]?.id).toBe("E_MODULE_DATA");
  });

  it("explains", () => {
    const d = { cluster: "prod" };
    expect(eksModule.explain(grant("describe", d), d)).toBe("Can describe the EKS cluster prod.");
    expect(eksModule.explain(grant("kubectl", d), d)).toBe(
      "Can describe the EKS cluster prod and list clusters, to configure kubectl.",
    );
  });
});
