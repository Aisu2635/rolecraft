import { describe, expect, it } from "vitest";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService, Statement } from "../../types";
import { validateIdentityPolicy } from "../../validate/policy";
import { loadRealCatalog } from "./__test__/catalog";
import { kmsModule } from "./kms";
import { MODULES, defaultBuilders } from "./registry";
import { runModule } from "./types";

const catalog = loadRealCatalog(["kms"]);
const svc = { key: "kms" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws", region: "us-east-1", accountId: "123456789012" };
const KEY = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
const grant = (preset: string, data: unknown): Grant => ({
  id: "g1",
  service: "kms",
  module: "kms",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});
const run = (preset: string, data: unknown) => runModule(kmsModule, grant(preset, data), svc, ctx);
const valid = (statements: Statement[]) =>
  validateIdentityPolicy({ Version: "2012-10-17", Statement: statements }, catalog);

describe("kms module", () => {
  it("is registered", () => {
    expect(MODULES["kms"]).toBe(kmsModule);
    expect(defaultBuilders()["kms"]).toBeTypeOf("function");
  });

  it.each([
    ["encrypt", "KmsEncryptKey", ["kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"]],
    ["decrypt", "KmsDecryptKey", ["kms:Decrypt", "kms:DescribeKey"]],
    [
      "encrypt-decrypt",
      "KmsEncryptDecryptKey",
      ["kms:Decrypt", "kms:DescribeKey", "kms:Encrypt", "kms:GenerateDataKey"],
    ],
  ])("%s", (preset, sid, actions) => {
    const r = run(preset, { keyArn: KEY });
    expect(r.issues).toStrictEqual([]);
    expect(r.statements).toStrictEqual([
      { Sid: sid, Effect: "Allow", Action: actions, Resource: KEY },
    ]);
    expect(valid(r.statements)).toStrictEqual([]);
  });

  it("rejects * and malformed key ARNs with E_MODULE_DATA", () => {
    for (const keyArn of ["*", "arn:aws:kms:us-east-1:123456789012:key/*", "alias/foo", ""]) {
      const r = run("decrypt", { keyArn });
      expect(r.statements).toStrictEqual([]);
      expect(r.issues[0]?.id).toBe("E_MODULE_DATA");
    }
  });

  it("explains each preset", () => {
    const e = (p: string) => kmsModule.explain(grant(p, {}), { keyArn: KEY });
    expect(e("encrypt")).toBe(`Can encrypt data with the KMS key ${KEY}.`);
    expect(e("decrypt")).toBe(`Can decrypt data with the KMS key ${KEY}.`);
    expect(e("encrypt-decrypt")).toBe(`Can encrypt and decrypt data with the KMS key ${KEY}.`);
  });
});
