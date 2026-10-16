import { describe, expect, it } from "vitest";
import { createEmptyModel, newGrantId, roleModelSchema } from "./model";

describe("roleModelSchema", () => {
  it("accepts the empty model", () => {
    const m = createEmptyModel();
    expect(roleModelSchema.parse(m)).toEqual(m);
    expect(m.name).toBe("rolecraft-role");
    expect(m.trust).toEqual({ kind: "service", service: "ec2" });
    expect(m.policyMode).toBe("managed");
  });
  it("rejects version 2", () => {
    expect(roleModelSchema.safeParse({ ...createEmptyModel(), version: 2 }).success).toBe(false);
  });
  it("rejects unknown trust kind", () => {
    const m = { ...createEmptyModel(), trust: { kind: "wat" } };
    expect(roleModelSchema.safeParse(m).success).toBe(false);
  });
  it("rejects partition aws-cn", () => {
    expect(roleModelSchema.safeParse({ ...createEmptyModel(), partition: "aws-cn" }).success).toBe(false);
  });
  it("rejects 101 grants", () => {
    const grants = Array.from({ length: 101 }, () => ({
      id: newGrantId(), service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] },
    }));
    expect(roleModelSchema.safeParse({ ...createEmptyModel(), grants }).success).toBe(false);
  });
  it("rejects unknown keys", () => {
    expect(roleModelSchema.safeParse({ ...createEmptyModel(), evil: 1 }).success).toBe(false);
  });
  it("rejects over-long strings, actions and arns", () => {
    const base = createEmptyModel();
    const grant = (over: object) => ({
      id: "g_1", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] }, ...over,
    });
    const ok = (g: object) => roleModelSchema.safeParse({ ...base, grants: [g] }).success;
    expect(ok(grant({}))).toBe(true);
    expect(ok(grant({ service: "x".repeat(2049) }))).toBe(false);
    expect(ok(grant({ access: { type: "actions", actions: Array(501).fill("s3:Get*") } }))).toBe(false);
    expect(ok(grant({ access: { type: "actions", actions: Array(500).fill("s3:Get*") } }))).toBe(true);
    expect(ok(grant({ scope: { type: "arns", arns: Array(201).fill("arn:aws:s3:::b") } }))).toBe(false);
    expect(ok(grant({ scope: { type: "module", data: { any: [1, "x"] } } }))).toBe(true);
    expect(ok(grant({ access: { type: "levels", levels: ["Nope"] } }))).toBe(false);
  });
});

describe("newGrantId", () => {
  it("is g_ plus 8 base36 chars and varies", () => {
    const a = newGrantId();
    expect(a).toMatch(/^g_[0-9a-z]{8}$/);
    expect(new Set(Array.from({ length: 50 }, newGrantId)).size).toBeGreaterThan(1);
  });
});
