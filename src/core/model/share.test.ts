import fc from "fast-check";
import { compressToEncodedURIComponent } from "lz-string";
import { describe, expect, it } from "vitest";
import { createEmptyModel, roleModelSchema, type RoleModel } from "./model";
import { decodeModel, encodeModel, MAX_SHARE_LENGTH, readModelFromHash } from "./share";

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
  it("exports the 8,192-character limit", () => {
    expect(MAX_SHARE_LENGTH).toBe(8_192);
  });
  it("rejects inputs over 8,192 characters", () => {
    expect(decodeModel("A".repeat(8_193))).toBeNull();
  });
  it("rejects a valid model whose encoding exceeds 8,192 characters", () => {
    let seed = 7;
    const rnd = (): string => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed.toString(36);
    };
    const m = full();
    m.managedPolicyArns = Array.from({ length: 400 }, () => rnd() + rnd() + rnd() + rnd());
    const enc = encodeModel(m);
    expect(enc.length).toBeGreaterThan(8_192);
    expect(roleModelSchema.safeParse(m).success).toBe(true);
    expect(decodeModel(enc)).toBeNull();
  });
  it("still round-trips a realistic 20-grant model within the limit", () => {
    const m = createEmptyModel();
    m.grants = Array.from({ length: 20 }, (_, i) => ({
      id: `g_${String(i).padStart(8, "0")}`,
      service: ["s3", "ec2", "iam", "sqs"][i % 4] as string,
      scope: { type: "arns" as const, arns: [`arn:aws:s3:::bucket-${i}/*`] },
      access: { type: "levels" as const, levels: ["Read" as const, "List" as const] },
    }));
    const enc = encodeModel(m);
    expect(enc.length).toBeLessThan(8_192);
    expect(decodeModel(enc)).toEqual(m);
  });
  it("rejects a small payload that decompresses past 262,144 characters, quickly", () => {
    const enc = compressToEncodedURIComponent("a".repeat(300_000));
    expect(enc.length).toBeLessThan(8_192);
    const t = performance.now();
    expect(decodeModel(enc)).toBeNull();
    expect(performance.now() - t).toBeLessThan(200);
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
