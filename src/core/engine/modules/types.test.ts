import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { BuildContext } from "../../arn";
import type { Grant } from "../../model/model";
import type { SlimService } from "../../types";
import { prefixed, runModule, stmt, type Module } from "./types";
import { MODULES, defaultBuilders } from "./registry";
import { loadRealCatalog } from "./__test__/catalog";

const mod: Module<Record<string, never>> = {
  id: "textract",
  service: "textract",
  label: "Amazon Textract",
  presets: [{ id: "analyze", label: "Analyze", actions: ["AnalyzeDocument"] }],
  dataSchema: z.object({}).strict(),
  build: () => ({
    statements: [stmt("TextractAnalyzeAll", prefixed("textract", ["AnalyzeDocument"]), ["*"])],
    issues: [],
  }),
  explain: () => "Can analyze documents.",
};
const svc = { key: "textract" } as unknown as SlimService;
const ctx: BuildContext = { partition: "aws" };
const grant = (over: Partial<Grant>): Grant => ({
  id: "g1",
  service: "textract",
  module: "textract",
  scope: { type: "module", data: {} },
  access: { type: "preset", preset: "analyze" },
  ...over,
});

describe("runModule", () => {
  it("rejects unknown preset", () => {
    const r = runModule(mod, grant({ access: { type: "preset", preset: "nope" } }), svc, ctx);
    expect(r.statements).toEqual([]);
    expect(r.issues[0]).toMatchObject({ id: "E_MODULE_PRESET", severity: "error", grantId: "g1" });
  });
  it("rejects levels access", () => {
    const r = runModule(mod, grant({ access: { type: "levels", levels: ["Read"] } }), svc, ctx);
    expect(r.issues[0]?.id).toBe("E_MODULE_PRESET");
  });
  it("rejects non-module scope", () => {
    const r = runModule(mod, grant({ scope: { type: "all" } }), svc, ctx);
    expect(r.issues[0]).toMatchObject({ id: "E_MODULE_SCOPE", severity: "error", grantId: "g1" });
  });
  it("reports schema failure with data path", () => {
    const r = runModule(mod, grant({ scope: { type: "module", data: { x: 1 } } }), svc, ctx);
    expect(r.issues[0]).toMatchObject({ id: "E_MODULE_DATA", grantId: "g1" });
    expect(r.issues[0]?.path?.startsWith("data")).toBe(true);
  });
  it("prefixes nested zod paths", () => {
    const nested = {
      ...mod,
      dataSchema: z.object({ a: z.object({ b: z.string() }) }),
      build: () => ({ statements: [], issues: [] }),
    } as unknown as Module;
    const r = runModule(
      nested,
      grant({ scope: { type: "module", data: { a: { b: 1 } } } }),
      svc,
      ctx,
    );
    expect(r.issues[0]?.path).toBe("data.a.b");
  });
  it("handles a schema failure with no issue details", () => {
    const odd = {
      ...mod,
      dataSchema: { safeParse: () => ({ success: false, error: { issues: [] } }) },
    } as unknown as Module;
    const r = runModule(odd, grant({}), svc, ctx);
    expect(r.issues[0]).toMatchObject({ id: "E_MODULE_DATA", path: "data" });
  });
  it("returns module statements on success", () => {
    const r = runModule(mod, grant({}), svc, ctx);
    expect(r.issues).toEqual([]);
    expect(r.statements).toHaveLength(1);
  });
});

describe("stmt and prefixed", () => {
  it("sorts actions and uses string for single resource", () => {
    expect(stmt("A", ["s3:B", "s3:A"], ["r"])).toEqual({
      Sid: "A",
      Effect: "Allow",
      Action: ["s3:A", "s3:B"],
      Resource: "r",
    });
  });
  it("single action is a string, multiple resources sorted array, condition kept", () => {
    const c = { StringEquals: { "aws:x": "y" } };
    expect(stmt("A", ["s3:A"], ["z", "a"], c)).toEqual({
      Sid: "A",
      Effect: "Allow",
      Action: "s3:A",
      Resource: ["a", "z"],
      Condition: c,
    });
  });
  it("prefixed adds service", () => {
    expect(prefixed("s3", ["GetObject"])).toEqual(["s3:GetObject"]);
  });
});

describe("registry and helpers", () => {
  it("defaultBuilders mirrors MODULES", () => {
    expect(Object.keys(defaultBuilders()).sort()).toEqual(Object.keys(MODULES).sort());
  });
  it("defaultBuilders builders run their module", () => {
    MODULES["textract"] = mod as unknown as Module;
    try {
      const b = defaultBuilders()["textract"];
      expect(b?.(grant({}), svc, ctx).statements).toHaveLength(1);
    } finally {
      delete MODULES["textract"];
    }
  });
  it("loadRealCatalog loads services", () => {
    expect(loadRealCatalog(["s3"]).getService("s3")?.key).toBe("s3");
  });
});

describe("runModule service mismatch", () => {
  it("rejects a grant whose service differs from the module", () => {
    const r = runModule(mod, grant({ service: "s3" }), svc, ctx);
    expect(r.statements).toEqual([]);
    expect(r.issues[0]).toMatchObject({ id: "E_MODULE_SERVICE", severity: "error", grantId: "g1" });
  });
});
