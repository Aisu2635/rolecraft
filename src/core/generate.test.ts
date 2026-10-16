import { describe, expect, it } from "vitest";
import textractRaw from "./__fixtures__/aws/textract.json";
import ec2Full from "../../public/data/svc/ec2.json";
import { createCatalog } from "./catalog/catalog";
import { toSlimService } from "./catalog/transform";
import { generate, hasErrors, type GrantBuilder } from "./generate";
import { createEmptyModel, type Grant, type RoleModel } from "./model/model";
import { LIMITS } from "./validate/policy";
import type { Issue, SlimService } from "./types";

const textract = toSlimService(textractRaw);
const ec2 = ec2Full as unknown as SlimService;
const catalog = createCatalog([textract, ec2]);

const grant = (over: Partial<Grant> & { service: string }): Grant => ({
  id: "g1",
  scope: { type: "all" },
  access: { type: "levels", levels: ["Read"] },
  ...over,
});
const model = (grants: Grant[], over: Partial<RoleModel> = {}): RoleModel => ({
  ...createEmptyModel(),
  grants,
  ...over,
});
const ids = (issues: Issue[]) => issues.map((i) => i.id);

describe("generate", () => {
  it("no grants gives null policy", () => {
    const r = generate(model([]), catalog);
    expect(r.policy).toBeNull();
    expect(ids(r.issues)).toContain("I_NO_PERMISSIONS");
    expect(r.trust).not.toBeNull();
    expect(r.sizes.policy).toBe(0);
    expect(r.sizes.trust).toBeGreaterThan(0);
  });

  it("unknown service yields issue not crash", () => {
    const r = generate(
      model([grant({ id: "bad", service: "nosuchsvc" }), grant({ id: "ok", service: "textract" })]),
      catalog,
    );
    expect(r.policy?.Statement.some((s) => s.Sid?.startsWith("Textract"))).toBe(true);
    const i = r.issues.find((x) => x.id === "E_UNKNOWN_SERVICE");
    expect(i?.grantId).toBe("bad");
    expect(hasErrors(r.issues)).toBe(true);
  });

  it("duplicate Sids across grants are deduped", () => {
    const r = generate(
      model([grant({ id: "a", service: "textract" }), grant({ id: "b", service: "textract" })]),
      catalog,
    );
    expect(r.policy?.Statement.map((s) => s.Sid)).toEqual(["TextractReadAll", "TextractReadAll2"]);
  });

  it("principal trust gives null trust and no error", () => {
    const r = generate(
      model([grant({ service: "textract" })], {
        trust: { kind: "principal", target: "user", name: "bob" },
      }),
      catalog,
    );
    expect(r.trust).toBeNull();
    expect(r.sizes.trust).toBe(0);
    expect(hasErrors(r.issues)).toBe(false);
  });

  it("module grant without builder", () => {
    const r = generate(model([grant({ id: "m", service: "textract", module: "x" })]), catalog);
    const i = r.issues.find((x) => x.id === "E_UNKNOWN_MODULE");
    expect(i?.grantId).toBe("m");
    expect(r.policy).toBeNull();
  });

  it("uses a registered module builder", () => {
    const b: GrantBuilder = () => ({
      statements: [{ Sid: "Custom", Effect: "Allow", Action: "textract:*", Resource: "*" }],
      issues: [{ id: "I_X", severity: "info", message: "x" }],
    });
    const r = generate(model([grant({ service: "textract", module: "x" })]), catalog, { x: b });
    expect(r.policy?.Statement[0]?.Sid).toBe("Custom");
    expect(ids(r.issues)).toContain("I_X");
  });

  it("a throwing builder becomes E_INTERNAL and the rest continues", () => {
    const b: GrantBuilder = () => {
      throw new Error("boom");
    };
    const r = generate(
      model([
        grant({ id: "t", service: "textract", module: "x" }),
        grant({ id: "ok", service: "textract" }),
      ]),
      catalog,
      { x: b },
    );
    const i = r.issues.find((x) => x.id === "E_INTERNAL");
    expect(i?.grantId).toBe("t");
    expect(i?.severity).toBe("error");
    expect(i?.message).toBe("Something went wrong building this permission. Please report it.");
    expect(r.policy?.Statement).toHaveLength(1);
  });

  it("flags too-large policy iff size exceeds the limit (mid-size model)", () => {
    const g = grant({
      service: "ec2",
      access: { type: "levels", levels: ["List", "Read"] },
    });
    for (const [mode, limit] of [
      ["managed", LIMITS.managed],
      ["inline", LIMITS.inline],
    ] as const) {
      const r = generate(model([g], { policyMode: mode }), catalog);
      expect(ids(r.issues).includes("E_POLICY_TOO_LARGE")).toBe(r.sizes.policy > limit);
    }
  });

  it("ec2 all levels is too large in both modes", () => {
    const g = grant({
      service: "ec2",
      access: { type: "levels", levels: ["List", "Read", "Write", "Tagging", "Permissions management"] },
    });
    for (const mode of ["managed", "inline"] as const) {
      const r = generate(model([g], { policyMode: mode }), catalog);
      expect(ids(r.issues)).toContain("E_POLICY_TOO_LARGE");
      expect(r.sizes.policy).toBeGreaterThan(LIMITS.inline);
    }
  });

  it("flags oversized trust policy", () => {
    const r = generate(
      model([grant({ service: "textract" })], {
        trust: { kind: "account", accountId: "123456789012", externalId: "x".repeat(2100) },
      }),
      catalog,
    );
    expect(r.sizes.trust).toBeGreaterThan(LIMITS.trust);
    expect(ids(r.issues)).toContain("E_TRUST_TOO_LARGE");
  });

  it("sorts errors, warnings, infos with stable order", () => {
    const r = generate(
      model([
        grant({ id: "e", service: "textract", access: { type: "levels", levels: [] } }),
        grant({ id: "u1", service: "nosuch1" }),
        grant({ id: "u2", service: "nosuch2" }),
      ]),
      catalog,
    );
    const order = { error: 0, warning: 1, info: 2 } as const;
    const ranks = r.issues.map((i) => order[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(ranks).toContain(2);
    const errs = r.issues.filter((i) => i.id === "E_UNKNOWN_SERVICE").map((i) => i.grantId);
    expect(errs).toEqual(["u1", "u2"]);
  });

  it("realistic model has no errors", () => {
    const r = generate(
      model([
        grant({ id: "a", service: "textract" }),
        grant({
          id: "b",
          service: "ec2",
          access: { type: "actions", actions: ["DescribeInstances", "StartInstances"] },
        }),
      ]),
      catalog,
    );
    expect(hasErrors(r.issues)).toBe(false);
    expect(r.policy).not.toBeNull();
  });

  it("passes blank account and region as undefined", () => {
    let seen: unknown;
    const b: GrantBuilder = (_g, _s, ctx) => {
      seen = ctx;
      return { statements: [], issues: [] };
    };
    generate(
      model([grant({ service: "textract", module: "x" })], { accountId: "", region: "" }),
      catalog,
      { x: b },
    );
    expect(seen).toEqual({ partition: "aws", accountId: undefined, region: undefined });
  });
});
