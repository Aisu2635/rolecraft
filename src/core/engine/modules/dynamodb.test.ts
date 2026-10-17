import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { dynamodbModule } from "./dynamodb";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["dynamodb"]);
const svc = { key: "dynamodb" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "dynamodb",
  module: "dynamodb",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(dynamodbModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

const T = "arn:aws:dynamodb:us-east-1:123456789012:table/Orders";

describe("dynamodb module", () => {
  it("is registered", () => {
    expect(MODULES["dynamodb"]).toBe(dynamodbModule);
    expect(defaultBuilders()["dynamodb"]).toBeTypeOf("function");
  });

  it("read: index ARN only on Query/Scan", () => {
    const r = run("read", { table: "Orders" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "DynamodbReadTable",
        Effect: "Allow",
        Action: [
          "dynamodb:BatchGetItem",
          "dynamodb:ConditionCheckItem",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
        ],
        Resource: T,
      },
      {
        Sid: "DynamodbReadIndex",
        Effect: "Allow",
        Action: ["dynamodb:Query", "dynamodb:Scan"],
        Resource: `${T}/index/*`,
      },
    ]);
    expect(JSON.stringify(r.statements[0])).not.toContain("/index/");
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("includeIndexes:false has no index ARN", () => {
    const r = run("read", { table: "Orders", includeIndexes: false });
    expect(r.statements).toHaveLength(1);
    expect(JSON.stringify(r.statements)).not.toContain("/index/");
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("write has no index statement", () => {
    const r = run("write", { table: "Orders" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "DynamodbWriteTable",
        Effect: "Allow",
        Action: [
          "dynamodb:BatchWriteItem",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
        ],
        Resource: "arn:aws:dynamodb:*:*:table/Orders",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("read-write is the union", () => {
    const r = run("read-write", { table: "Orders" });
    expect(r.statements[0]?.Action).toHaveLength(10);
    expect(r.statements[1]?.Sid).toBe("DynamodbReadWriteIndex");
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects invalid tables and unknown keys", () => {
    for (const data of [{ table: "ab" }, { table: "a/b/c" }, { table: "Orders", x: 1 }]) {
      expect(run("read", data).issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("explains", () => {
    for (const p of ["read", "write", "read-write"]) {
      expect(dynamodbModule.explain(grant(p, {}), { table: "T", includeIndexes: true })).toMatch(/^Can .*T\.$/);
    }
  });
});
