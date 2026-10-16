import { describe, expect, it } from "vitest";
import ec2Raw from "../__fixtures__/aws/ec2.json";
import ec2Full from "../../../public/data/svc/ec2.json";
import iamRaw from "../__fixtures__/aws/iam.json";
import logsRaw from "../__fixtures__/aws/logs.json";
import s3Raw from "../__fixtures__/aws/s3.json";
import stsRaw from "../__fixtures__/aws/sts.json";
import textractRaw from "../__fixtures__/aws/textract.json";
import type { BuildContext } from "../arn";
import { createCatalog } from "../catalog/catalog";
import { toSlimService } from "../catalog/transform";
import type { SlimService } from "../types";
import type { Trust } from "../model/model";
import { buildTrust } from "../trust/trust";
import { validateIdentityPolicy, validateTrustPolicy } from "./policy";

const catalog = createCatalog([s3Raw, ec2Raw, textractRaw, iamRaw, stsRaw, logsRaw].map(toSlimService));
const doc = (...Statement: unknown[]) => ({ Version: "2012-10-17", Statement });
const allow = (Action: unknown, Resource: unknown = "*", extra: object = {}) => ({ Effect: "Allow", Action, Resource, ...extra });
const ids = (d: unknown) => validateIdentityPolicy(d, catalog).map((i) => i.id);
const BUCKET = "arn:aws:s3:::my-bucket";
const OBJ = "arn:aws:s3:::my-bucket/reports/*";

describe("performance on full ec2 data", () => {
  const full = createCatalog([ec2Full as unknown as SlimService]);
  const run = (arns: string[]) =>
    validateIdentityPolicy(doc(allow("ec2:*", arns)), full).map((i) => i.id);
  it("ec2:* on ordinary wildcard ARNs is fast", () => {
    run(["arn:aws:ec2:*:*:instance/*"]); // warm caches and JIT
    const start = performance.now();
    const r = run(["arn:aws:ec2:*:*:instance/*", "arn:aws:ec2:*:*:volume/*", "arn:aws:ec2:*:*:*"]);
    const ms = performance.now() - start;
    console.log("ec2:* x3 ARNs ms", ms.toFixed(1));
    expect(ms).toBeLessThan(150);
    expect(r).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
    expect(run(["arn:aws:ec2:*:*:*"])).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
  });
  it("ec2:* on 18 long wildcard ARNs is fast", () => {
    run(["arn:aws:ec2:*:*:instance/*"]); // warm caches and JIT
    const arns = Array.from({ length: 18 }, (_, i) => `arn:aws:ec2:*:*:${"*a?".repeat(98)}${i}`);
    const start = performance.now();
    run(arns);
    const ms = performance.now() - start;
    console.log("ec2:* x18 long ARNs ms", ms.toFixed(1));
    expect(ms).toBeLessThan(500);
  });
});

describe("wildcard-aware validation", () => {
  const LG = "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/fn:*";
  it("accepts AWS-standard log stream policies", () => {
    expect(ids(doc(allow(["logs:CreateLogStream", "logs:PutLogEvents"], LG)))).toEqual([]);
  });
  it("rejects CreateLogGroup on a log stream ARN", () => {
    expect(ids(doc(allow("logs:CreateLogGroup", LG)))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
  });
  it("accepts any logs actions on arn:aws:logs:*:*:*", () => {
    expect(ids(doc(allow(["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], "arn:aws:logs:*:*:*")))).toEqual([]);
  });
  it("still rejects ListBucket on arn:aws:s3:::b/*", () => {
    expect(ids(doc(allow("s3:ListBucket", "arn:aws:s3:::b/*")))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
  });
  it("wildcard actions are linear-time", () => {
    const start = performance.now();
    expect(ids(doc(allow("s3:" + "*".repeat(30) + "Z")))).toEqual(["V_UNKNOWN_ACTION"]);
    expect(performance.now() - start).toBeLessThan(50);
  });
  it("overlong actions yield V_ACTION_FORMAT without throwing", () => {
    expect(ids(doc(allow("s3:" + "a".repeat(100000))))).toEqual(["V_ACTION_FORMAT"]);
  });
});

describe("validateIdentityPolicy", () => {
  it("accepts a correct S3 folder policy", () => {
    const d = doc(
      allow("s3:ListBucket", BUCKET, { Sid: "List", Condition: { StringLike: { "s3:prefix": ["reports/*"] } } }),
      allow("s3:GetObject", OBJ, { Sid: "Get" }),
    );
    expect(validateIdentityPolicy(d, catalog)).toEqual([]);
  });
  it("rejects ListBucket on object ARN", () => {
    const issues = validateIdentityPolicy(doc(allow("s3:ListBucket", OBJ)), catalog);
    expect(issues.map((i) => i.id)).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
    expect(issues[0]?.message).toContain("s3:ListBucket");
    expect(issues[0]?.message).toContain(OBJ);
    expect(issues[0]?.message).toContain("bucket");
    expect(issues[0]?.path).toBe("Statement[0].Resource");
  });
  it("rejects GetObject on bucket ARN", () => expect(ids(doc(allow("s3:GetObject", BUCKET)))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]));
  it("requires star for global-only actions", () => {
    expect(ids(doc(allow("textract:AnalyzeDocument", BUCKET)))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
    expect(ids(doc(allow("textract:AnalyzeDocument", "*")))).toEqual([]);
    expect(ids(doc(allow("textract:AnalyzeDocument", ["*", "*"])))).toEqual([]);
  });
  it("checks every matched action for wildcards and mixed arrays", () => {
    expect(ids(doc(allow("s3:Get*", OBJ)))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
    expect(ids(doc(allow(["s3:GetObject", "s3:ListBucket"], [BUCKET, OBJ])))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
    expect(ids(doc(allow("s3:ListBucket", ["*", BUCKET])))).toEqual([]);
  });
  it("skips resource compatibility for the full wildcard", () => {
    expect(ids(doc(allow("*", BUCKET)))).toEqual([]);
  });
  it("requires Resource", () => {
    const r = validateIdentityPolicy(doc({ Effect: "Allow", Action: "s3:ListBucket" }), catalog);
    expect(r.map((i) => [i.id, i.path])).toEqual([["V_SCHEMA", "Statement[0].Resource"]]);
  });
  it("action names", () => {
    expect(ids(doc(allow("s3:GetObjekt")))).toEqual(["V_UNKNOWN_ACTION"]);
    expect(ids(doc(allow("s3:Get*")))).toEqual([]);
    expect(ids(doc(allow("s3:Get?bject")))).toEqual([]);
    expect(ids(doc(allow("s3:Zzz*")))).toEqual(["V_UNKNOWN_ACTION"]);
    expect(ids(doc(allow("nosuchsvc:Get")))).toEqual(["V_UNKNOWN_SERVICE"]);
    expect(ids(doc(allow("S3:GetObject")))).toEqual(["V_ACTION_FORMAT"]);
    expect(ids(doc(allow("s3GetObject")))).toEqual(["V_ACTION_FORMAT"]);
    expect(ids(doc(allow("s3:getobject")))).toEqual(["V_UNKNOWN_ACTION"]);
  });
  it("reports principal and unsupported elements as V_SCHEMA", () => {
    expect(ids(doc(allow("s3:Get*", "*", { Principal: "*" })))).toEqual(["V_SCHEMA"]);
    expect(ids(doc(allow("s3:Get*", "*", { NotPrincipal: "*" })))).toEqual(["V_SCHEMA"]);
    expect(ids(doc({ Effect: "Allow", NotAction: "s3:Get*", Resource: "*" })).includes("V_SCHEMA")).toBe(true);
    expect(ids(doc({ Effect: "Allow", Action: "s3:Get*", NotResource: "*" }))).toEqual(["V_SCHEMA"]);
  });
  it("conditions: operators", () => {
    const c = (op: string) => doc(allow("s3:ListBucket", BUCKET, { Condition: { [op]: { "s3:prefix": "a" } } }));
    expect(ids(c("StringEqual"))).toEqual(["V_CONDITION_OPERATOR"]);
    expect(ids(c("ForAnyValue:StringLike"))).toEqual([]);
    expect(ids(c("StringEqualsIfExists"))).toEqual([]);
    expect(ids(c("NullIfExists"))).toEqual(["V_CONDITION_OPERATOR"]);
  });
  it("conditions: keys", () => {
    const c = (key: string, a = "s3:ListBucket", r: string = BUCKET) => doc(allow(a, r, { Condition: { StringEquals: { [key]: "x" } } }));
    expect(ids(c("s3:prefixx"))).toEqual(["V_CONDITION_KEY"]);
    expect(ids(c("s3:prefix"))).toEqual([]);
    expect(ids(c("S3:Prefix"))).toEqual([]);
    expect(ids(c("aws:ResourceTag/env", "ec2:StopInstances", "arn:aws:ec2:us-east-1:123456789012:instance/*"))).toEqual([]);
    expect(ids(c("s3:ExistingObjectTag/team", "s3:GetObject", OBJ))).toEqual([]);
    expect(ids(c("s3:ExistingObjectTag/", "s3:GetObject", OBJ))).toEqual(["V_CONDITION_KEY"]);
    expect(ids(c("ec2:prefix"))).toEqual(["V_CONDITION_KEY"]);
    expect(ids(c("aws:SourceIp"))).toEqual([]);
  });
  it("condition key valid if supported by at least one action in a multi-service statement", () => {
    const d = doc(allow(["s3:ListBucket", "ec2:StopInstances"], "*", { Condition: { StringEquals: { "s3:prefix": "a" } } }));
    expect(ids(d)).toEqual([]);
  });
  it("resource-type and service-level condition keys count", () => {
    const sv = toSlimService(s3Raw);
    const plain = (k: string) => !k.includes("$") && !k.includes("<") && !k.startsWith("aws:");
    const listBucket = sv.actions.find((a) => a.name === "ListBucket");
    const resKey = sv.resources.filter((r) => listBucket?.resources.includes(r.name)).flatMap((r) => r.conditionKeys).find(plain);
    const svcKey = sv.conditionKeys.find((k) => plain(k) && !listBucket?.conditionKeys.includes(k));
    const keys = [resKey, svcKey].filter((x): x is string => !!x);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(ids(doc(allow("s3:ListBucket", BUCKET, { Condition: { StringEquals: { [k]: "x" } } })))).toEqual([]);
    }
  });
  it("full wildcard action only allows global or known-service-prefixed keys", () => {
    expect(ids(doc(allow("*", "*", { Condition: { StringEquals: { "aws:SourceIp": "1.2.3.4" } } })))).toEqual([]);
    expect(ids(doc(allow("*", "*", { Condition: { StringEquals: { "aws:Nope": "1" } } })))).toEqual(["V_CONDITION_KEY"]);
    expect(ids(doc(allow("*", "*", { Condition: { StringEquals: { "s3:prefix": "1" } } })))).toEqual([]);
    expect(ids(doc(allow("*", "*", { Condition: { StringEquals: { "nosuch:prefix": "1" } } })))).toEqual(["V_CONDITION_KEY"]);
  });
  it("document-level issues propagate and malformed input never throws", () => {
    expect(ids({ Version: "2008-10-17", Statement: [allow("s3:Get*")] })).toEqual(["V_VERSION"]);
    expect(ids(doc({ Effect: "Allow", Resource: "*" }))).toEqual(["V_SCHEMA"]);
    for (const bad of [null, undefined, 1, "x", [], { Statement: null }]) expect(() => validateIdentityPolicy(bad, catalog)).not.toThrow();
  });
  it("treats an unparseable ARN as a mismatch", () => {
    expect(ids(doc(allow("s3:GetObject", "not-an-arn")))).toEqual(["V_ACTION_RESOURCE_MISMATCH"]);
  });
});

const ctx: BuildContext = { partition: "aws", accountId: "123456789012" };
const trustIds = (d: unknown) => validateTrustPolicy(d).map((i) => i.id);
const OIDC = "token.actions.githubusercontent.com";
const FED = `arn:aws:iam::123456789012:oidc-provider/${OIDC}`;
const tdoc = (s: object) => doc({ Effect: "Allow", ...s });

describe("validateTrustPolicy", () => {
  it("accepts every valid output of buildTrust", () => {
    const trusts: Trust[] = [
      { kind: "service", service: "ec2" },
      { kind: "service", service: "lambda" },
      { kind: "service", service: "ecs-tasks" },
      { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "main" } },
      { kind: "github", owner: "o", repo: "r", ref: { type: "branch", value: "release/*" } },
      { kind: "github", owner: "o", repo: "r", ref: { type: "tag", value: "v1" } },
      { kind: "github", owner: "o", repo: "r", ref: { type: "environment", value: "prod" } },
      { kind: "github", owner: "o", repo: "r", ref: { type: "pull_request" } },
      { kind: "account", accountId: "111122223333" },
      { kind: "account", accountId: "111122223333", externalId: "abc", requireMfa: true },
      { kind: "account", accountId: "111122223333", requireMfa: true },
    ];
    for (const t of trusts) {
      const r = buildTrust(t, ctx);
      expect(r.doc).not.toBeNull();
      expect(validateTrustPolicy(r.doc)).toEqual([]);
    }
  });
  it("rejects wildcard principals", () => {
    expect(trustIds(tdoc({ Principal: "*", Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
    expect(trustIds(tdoc({ Principal: { AWS: "*" }, Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
    expect(trustIds(tdoc({ Principal: { AWS: ["arn:aws:iam::1:root", "*"] }, Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
    expect(trustIds(tdoc({ Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
    expect(trustIds(tdoc({ Principal: {}, Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
    expect(trustIds(tdoc({ Principal: { Bogus: "x" }, Action: "sts:AssumeRole" }))).toEqual(["V_TRUST_PRINCIPAL"]);
  });
  it("checks actions", () => {
    const cond = { StringEquals: { [`${OIDC}:sub`]: "x" } };
    expect(trustIds(tdoc({ Principal: { Federated: FED }, Action: "sts:AssumeRole", Condition: cond }))).toEqual(["V_TRUST_ACTION"]);
    expect(trustIds(tdoc({ Principal: { Service: "ec2.amazonaws.com" }, Action: "s3:GetObject" }))).toEqual(["V_TRUST_ACTION"]);
    expect(trustIds(tdoc({ Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:*" }))).toEqual(["V_TRUST_ACTION"]);
    expect(trustIds(tdoc({ Principal: { Service: "ec2.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }))).toEqual([]);
    expect(trustIds(tdoc({ Principal: { Federated: "arn:aws:iam::1:saml-provider/x" }, Action: "sts:AssumeRoleWithSAML" }))).toEqual([]);
  });
  it("rejects Resource", () => {
    expect(trustIds(tdoc({ Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole", Resource: "*" }))).toEqual(["V_TRUST_HAS_RESOURCE"]);
  });
  it("requires a sub condition for GitHub", () => {
    const base = { Principal: { Federated: FED }, Action: "sts:AssumeRoleWithWebIdentity" };
    expect(trustIds(tdoc(base))).toEqual(["V_GITHUB_SUB_MISSING"]);
    expect(trustIds(tdoc({ ...base, Condition: { StringEquals: { [`${OIDC}:aud`]: "sts.amazonaws.com" } } }))).toEqual(["V_GITHUB_SUB_MISSING"]);
    expect(trustIds(tdoc({ ...base, Condition: { StringLike: { [`${OIDC}:SUB`]: "repo:o/r:*" } } }))).toEqual([]);
  });
  it("validates trust condition operators and keys", () => {
    const p = { Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" };
    expect(trustIds(tdoc({ ...p, Condition: { Bogus: { "sts:ExternalId": "x" } } }))).toEqual(["V_CONDITION_OPERATOR"]);
    expect(trustIds(tdoc({ ...p, Condition: { StringEquals: { "s3:prefix": "x" } } }))).toEqual(["V_CONDITION_KEY"]);
    expect(trustIds(tdoc({ ...p, Condition: { StringEquals: { "sts:RoleSessionName": "x", "aws:SourceAccount": "1" } } }))).toEqual([]);
  });
  it("document-level issues and malformed input", () => {
    expect(trustIds({ Version: "2008-10-17", Statement: [] })).toEqual(["V_VERSION", "V_EMPTY_STATEMENTS"]);
    expect(trustIds(doc({ Action: "sts:AssumeRole" }))).toEqual(["V_SCHEMA"]);
    for (const bad of [null, 3, {}]) expect(() => validateTrustPolicy(bad)).not.toThrow();
  });
});
