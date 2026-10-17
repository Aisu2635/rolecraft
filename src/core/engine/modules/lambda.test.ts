import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { lambdaModule } from "./lambda";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["lambda"]);
const svc = { key: "lambda" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "lambda",
  module: "lambda",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(lambdaModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

const A = "arn:aws:lambda:us-east-1:123456789012:function:my-fn";

describe("lambda module", () => {
  it("is registered", () => {
    expect(MODULES["lambda"]).toBe(lambdaModule);
    expect(defaultBuilders()["lambda"]).toBeTypeOf("function");
  });

  it("invoke covers unqualified and qualified", () => {
    const r = run("invoke", { functionName: "my-fn" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      { Sid: "LambdaInvokeFunction", Effect: "Allow", Action: "lambda:InvokeFunction", Resource: [A, `${A}:*`] },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("read", () => {
    const r = run("read", { functionName: "my-fn" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "LambdaReadFunction",
        Effect: "Allow",
        Action: ["lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:ListVersionsByFunction"],
        Resource: "arn:aws:lambda:*:*:function:my-fn",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("deploy has no iam:PassRole", () => {
    const r = run("deploy", { functionName: "my-fn" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "LambdaDeployFunction",
        Effect: "Allow",
        Action: ["lambda:GetFunction", "lambda:PublishVersion", "lambda:UpdateFunctionCode"],
        Resource: A,
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects invalid names", () => {
    for (const functionName of ["", "a b", "a".repeat(65), "a:b"]) {
      const r = run("invoke", { functionName });
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("explains", () => {
    for (const p of ["invoke", "read", "deploy"]) {
      expect(lambdaModule.explain(grant(p, {}), { functionName: "f" })).toMatch(/^Can .*function f.*\.$/);
    }
  });
});
