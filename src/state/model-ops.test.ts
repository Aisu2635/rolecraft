import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODULES } from "../core/engine/modules/registry";
import { createEmptyModel, roleModelSchema, type Grant } from "../core/model/model";
import type { SlimService } from "../core/types";
import {
  addGrant,
  defaultModuleData,
  defaultTrust,
  moduleFor,
  newGrantFor,
  removeGrant,
  setFields,
  setTrust,
  updateGrant,
} from "./model-ops";

function svc(key: string): SlimService {
  return JSON.parse(readFileSync(resolve(process.cwd(), `public/data/svc/${key}.json`), "utf8")) as SlimService;
}

const grant = (id: string): Grant => ({ id, service: "s3", scope: { type: "all" }, access: { type: "levels", levels: ["Read"] } });

describe("model-ops", () => {
  it("setFields deletes accountId/region when empty", () => {
    const m = setFields(createEmptyModel(), { accountId: "123456789012", region: "us-east-1" });
    const out = setFields(m, { accountId: "", region: "" });
    expect("accountId" in out).toBe(false);
    expect("region" in out).toBe(false);
  });

  it("setFields is pure", () => {
    const m = createEmptyModel();
    const snap = structuredClone(m);
    const out = setFields(m, { name: "x", policyMode: "inline" });
    expect(out).not.toBe(m);
    expect(out.name).toBe("x");
    expect(m).toEqual(snap);
  });

  it("setTrust/addGrant/removeGrant work and do not mutate", () => {
    const m = createEmptyModel();
    const snap = structuredClone(m);
    const t = setTrust(m, defaultTrust("account"));
    expect(t.trust.kind).toBe("account");
    const a = addGrant(addGrant(m, grant("a")), grant("b"));
    expect(a.grants.map((g) => g.id)).toEqual(["a", "b"]);
    expect(removeGrant(a, "a").grants.map((g) => g.id)).toEqual(["b"]);
    expect(m).toEqual(snap);
  });

  it("updateGrant updates a grant; unknown id returns same reference", () => {
    const m = addGrant(createEmptyModel(), grant("a"));
    const out = updateGrant(m, "a", (g) => ({ ...g, service: "ec2" }));
    expect(out.grants[0]?.service).toBe("ec2");
    expect(m.grants[0]?.service).toBe("s3");
    expect(updateGrant(m, "nope", (g) => g)).toBe(m);
  });

  it("moduleFor maps service keys to module ids", () => {
    expect(moduleFor("s3")).toBe("s3");
    expect(moduleFor("textract")).toBeUndefined();
  });

  it("defaultModuleData matches brief values", () => {
    expect(defaultModuleData("s3")).toEqual({ bucket: "", prefixes: [""] });
    expect(defaultModuleData("ec2")).toEqual({ selector: { type: "tag", key: "", value: "" } });
    expect(defaultModuleData("ecr")).toEqual({ repository: "" });
    expect(defaultModuleData("eks")).toEqual({ cluster: "" });
    expect(defaultModuleData("lambda")).toEqual({ functionName: "" });
    expect(defaultModuleData("dynamodb")).toEqual({ table: "" });
    expect(defaultModuleData("logs")).toEqual({ logGroup: "" });
    expect(defaultModuleData("secretsmanager")).toEqual({ secretName: "" });
    expect(defaultModuleData("kms")).toEqual({ keyArn: "" });
    expect(defaultModuleData("sqs")).toEqual({ queueName: "" });
  });

  it("every module default data is schema-valid inside a model", () => {
    for (const id of Object.keys(MODULES)) {
      const g: Grant = {
        id: "g",
        service: MODULES[id]!.service,
        module: id,
        scope: { type: "module", data: defaultModuleData(id) },
        access: { type: "preset", preset: MODULES[id]!.presets[0]!.id },
      };
      expect(roleModelSchema.safeParse(addGrant(createEmptyModel(), g)).success).toBe(true);
    }
  });

  it("newGrantFor a module service uses first preset and default data", () => {
    const g = newGrantFor(svc("s3"));
    expect(g.module).toBe("s3");
    expect(g.service).toBe("s3");
    expect(g.access).toEqual({ type: "preset", preset: "list" });
    expect(g.scope).toEqual({ type: "module", data: { bucket: "", prefixes: [""] } });
    expect(g.id).toMatch(/^g_/);
  });

  it("newGrantFor a generic service picks Read and arns scope", () => {
    const g = newGrantFor(svc("textract"));
    expect(g.module).toBeUndefined();
    expect(g.access).toEqual({ type: "levels", levels: ["Read"] });
    expect(g.scope).toEqual({ type: "arns", arns: [] });
  });

  it("newGrantFor falls back to first level with actions, and 'all' scope without resource types", () => {
    const s: SlimService = {
      key: "fake",
      name: "Fake",
      category: "Other",
      conditionKeys: [],
      resources: [],
      actions: [{ name: "DoIt", level: "Write", resources: [], label: "DoIt", conditionKeys: [] }],
    } as SlimService;
    const g = newGrantFor(s);
    expect(g.access).toEqual({ type: "levels", levels: ["Write"] });
    expect(g.scope).toEqual({ type: "all" });
  });

  it("defaultTrust matches brief", () => {
    expect(defaultTrust("service")).toEqual({ kind: "service", service: "ec2" });
    expect(defaultTrust("github")).toEqual({ kind: "github", owner: "", repo: "", ref: { type: "branch", value: "main" } });
    expect(defaultTrust("account")).toEqual({ kind: "account", accountId: "" });
    expect(defaultTrust("principal")).toEqual({ kind: "principal", target: "group", name: "" });
  });
});
