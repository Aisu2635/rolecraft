import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { logsModule } from "./logs";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["logs"]);
const svc = { key: "logs" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "logs",
  module: "logs",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(logsModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

const G = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/app";

describe("logs module", () => {
  it("is registered", () => {
    expect(MODULES["logs"]).toBe(logsModule);
    expect(defaultBuilders()["logs"]).toBeTypeOf("function");
  });

  it("write splits stream and group resources", () => {
    const r = run("write", { logGroup: "/aws/app" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "LogsWriteStreams",
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: `${G}:*`,
      },
      { Sid: "LogsWriteGroup", Effect: "Allow", Action: "logs:CreateLogGroup", Resource: G },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("createGroup:false omits CreateLogGroup", () => {
    const r = run("write", { logGroup: "/aws/app", createGroup: false });
    expect(r.statements).toStrictEqual([
      {
        Sid: "LogsWriteStreams",
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:PutLogEvents"],
        Resource: `${G}:*`,
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("read splits resources", () => {
    const r = run("read", { logGroup: "/aws/app" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "LogsReadStreams",
        Effect: "Allow",
        Action: "logs:GetLogEvents",
        Resource: "arn:aws:logs:*:*:log-group:/aws/app:*",
      },
      {
        Sid: "LogsReadGroup",
        Effect: "Allow",
        Action: ["logs:DescribeLogStreams", "logs:FilterLogEvents"],
        Resource: "arn:aws:logs:*:*:log-group:/aws/app",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("read-write groups by resource", () => {
    const r = run("read-write", { logGroup: "/aws/app" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "LogsReadWriteStreams",
        Effect: "Allow",
        Action: ["logs:CreateLogStream", "logs:GetLogEvents", "logs:PutLogEvents"],
        Resource: `${G}:*`,
      },
      {
        Sid: "LogsReadWriteGroup",
        Effect: "Allow",
        Action: ["logs:CreateLogGroup", "logs:DescribeLogStreams", "logs:FilterLogEvents"],
        Resource: G,
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects invalid log groups", () => {
    for (const logGroup of ["", "a b", "a*", "a".repeat(513)]) {
      expect(run("write", { logGroup }).issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("explains", () => {
    for (const p of ["write", "read", "read-write"]) {
      expect(logsModule.explain(grant(p, {}), { logGroup: "g", createGroup: true })).toMatch(/^Can .*g\.$/);
    }
  });
});
