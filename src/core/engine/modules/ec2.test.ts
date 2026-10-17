import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { ec2Module } from "./ec2";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["ec2"]);
const svc = { key: "ec2" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws" };
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "ec2",
  module: "ec2",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(ec2Module, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);
const tag = { type: "tag", key: "Env", value: "dev" };
const VIEW = [
  "ec2:DescribeAvailabilityZones",
  "ec2:DescribeInstanceStatus",
  "ec2:DescribeInstanceTypes",
  "ec2:DescribeInstances",
  "ec2:DescribeTags",
  "ec2:DescribeVolumes",
];

describe("ec2 module", () => {
  it("is registered", () => {
    expect(MODULES["ec2"]).toBe(ec2Module);
    expect(defaultBuilders()["ec2"]).toBeTypeOf("function");
  });

  it("view alone emits only the * statement", () => {
    const r = run("view", { selector: { type: "all" } });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      { Sid: "Ec2ViewView", Effect: "Allow", Action: VIEW, Resource: "*" },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("start-stop with tag selector", () => {
    const r = run(
      "start-stop",
      { selector: tag },
      { partition: "aws", region: "eu-west-1", accountId: "123456789012" },
    );
    expect(r.statements).toStrictEqual([
      { Sid: "Ec2StartStopView", Effect: "Allow", Action: VIEW, Resource: "*" },
      {
        Sid: "Ec2StartStopManage",
        Effect: "Allow",
        Action: ["ec2:StartInstances", "ec2:StopInstances"],
        Resource: "arn:aws:ec2:eu-west-1:123456789012:instance/*",
        Condition: { StringEquals: { "aws:ResourceTag/Env": "dev" } },
      },
    ]);
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["I_EC2_KMS_GRANT", "info"]]);
    expect(r.issues[0]?.message).toBe(
      "If the instances' EBS volumes use a customer managed KMS key, also allow kms:CreateGrant on that key (scope it with the condition kms:GrantIsForAWSResource = true). Without it the instance silently returns to stopped. The AWS managed aws/ebs key needs nothing extra.",
    );
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("ids become instance ARNs", () => {
    const r = run("start-stop-reboot", {
      selector: { type: "ids", ids: ["i-0123456789abcdef0", "i-01234567"] },
    });
    expect(r.statements[1]).toStrictEqual({
      Sid: "Ec2StartStopRebootManage",
      Effect: "Allow",
      Action: ["ec2:RebootInstances", "ec2:StartInstances", "ec2:StopInstances"],
      Resource: [
        "arn:aws:ec2:*:*:instance/i-01234567",
        "arn:aws:ec2:*:*:instance/i-0123456789abcdef0",
      ],
    });
    expect(r.issues.map((i) => i.id)).toStrictEqual(["I_EC2_KMS_GRANT"]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("terminate with all warns", () => {
    const r = run("terminate", { selector: { type: "all" } });
    expect(r.statements[1]).toStrictEqual({
      Sid: "Ec2TerminateManage",
      Effect: "Allow",
      Action: "ec2:TerminateInstances",
      Resource: "arn:aws:ec2:*:*:instance/*",
    });
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([
      ["W_EC2_ALL_INSTANCES", "warning"],
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("tags with tag selector uses aws:ResourceTag", () => {
    const r = run("tags", { selector: tag });
    expect(r.statements[1]).toStrictEqual({
      Sid: "Ec2TagsManage",
      Effect: "Allow",
      Action: ["ec2:CreateTags", "ec2:DeleteTags"],
      Resource: "arn:aws:ec2:*:*:instance/*",
      Condition: {
        StringEquals: { "aws:ResourceTag/Env": "dev" },
        "ForAllValues:StringNotEquals": { "aws:TagKeys": ["Env"] },
      },
    });
    expect(r.issues).toStrictEqual([]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  const selectors: [string, unknown][] = [
    ["tag", tag],
    ["all", { type: "all" }],
    ["ids", { type: "ids", ids: ["i-0123456789abcdef0"] }],
  ];
  const cases = ["view", "start-stop", "start-stop-reboot", "terminate", "tags"].flatMap(
    (p) => selectors.map(([n, selector]) => [p, n, selector] as const),
  );
  it.each(cases)("preset %s with %s selector validates", (p, _n, selector) => {
    expect(valid(run(p, { selector }).statements)).toStrictEqual([]);
  });

  it("rejects invalid data", () => {
    const bad = (selector: unknown) => run("view", { selector }).issues[0]?.id;
    expect(bad({ type: "ids", ids: ["i-XYZ"] })).toBe("E_MODULE_DATA");
    expect(bad({ type: "ids", ids: [] })).toBe("E_MODULE_DATA");
    expect(bad({ type: "all", ids: ["i-0123456789abcdef0"] })).toBe("E_MODULE_DATA");
    expect(bad({ type: "tag", key: "", value: "x" })).toBe("E_MODULE_DATA");
    expect(bad({ type: "tag", key: "k", value: "a*" })).toBe("E_MODULE_DATA");
  });

  it("explains", () => {
    const e = (p: string, selector: unknown) =>
      ec2Module.explain(grant(p, {}), { selector } as never);
    expect(e("view", { type: "all" })).toBe("Can view EC2 instances.");
    expect(e("start-stop", { type: "tag", key: "Env", value: "dev" })).toBe(
      "Can view, start and stop EC2 instances tagged Env=dev.",
    );
    expect(e("terminate", { type: "ids", ids: ["i-01234567"] })).toBe(
      "Can view and terminate EC2 instances i-01234567.",
    );
    expect(e("tags", { type: "all" })).toBe("Can view and edit tags on all EC2 instances.");
    expect(e("start-stop-reboot", { type: "all" })).toBe(
      "Can view, start, stop and reboot all EC2 instances.",
    );
  });
});
