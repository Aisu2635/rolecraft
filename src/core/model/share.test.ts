import fc from "fast-check";
import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";
import { createEmptyModel, roleModelSchema, type RoleModel } from "./model";
import { decodeModel, encodeModel, readModelFromHash } from "./share";

function full(): RoleModel {
  return {
    ...createEmptyModel(),
    accountId: "123456789012",
    region: "us-east-1",
    trust: { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "main" } },
    managedPolicyArns: ["arn:aws:iam::aws:policy/ReadOnlyAccess"],
    grants: [
      { id: "g_aaaaaaaa", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read", "List"] } },
      { id: "g_bbbbbbbb", service: "s3", module: "m", scope: { type: "arns", arns: ["arn:aws:s3:::b/*"] }, access: { type: "actions", actions: ["s3:GetObject"] } },
      { id: "g_cccccccc", service: "x", scope: { type: "module", data: { a: [1, null, "z"] } }, access: { type: "preset", preset: "p" } },
    ],
  };
}

describe("share url", () => {
  it("round-trips the empty model", () => {
    const m = createEmptyModel();
    expect(decodeModel(encodeModel(m))).toEqual(m);
  });
  it("round-trips a model with every scope/access type", () => {
    const m = full();
    expect(decodeModel(encodeModel(m))).toEqual(m);
  });
  it("returns null for garbage", () => {
    expect(decodeModel("garbage!!")).toBeNull();
    expect(decodeModel("")).toBeNull();
  });
  it("returns null for schema-invalid JSON", () => {
    expect(decodeModel(compressToEncodedURIComponent(JSON.stringify({ version: 2 })))).toBeNull();
  });
  it("returns null for non-JSON payload", () => {
    expect(decodeModel(compressToEncodedURIComponent("not json {"))).toBeNull();
  });
  it("rejects injected extra fields", () => {
    const bad = { ...createEmptyModel(), extra: "x" };
    expect(decodeModel(compressToEncodedURIComponent(JSON.stringify(bad)))).toBeNull();
  });
  it("rejects inputs over 100,000 characters", () => {
    expect(decodeModel("A".repeat(100_001))).toBeNull();
  });
  it("reads from the hash", () => {
    const m = full();
    expect(readModelFromHash("#s=" + encodeModel(m))).toEqual(m);
    expect(readModelFromHash("#x=1")).toBeNull();
    expect(readModelFromHash("")).toBeNull();
  });
  it("decodeModel never throws", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        const r = decodeModel(s);
        expect(r === null || roleModelSchema.safeParse(r).success).toBe(true);
      }),
      { numRuns: 500 },
    );
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (s) => {
        expect(() => decodeModel(s)).not.toThrow();
      }),
    );
  });
});
