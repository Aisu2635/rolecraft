import { describe, expect, it } from "vitest";
import { createCatalog } from "../catalog/catalog";
import { loadRealCatalog } from "../engine/modules/__test__/catalog";
import { createEmptyModel, type Grant, type RoleModel } from "../model/model";
import type { SlimService } from "../types";
import { explain } from "./explain";

const catalog = loadRealCatalog(["s3", "ec2", "textract", "iam"]);
const model = (grants: Grant[]): RoleModel => ({ ...createEmptyModel(), grants });
const s3Grant = (preset: string, data: unknown = { bucket: "data-lake", prefixes: ["reports/"] }): Grant => ({
  id: "g1",
  service: "s3",
  module: "s3",
  scope: { type: "module", data },
  access: { type: "preset", preset },
});

describe("explain", () => {
  it("empty model", () => {
    expect(explain(model([]), catalog)).toStrictEqual({ can: [], cannot: [] });
  });

  it("s3 list-read module", () => {
    const r = explain(model([s3Grant("list-read")]), catalog);
    expect(r.can).toHaveLength(1);
    expect(r.can[0]).toMatch(/^Can /);
    expect(r.cannot).toStrictEqual([
      "Cannot change Amazon S3 permissions.",
      "Cannot delete Amazon S3 resources.",
    ]);
  });

  it("generic textract Read", () => {
    const r = explain(
      model([{ id: "g", service: "textract", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } }]),
      catalog,
    );
    expect(r.can).toStrictEqual(["Can read on Amazon Textract (all resources)."]);
    expect(r.cannot).toStrictEqual([
      "Cannot change Amazon Textract permissions.",
      "Cannot delete Amazon Textract resources.",
    ]);
  });

  it("joins levels and counts resources", () => {
    const g = (arns: string[]): Grant => ({
      id: "g",
      service: "s3",
      scope: { type: "arns", arns },
      access: { type: "levels", levels: ["Write", "List", "Read"] },
    });
    expect(explain(model([g(["arn:aws:s3:::a"])]), catalog).can).toStrictEqual([
      "Can list, read and write on Amazon S3 (1 specific resource).",
    ]);
    expect(explain(model([g(["arn:aws:s3:::a", "arn:aws:s3:::b"])]), catalog).can[0]).toContain(
      "(2 specific resources)",
    );
    const one = explain(
      model([{ ...g(["x"]), access: { type: "levels", levels: ["Read"] } }]),
      catalog,
    );
    expect(one.can[0]).toBe("Can read on Amazon S3 (1 specific resource).");
  });

  it("explicit actions", () => {
    const names = ["GetObject", "PutObject", "ListBucket", "DeleteObject"];
    const r = explain(
      model([{ id: "g", service: "s3", scope: { type: "all" }, access: { type: "actions", actions: names } }]),
      catalog,
    );
    expect(r.can).toHaveLength(1);
    expect(r.can[0]).toMatch(/^Can use 4 Amazon S3 actions: .+…$/);
    expect(r.cannot).toStrictEqual(["Cannot change Amazon S3 permissions."]);
    const small = explain(
      model([{ id: "g", service: "s3", scope: { type: "all" }, access: { type: "actions", actions: ["GetObject"] } }]),
      catalog,
    );
    expect(small.can[0]).toMatch(/^Can use 1 Amazon S3 actions: [^…]+\.$/);
  });

  it("granting permissions management / delete suppresses cannot", () => {
    const r = explain(
      model([{ id: "g", service: "iam", scope: { type: "all" }, access: { type: "actions", actions: ["DeleteRole", "PutRolePolicy"] } }]),
      catalog,
    );
    expect(r.cannot).toStrictEqual([]);
  });

  it("ec2 start-stop cannot terminate", () => {
    const g = (preset: string): Grant => ({
      id: "g",
      service: "ec2",
      module: "ec2",
      scope: { type: "module", data: { selector: { type: "all" } } },
      access: { type: "preset", preset },
    });
    const r = explain(model([g("start-stop")]), catalog);
    expect(r.cannot).toContain("Cannot terminate EC2 instances.");
    const t = explain(model([g("terminate")]), catalog);
    expect(t.cannot).not.toContain("Cannot terminate EC2 instances.");
  });

  it("orders services by name and dedupes", () => {
    const gen = (service: string): Grant => ({
      id: service,
      service,
      scope: { type: "all" },
      access: { type: "levels", levels: ["Read"] },
    });
    const r = explain(model([gen("textract"), gen("s3"), gen("s3"), gen("nope")]), catalog);
    expect(r.cannot.map((c) => c.split(" ").slice(2, 4).join(" "))).toStrictEqual([
      "Amazon S3",
      "Amazon S3",
      "Amazon Textract",
      "Amazon Textract",
    ]);
  });

  it("skips invalid module data, unknown module, unknown service, empty selections", () => {
    const bad = s3Grant("list-read", { bucket: "X" });
    const unknownMod: Grant = { ...s3Grant("list-read"), module: "zzz" };
    const noSvc: Grant = { id: "n", service: "nope", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } };
    const empty: Grant = { id: "e", service: "s3", scope: { type: "all" }, access: { type: "levels", levels: [] } };
    const preset: Grant = { id: "p", service: "s3", scope: { type: "all" }, access: { type: "preset", preset: "x" } };
    const modNotModuleScope: Grant = { ...s3Grant("list-read"), scope: { type: "all" } };
    const r = explain(model([bad, unknownMod, noSvc, empty, preset, modNotModuleScope]), catalog);
    expect(r.can).toStrictEqual([]);
  });

  it("never throws", () => {
    const weird = { id: "w", service: "s3", scope: { type: "arns" }, access: { type: "levels", levels: ["Read"] } } as unknown as Grant;
    expect(() => explain(model([weird]), catalog)).not.toThrow();
    const svc = { key: "boom", name: "Boom", actions: null } as unknown as SlimService;
    const bad = createCatalog([svc]);
    const g: Grant = { id: "b", service: "boom", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } };
    expect(() => explain(model([g]), bad)).not.toThrow();
  });
});

describe("explain cannot for odd module grants", () => {
  it("module grant with non-preset or unknown preset grants nothing", () => {
    const base = s3Grant("list-read");
    const levels: Grant = { ...base, access: { type: "levels", levels: ["Read"] } };
    const unknown: Grant = { ...base, access: { type: "preset", preset: "zzz" } };
    const r = explain(model([levels, unknown]), catalog);
    expect(r.cannot).toStrictEqual([
      "Cannot change Amazon S3 permissions.",
      "Cannot delete Amazon S3 resources.",
    ]);
  });
});
