import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { MODULES, defaultBuilders } from "./registry";
import { sqsModule } from "./sqs";
import { runModule } from "./types";

const catalog = loadRealCatalog(["sqs", "kms"]);
const svc = { key: "sqs" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const KEY = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const Q = "arn:aws:sqs:us-east-1:123456789012:jobs";
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "sqs",
  module: "sqs",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(sqsModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

describe("sqs module", () => {
  it("is registered", () => {
    expect(MODULES["sqs"]).toBe(sqsModule);
    expect(defaultBuilders()["sqs"]).toBeTypeOf("function");
  });

  it("send", () => {
    const r = run("send", { queueName: "jobs" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "SqsSendQueue",
        Effect: "Allow",
        Action: ["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:SendMessage"],
        Resource: Q,
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("receive", () => {
    const r = run("receive", { queueName: "jobs" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "SqsReceiveQueue",
        Effect: "Allow",
        Action: [
          "sqs:ChangeMessageVisibility",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
        ],
        Resource: Q,
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("send-receive is the union; fifo name accepted; wildcards when unknown", () => {
    const r = run("send-receive", { queueName: "jobs.fifo" }, { partition: "aws" });
    expect(r.statements).toStrictEqual([
      {
        Sid: "SqsSendReceiveQueue",
        Effect: "Allow",
        Action: [
          "sqs:ChangeMessageVisibility",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
          "sqs:SendMessage",
        ],
        Resource: "arn:aws:sqs:*:*:jobs.fifo",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it.each([
    ["send", "SqsSendKms", ["kms:Decrypt", "kms:GenerateDataKey"]],
    ["receive", "SqsReceiveKms", "kms:Decrypt"],
    ["send-receive", "SqsSendReceiveKms", ["kms:Decrypt", "kms:GenerateDataKey"]],
  ])("kms add-on for %s", (preset, sid, action) => {
    const r = run(preset, { queueName: "jobs", kmsKeyArn: KEY });
    expect(r.statements).toHaveLength(2);
    expect(r.statements[1]).toStrictEqual({
      Sid: sid,
      Effect: "Allow",
      Action: action,
      Resource: KEY,
    });
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects bad names, keys and unknown fields", () => {
    for (const data of [
      { queueName: "" },
      { queueName: "a".repeat(81) },
      { queueName: "a b" },
      { queueName: "a*" },
      { queueName: "a.fifo.fifo" },
      { queueName: "a", kmsKeyArn: "*" },
      { queueName: "a", extra: 1 },
    ]) {
      const r = run("send", data);
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("explains each preset", () => {
    const e = (p: string) => sqsModule.explain(grant(p, {}), { queueName: "jobs" });
    expect(e("send")).toBe("Can send messages to the queue jobs.");
    expect(e("receive")).toBe("Can receive and delete messages from the queue jobs.");
    expect(e("send-receive")).toBe("Can send, receive and delete messages on the queue jobs.");
  });
});
