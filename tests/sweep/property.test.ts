import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { generate } from "../../src/core/generate";
import type { Grant, RoleModel, Trust } from "../../src/core/model/model";
import { decodeModel, encodeModel } from "../../src/core/model/share";
import { ACCESS_LEVELS, type SlimService } from "../../src/core/types";
import { validateIdentityPolicy, validateTrustPolicy } from "../../src/core/validate/policy";
import { loadCatalog, loadServices, sampleArns } from "./load-data";

const NUM_RUNS = 1000;
const services = loadServices().filter((s) => s.actions.length > 0);
const catalog = loadCatalog();
const arnCache = new Map<string, string[]>();
const arnsOf = (svc: SlimService): string[] => {
  let v = arnCache.get(svc.key);
  if (!v) {
    v = sampleArns(svc);
    arnCache.set(svc.key, v);
  }
  return v;
};

const alnum = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const word = (chars: string, min: number, max: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...chars), { minLength: min, maxLength: max }).map((a) => a.join(""));

const accountId = fc.stringMatching(/^\d{12}$/);
const regionArb = fc.constantFrom("us-east-1", "eu-west-2", "ap-southeast-1", "us-gov-west-1");
const principalName = word(alnum + "+=,.@_-", 1, 40);

const trustArb: fc.Arbitrary<Trust> = fc.oneof(
  fc.constantFrom<"ec2" | "lambda" | "ecs-tasks">("ec2", "lambda", "ecs-tasks").map(
    (service): Trust => ({ kind: "service", service }),
  ),
  fc
    .record({
      owner: word(alnum, 1, 1).chain((h) => word(alnum + "-", 0, 20).map((t) => h + t)),
      repo: word(alnum + "._-", 1, 30),
      type: fc.constantFrom<"branch" | "tag" | "environment" | "pull_request">(
        "branch",
        "tag",
        "environment",
        "pull_request",
      ),
      value: word(alnum + "/-._*", 1, 20),
    })
    .map(
      ({ owner, repo, type, value }): Trust => ({
        kind: "github",
        owner,
        repo,
        ref: type === "pull_request" ? { type } : { type, value },
      }),
    ),
  fc
    .record({
      accountId,
      externalId: fc.option(word(alnum + "+=,.@:/-", 2, 30), { nil: undefined }),
      requireMfa: fc.option(fc.boolean(), { nil: undefined }),
    })
    .map(({ accountId, externalId, requireMfa }): Trust => {
      const t: Trust = { kind: "account", accountId };
      if (externalId !== undefined) t.externalId = externalId;
      if (requireMfa !== undefined) t.requireMfa = requireMfa;
      return t;
    }),
  fc
    .record({ target: fc.constantFrom<"group" | "user">("group", "user"), name: principalName })
    .map(({ target, name }): Trust => ({ kind: "principal", target, name })),
);

const grantArb = (index: number): fc.Arbitrary<Grant> =>
  fc.constantFrom(...services).chain((svc) =>
    fc
      .record({
        scope: fc.oneof(
          fc.constant<Grant["scope"]>({ type: "all" }),
          fc
            .subarray(arnsOf(svc))
            .map((arns): Grant["scope"] => ({ type: "arns", arns })),
        ),
        access: fc.oneof(
          fc
            .subarray([...ACCESS_LEVELS], { minLength: 1 })
            .map((levels): Grant["access"] => ({ type: "levels", levels })),
          fc
            .subarray(svc.actions.map((a) => a.name), { minLength: 1, maxLength: Math.min(40, svc.actions.length) })
            .map((actions): Grant["access"] => ({ type: "actions", actions })),
        ),
      })
      .map(({ scope, access }) => ({ id: `g${index}`, service: svc.key, scope, access })),
  );

const modelArb: fc.Arbitrary<RoleModel> = fc
  .record({
    name: word(alnum + "+=,.@_-", 1, 64),
    accountId: fc.option(accountId, { nil: undefined }),
    region: fc.option(regionArb, { nil: undefined }),
    trust: trustArb,
    grantCount: fc.integer({ min: 0, max: 4 }),
    policyMode: fc.constantFrom<"inline" | "managed">("inline", "managed"),
  })
  .chain((base) =>
    fc.tuple(...Array.from({ length: base.grantCount }, (_, i) => grantArb(i))).map((grants) => {
      const m: RoleModel = {
        version: 1,
        name: base.name,
        partition: "aws",
        trust: base.trust,
        grants,
        policyMode: base.policyMode,
        managedPolicyArns: [],
      };
      if (base.accountId !== undefined) m.accountId = base.accountId;
      if (base.region !== undefined) m.region = base.region;
      return m;
    }),
  );

const prop = (name: string, check: (m: RoleModel) => void): void => {
  test(name, () => {
    fc.assert(
      fc.property(modelArb, (m) => {
        check(m);
      }),
      { numRuns: NUM_RUNS },
    );
  });
};

describe("property: random role models", () => {
  prop("generate never throws", (m) => {
    expect(() => generate(m, catalog)).not.toThrow();
  });
  prop("generate is deterministic", (m) => {
    expect(generate(m, catalog)).toStrictEqual(generate(m, catalog));
  });
  prop("every generated policy passes the strict validator (size aside)", (m) => {
    const { policy } = generate(m, catalog);
    if (!policy) return;
    const errors = validateIdentityPolicy(policy, catalog).filter((i) => i.severity === "error");
    expect(errors).toStrictEqual([]);
  });
  prop("every generated trust policy passes the trust validator", (m) => {
    const { trust } = generate(m, catalog);
    if (!trust) return;
    const errors = validateTrustPolicy(trust).filter((i) => i.severity === "error");
    expect(errors).toStrictEqual([]);
  });
  prop("encode/decode round-trips the model", (m) => {
    expect(decodeModel(encodeModel(m))).toStrictEqual(m);
  });
});
