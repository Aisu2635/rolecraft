import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { MODULES, defaultBuilders } from "./registry";
import { secretsmanagerModule } from "./secretsmanager";
import { runModule } from "./types";

const catalog = loadRealCatalog(["secretsmanager", "kms"]);
const svc = { key: "secretsmanager" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const KEY = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "secretsmanager",
  module: "secretsmanager",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown, c: BuildContext = ctx) =>
  runModule(secretsmanagerModule, grant(preset, data), svc, c);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

describe("secretsmanager module", () => {
  it("is registered", () => {
    expect(MODULES["secretsmanager"]).toBe(secretsmanagerModule);
    expect(defaultBuilders()["secretsmanager"]).toBeTypeOf("function");
  });

  it("read: secret ARN ends with -??????", () => {
    const r = run("read", { secretName: "prod/db" });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      {
        Sid: "SecretsmanagerReadSecret",
        Effect: "Allow",
        Action: ["secretsmanager:DescribeSecret", "secretsmanager:GetSecretValue"],
        Resource: "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-??????",
      },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("wildcards region and account when unknown", () => {
    const r = run("read", { secretName: "x" }, { partition: "aws" });
    expect(r.statements[0]?.Resource).toBe("arn:aws:secretsmanager:*:*:secret:x-??????");
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("kmsKeyArn adds a kms:Decrypt statement", () => {
    const r = run("read", { secretName: "prod/db", kmsKeyArn: KEY });
    expect(r.statements[1]).toStrictEqual({
      Sid: "SecretsmanagerReadKms",
      Effect: "Allow",
      Action: "kms:Decrypt",
      Resource: KEY,
    });
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects bad names, keys and unknown fields", () => {
    for (const data of [
      { secretName: "" },
      { secretName: "a b" },
      { secretName: "a*" },
      { secretName: "a".repeat(513) },
      { secretName: "a", kmsKeyArn: "*" },
      { secretName: "a", extra: 1 },
    ]) {
      const r = run("read", data);
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("warns when the name looks pasted with the random suffix", () => {
    const r = run("read", { secretName: "prod/db-AbC12x" });
    expect(r.issues).toStrictEqual([
      {
        id: "W_SECRET_SUFFIX",
        severity: "warning",
        grantId: "g1",
        message:
          "If -AbC12x is the random suffix Secrets Manager added, remove it from the name — otherwise this policy never matches.",
      },
    ]);
    expect(run("read", { secretName: "prod/db" }).issues).toStrictEqual([]);
    expect(run("read", { secretName: "prod/db-abc" }).issues).toStrictEqual([]);
  });

  it("explains", () => {
    expect(secretsmanagerModule.explain(grant("read", {}), { secretName: "prod/db" })).toBe(
      "Can read the value of the secret prod/db.",
    );
  });
});
