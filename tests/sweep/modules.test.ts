import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { MODULES } from "../../src/core/engine/modules/registry";
import { generate, hasErrors } from "../../src/core/generate";
import { createEmptyModel, type Grant, type RoleModel } from "../../src/core/model/model";
import { validateIdentityPolicy } from "../../src/core/validate/policy";
import { loadCatalog } from "./load-data";

const NUM_RUNS = 1000;
const TEST_TIMEOUT = 60_000;
const catalog = loadCatalog();
const KEY = "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";

/** Hand-written valid data per module, covering the plan's review-focus edge cases. */
const SAMPLES: Record<string, unknown[]> = {
  s3: [
    { bucket: "my-bucket", prefixes: [""] },
    {
      bucket: "a.b-c.d",
      prefixes: ["a/b/c/d/e", "no-trailing-slash", "/leading", "x/"],
      allowNavigation: true,
    },
    {
      bucket: "ab1",
      prefixes: ["home/${aws:username}/", "u/${aws:userid}/files", "p/${aws:PrincipalAccount}", "one", "two"],
      allowNavigation: true,
      kmsKeyArn: KEY,
    },
  ],
  ec2: [
    { selector: { type: "all" } },
    { selector: { type: "tag", key: "Env", value: "prod" } },
    { selector: { type: "ids", ids: ["i-0123456789abcdef0", "i-abcdef12"] } },
  ],
  ecr: [{ repository: "app" }, { repository: "team/app.v2/sub_repo-x" }, { repository: "a".repeat(256) }],
  eks: [{ cluster: "prod" }, { cluster: "A_b-1" }, { cluster: "x".repeat(100) }],
  lambda: [{ functionName: "fn" }, { functionName: "my-func_2" }, { functionName: "L".repeat(64) }],
  dynamodb: [
    { table: "Orders", includeIndexes: true },
    { table: "a.b_c-d", includeIndexes: false },
    { table: "t".repeat(255), includeIndexes: true },
  ],
  logs: [
    { logGroup: "/aws/lambda/fn", createGroup: true },
    { logGroup: "app#prod.log-1_x/y", createGroup: false },
    { logGroup: "g".repeat(512), createGroup: true },
  ],
  secretsmanager: [
    { secretName: "prod/db" },
    { secretName: "a+b=c.d@e-f_g/h", kmsKeyArn: KEY },
    { secretName: "s".repeat(512) },
  ],
  kms: [
    { keyArn: KEY },
    { keyArn: "arn:aws:kms:eu-west-2:000000000000:key/abc" },
    { keyArn: "arn:aws:kms:us-gov-west-1:999999999999:key/A-1-b" },
  ],
  sqs: [{ queueName: "q" }, { queueName: "jobs.fifo", kmsKeyArn: KEY }, { queueName: "Q_1-x".repeat(16) }],
};

interface Ctx {
  accountId?: string;
  region?: string;
}

function modelFor(moduleId: string, preset: string, data: unknown, ctx: Ctx, trust: RoleModel["trust"]): RoleModel {
  const mod = MODULES[moduleId]!;
  const grant: Grant = {
    id: "g1",
    service: mod.service,
    module: moduleId,
    scope: { type: "module", data },
    access: { type: "preset", preset },
  };
  const m = createEmptyModel();
  m.trust = trust;
  m.grants = [grant];
  if (ctx.accountId) m.accountId = ctx.accountId;
  if (ctx.region) m.region = ctx.region;
  return m;
}

const CTXS: Ctx[] = [
  {},
  { accountId: "123456789012", region: "us-east-1" },
  { accountId: "123456789012" },
  { region: "eu-west-2" },
];
const TRUSTS: RoleModel["trust"][] = [
  { kind: "service", service: "ec2" },
  { kind: "principal", target: "group", name: "devs" },
];

describe("module sweep", () => {
  test("sample table covers every registered module", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(MODULES).sort());
  });

  for (const [id, mod] of Object.entries(MODULES)) {
    describe(id, () => {
      for (const preset of mod.presets) {
        test(`${preset.id}: sample data x ctx x trust is validator-clean`, () => {
          for (const [i, data] of (SAMPLES[id] ?? []).entries()) {
            for (const ctx of CTXS) {
              for (const trust of TRUSTS) {
                const r = generate(modelFor(id, preset.id, data, ctx, trust), catalog);
                const label = `${id}/${preset.id}/sample${i}/${JSON.stringify(ctx)}/${trust.kind}`;
                expect(r.issues.filter((x) => x.severity === "error"), label).toEqual([]);
                expect(hasErrors(r.issues), label).toBe(false);
                expect(r.policy, label).not.toBeNull();
                expect(validateIdentityPolicy(r.policy, catalog), label).toEqual([]);
              }
            }
          }
        });
      }
      test("invalid data yields E_MODULE_DATA without throwing", () => {
        const preset = mod.presets[0]!.id;
        const good = (SAMPLES[id] ?? [])[0] as object;
        for (const bad of [null, {}, [], "x", 5, { bogus: 1 }, { ...good, extra: true }]) {
          const r = generate(modelFor(id, preset, bad, {}, TRUSTS[0]!), catalog);
          expect(r.issues.some((x) => x.id === "E_MODULE_DATA" && x.severity === "error")).toBe(true);
        }
      });
    });
  }
});

const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const lower = "abcdefghijklmnopqrstuvwxyz0123456789";
const word = (chars: string, min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...chars), { minLength: min, maxLength: max }).map((a) => a.join(""));
const keyArn = fc
  .tuple(word("abcdefghijklmnopqrstuvwxyz0123456789-", 1, 14), fc.stringMatching(/^\d{12}$/), word(alnum + "-", 1, 40))
  .map(([r, a, k]) => `arn:aws:kms:${r}:${a}:key/${k}`);
const optKey = fc.option(keyArn, { nil: undefined });
const noUndef = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

const bucket = fc
  .tuple(word(lower, 1, 1), word(lower + "-", 1, 40), word(lower, 1, 1))
  .map(([a, b, c]) => a + b + c);
const varPart = fc.constantFrom("${aws:username}", "${aws:userid}", "${aws:PrincipalAccount}");
const prefixChars = alnum + "/-_.!()+,:;=@&%#~[]{}<>|^'";
const prefix = fc
  .array(fc.oneof(word(prefixChars, 0, 12), varPart), { maxLength: 4 })
  .map((a) => a.join(""));
const repoName = fc
  .array(word(lower, 1, 8), { minLength: 1, maxLength: 4 })
  .chain((segs) =>
    fc
      .array(fc.constantFrom("/", "-", ".", "_"), { minLength: segs.length, maxLength: segs.length })
      .map((seps) => segs.map((s, i) => (i === 0 ? s : seps[i]! + s)).join("")),
  );
const tagChars = alnum + "_ .:/=+-@";

const DATA_ARBS: Record<string, fc.Arbitrary<unknown>> = {
  s3: fc
    .record({
      bucket,
      prefixes: fc.array(prefix, { minLength: 1, maxLength: 20 }),
      allowNavigation: fc.boolean(),
      kmsKeyArn: optKey,
    })
    .map(noUndef),
  ec2: fc.oneof(
    fc.constant({ selector: { type: "all" } }),
    fc.record({
      selector: fc.record({ type: fc.constant("tag"), key: word(tagChars, 1, 128), value: word(tagChars, 0, 256) }),
    }),
    fc.record({
      selector: fc.record({
        type: fc.constant("ids"),
        ids: fc.array(
          word("0123456789abcdef", 8, 17).map((h) => `i-${h}`),
          { minLength: 1, maxLength: 50 },
        ),
      }),
    }),
  ),
  ecr: fc.record({ repository: repoName }),
  eks: fc.record({ cluster: word(alnum, 1, 1).chain((h) => word(alnum + "-_", 0, 99).map((t) => h + t)) }),
  lambda: fc.record({ functionName: word(alnum + "-_", 1, 64) }),
  dynamodb: fc.record({ table: word(alnum + "_.-", 3, 255), includeIndexes: fc.boolean() }),
  logs: fc.record({ logGroup: word(alnum + ".-_/#", 1, 512), createGroup: fc.boolean() }),
  secretsmanager: fc.record({ secretName: word(alnum + "_/+=.@-", 1, 512), kmsKeyArn: optKey }).map(noUndef),
  kms: fc.record({ keyArn }),
  sqs: fc
    .record({
      queueName: fc.tuple(word(alnum + "_-", 1, 80), fc.boolean()).map(([n, f]) => (f ? `${n}.fifo` : n)),
      kmsKeyArn: optKey,
    })
    .map(noUndef),
};

describe("property: random valid module data", () => {
  test("arbitraries cover every module", () => {
    expect(Object.keys(DATA_ARBS).sort()).toEqual(Object.keys(MODULES).sort());
  });
  for (const [id, mod] of Object.entries(MODULES)) {
    test(
      `${id}: no throw, no errors, validator clean, deterministic`,
      { timeout: TEST_TIMEOUT },
      () => {
        fc.assert(
          fc.property(
            DATA_ARBS[id]!,
            fc.constantFrom(...mod.presets.map((p) => p.id)),
            fc.constantFrom(...CTXS),
            fc.constantFrom(...TRUSTS),
            (data, preset, ctx, trust) => {
              const model = modelFor(id, preset, data, ctx, trust);
              let r!: ReturnType<typeof generate>;
              expect(() => {
                r = generate(model, catalog);
              }).not.toThrow();
              expect(r.issues.filter((x) => x.severity === "error")).toEqual([]);
              expect(r.policy).not.toBeNull();
              expect(validateIdentityPolicy(r.policy, catalog)).toEqual([]);
              expect(generate(model, catalog)).toStrictEqual(r);
            },
          ),
          { numRuns: NUM_RUNS },
        );
      },
    );
  }
});
