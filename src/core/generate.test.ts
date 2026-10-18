import { readFileSync } from "node:fs";
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
      model([
        grant({ id: "a", service: "textract", access: { type: "actions", actions: ["AnalyzeDocument"] } }),
        grant({ id: "b", service: "textract", access: { type: "actions", actions: ["AnalyzeExpense"] } }),
      ]),
      catalog,
    );
    expect(r.policy?.Statement.map((s) => s.Sid)).toEqual(["TextractCustomAll", "TextractCustomAll2"]);
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

  describe("inline size limit by target", () => {
    // A builder whose single statement has a Sid of tunable length, so the policy hits an exact size.
    const sized = (target: number, over: Partial<RoleModel>) => {
      const mk = (n: number): GrantBuilder => () => ({
        statements: [{ Sid: "S" + "x".repeat(n), Effect: "Allow", Action: "textract:AnalyzeDocument", Resource: "*" }],
        issues: [],
      });
      const g = [grant({ service: "textract", module: "x" })];
      const base = generate(model(g, over), catalog, { x: mk(0) }).sizes.policy;
      return generate(model(g, over), catalog, { x: mk(target - base) });
    };
    const tooLarge = (r: ReturnType<typeof generate>) => r.issues.find((i) => i.id === "E_POLICY_TOO_LARGE");
    const user = { kind: "principal", target: "user", name: "bob" } as const;
    const group = { kind: "principal", target: "group", name: "devs" } as const;
    for (const [label, trust, limit] of [
      ["principal user", user, 2048],
      ["principal group", group, 5120],
    ] as const) {
      it(`${label} inline: ${limit} ok, ${limit + 1} error suggesting managed mode`, () => {
        const ok = sized(limit, { policyMode: "inline", trust });
        expect(ok.sizes.policy).toBe(limit);
        expect(tooLarge(ok)).toBeUndefined();
        const over = sized(limit + 1, { policyMode: "inline", trust });
        expect(over.sizes.policy).toBe(limit + 1);
        const issue = tooLarge(over);
        expect(issue?.severity).toBe("error");
        expect(issue?.message).toContain(`${limit}`);
        expect(issue?.message).toContain("managed");
        expect(issue?.message).toContain(`Other inline policies already on the ${trust.target}`);
      });
      it(`${label} managed mode keeps the 6144 limit`, () => {
        expect(tooLarge(sized(6144, { policyMode: "managed", trust }))).toBeUndefined();
        expect(tooLarge(sized(6145, { policyMode: "managed", trust }))).toBeDefined();
      });
    }
    it("role inline: 10240 ok, 10241 error", () => {
      expect(tooLarge(sized(10240, { policyMode: "inline" }))).toBeUndefined();
      expect(tooLarge(sized(10241, { policyMode: "inline" }))?.message).toContain("10240");
    });
  });

  describe("managed policy attachment quota (10)", () => {
    const arns = (n: number) => Array.from({ length: n }, (_, i) => `arn:aws:iam::aws:policy/P${i}`);
    const count = (n: number, over: Partial<RoleModel>, grants = [grant({ service: "textract" })]) =>
      generate(model(grants, { managedPolicyArns: arns(n), ...over }), catalog).issues.filter(
        (i) => i.id === "V_TOO_MANY_MANAGED_POLICIES",
      );
    it("9 ARNs + generated managed policy = 10 is ok", () => expect(count(9, { policyMode: "managed" })).toEqual([]));
    it("10 ARNs + generated managed policy is an error", () => {
      const issues = count(10, { policyMode: "managed" });
      expect(issues).toHaveLength(1);
      expect(issues[0]?.severity).toBe("error");
    });
    it("10 ARNs in inline mode is ok", () => expect(count(10, { policyMode: "inline" })).toEqual([]));
    it("10 ARNs without permissions is ok, 11 is an error", () => {
      expect(count(10, { policyMode: "managed" }, [])).toEqual([]);
      expect(count(11, { policyMode: "managed" }, [])).toHaveLength(1);
    });
    it("applies to principal users too", () => {
      const trust = { kind: "principal", target: "user", name: "bob" } as const;
      expect(count(10, { policyMode: "managed", trust })).toHaveLength(1);
      expect(count(9, { policyMode: "managed", trust })).toEqual([]);
    });
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
        accountId: "123456789012",
        trust: { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "x".repeat(2000) } },
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

describe("generate on malformed input", () => {
  const bad = (over: Record<string, unknown>) =>
    ({ ...createEmptyModel(), ...over }) as unknown as RoleModel;
  it.each([
    ["grants undefined", { grants: undefined }],
    ["trust undefined", { trust: undefined }],
    ["grants [null]", { grants: [null] }],
  ])("%s does not throw and reports V_SCHEMA", (_n, over) => {
    let r: ReturnType<typeof generate> | undefined;
    expect(() => {
      r = generate(bad(over), catalog);
    }).not.toThrow();
    expect(r?.policy).toBeNull();
    expect(r?.trust).toBeNull();
    expect(r?.sizes).toEqual({ policy: 0, trust: 0 });
    const i = r?.issues.find((x) => x.id === "V_SCHEMA");
    expect(i?.severity).toBe("error");
    expect(i?.path).toBeTruthy();
  });
  it("guards a throwing catalog lookup", () => {
    const boom = { ...catalog, getService: () => { throw new Error("x"); } };
    const r = generate(model([grant({ service: "textract" })]), boom as unknown as typeof catalog);
    expect(r.issues.find((x) => x.id === "E_INTERNAL")?.grantId).toBe("g1");
  });
});

describe("generate module wiring", () => {
  it("unknown module still yields E_UNKNOWN_MODULE", () => {
    const r = generate(
      model([
        grant({
          service: "textract",
          module: "nosuch",
          scope: { type: "module", data: {} },
          access: { type: "preset", preset: "x" },
        }),
      ]),
      catalog,
    );
    expect(ids(r.issues)).toContain("E_UNKNOWN_MODULE");
  });
  it("explicit builders override defaults", () => {
    const b: GrantBuilder = () => ({
      statements: [{ Sid: "X", Effect: "Allow", Action: "textract:AnalyzeDocument", Resource: "*" }],
      issues: [],
    });
    const r = generate(model([grant({ service: "textract", module: "m" })]), catalog, { m: b });
    expect(r.policy?.Statement[0]?.Sid).toBe("X");
  });
});

describe("username warning dedupe", () => {
  const s3 = JSON.parse(readFileSync("public/data/svc/s3.json", "utf8")) as SlimService;
  const s3catalog = createCatalog([s3]);
  const s3grant: Grant = {
    id: "g1",
    service: "s3",
    module: "s3",
    scope: { type: "module", data: { bucket: "data-lake", prefixes: ["home/${aws:username}/"] } },
    access: { type: "preset", preset: "read" },
  };
  it("service trust yields exactly one L_USERNAME_IN_ROLE and no W_S3_USERNAME_VAR", () => {
    const r = generate(model([s3grant]), s3catalog);
    expect(ids(r.issues).filter((x) => x === "L_USERNAME_IN_ROLE")).toHaveLength(1);
    expect(ids(r.issues)).not.toContain("W_S3_USERNAME_VAR");
  });
  it("principal trust yields neither", () => {
    const r = generate(
      model([s3grant], { trust: { kind: "principal", target: "group", name: "devs" } }),
      s3catalog,
    );
    expect(ids(r.issues)).not.toContain("L_USERNAME_IN_ROLE");
    expect(ids(r.issues)).not.toContain("W_S3_USERNAME_VAR");
  });
});

describe("generate statement dedupe", () => {
  it("emits identical statements once, keeping the first", () => {
    const ec2g = (id: string, preset: string): Grant => ({
      id,
      service: "ec2",
      module: "ec2",
      scope: { type: "module", data: { selector: { type: "all" } } },
      access: { type: "preset", preset },
    });
    const r = generate(model([ec2g("a", "view"), ec2g("b", "start-stop")]), catalog);
    const stmts = r.policy?.Statement ?? [];
    const views = stmts.filter((s) => JSON.stringify(s.Action).includes("DescribeInstances"));
    expect(views).toHaveLength(1);
    expect(views[0]?.Sid).toBe("Ec2ViewView");
    expect(stmts.map((s) => s.Sid)).toStrictEqual(["Ec2ViewView", "Ec2StartStopManage"]);
  });
});
