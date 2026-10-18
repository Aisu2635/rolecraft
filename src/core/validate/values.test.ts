import { describe, expect, it } from "vitest";
import { createEmptyModel, type RoleModel, type Trust } from "../model/model";
import { managedPolicyCountIssue, validateModelValues } from "./values";

const ids = (m: RoleModel) => validateModelValues(m).map((i) => i.id);
const withTrust = (trust: Trust): RoleModel => ({ ...createEmptyModel(), trust });

describe("validateModelValues", () => {
  it("accepts the empty model", () => expect(validateModelValues(createEmptyModel())).toEqual([]));
  it("role name", () => {
    expect(ids({ ...createEmptyModel(), name: "my role" })).toEqual(["V_ROLE_NAME"]);
    expect(ids({ ...createEmptyModel(), name: "a".repeat(65) })).toEqual(["V_ROLE_NAME"]);
    expect(ids({ ...createEmptyModel(), name: "a".repeat(64) })).toEqual([]);
    expect(ids({ ...createEmptyModel(), name: "" })).toEqual(["V_ROLE_NAME"]);
  });
  it("account id and region", () => {
    expect(ids({ ...createEmptyModel(), accountId: "12345" })).toEqual(["V_ACCOUNT_ID"]);
    expect(ids({ ...createEmptyModel(), accountId: "123456789012" })).toEqual([]);
    expect(ids({ ...createEmptyModel(), region: "us-east-1" })).toEqual([]);
    expect(ids({ ...createEmptyModel(), region: "us-gov-west-1" })).toEqual(["V_REGION"]);
    expect(ids({ ...createEmptyModel(), region: "useast1" })).toEqual(["V_REGION"]);
  });
  it("blank optional fields count as unset", () => {
    expect(ids({ ...createEmptyModel(), accountId: "", region: "" })).toEqual([]);
  });
  it("account trust", () => {
    const issues = validateModelValues(withTrust({ kind: "account", accountId: "1" }));
    expect(issues.map((i) => [i.id, i.path])).toEqual([["V_ACCOUNT_ID", "trust.accountId"]]);
    expect(ids(withTrust({ kind: "account", accountId: "123456789012" }))).toEqual([]);
  });
  it("github trust", () => {
    const gh = (owner: string, repo: string): Trust => ({ kind: "github", owner, repo, ref: { type: "pull_request" } });
    const issues = validateModelValues(withTrust(gh("-bad", "my repo")));
    expect(issues.map((i) => [i.id, i.path])).toEqual([
      ["V_GITHUB_OWNER", "trust.owner"],
      ["V_GITHUB_REPO", "trust.repo"],
    ]);
    expect(ids(withTrust(gh("octo-cat", "my.repo_1")))).toEqual([]);
    expect(ids(withTrust(gh("a".repeat(40), "r")))).toEqual(["V_GITHUB_OWNER"]);
  });
  it("principal name", () => {
    expect(ids(withTrust({ kind: "principal", target: "group", name: "bad name" }))).toEqual(["V_PRINCIPAL_NAME"]);
    expect(ids(withTrust({ kind: "principal", target: "user", name: "ok.user@x" }))).toEqual([]);
  });
  it("service trust has no values", () => expect(ids(withTrust({ kind: "service", service: "ec2" }))).toEqual([]));
  it("does not throw on malformed input", () => {
    expect(() => validateModelValues({} as never)).not.toThrow();
    expect(validateModelValues(null as never).length).toBeGreaterThan(0);
    expect(validateModelValues({ name: "x", trust: null } as never)).toEqual([]);
  });
  it("rejects regions outside partition aws", () => {
    for (const region of ["us-gov-east-1", "cn-north-1", "cn-northwest-1", "us-iso-east-1", "us-isob-east-1"]) {
      expect(ids({ ...createEmptyModel(), region })).toEqual(["V_REGION"]);
    }
  });
  it("external id", () => {
    const acct = (externalId?: string) => withTrust({ kind: "account", accountId: "123456789012", externalId });
    expect(ids(acct(undefined))).toEqual([]);
    expect(ids(acct(""))).toEqual([]);
    expect(ids(acct("abc-123_x:y/z@1.2"))).toEqual([]);
    expect(ids(acct("a"))).toEqual(["V_EXTERNAL_ID"]);
    expect(ids(acct("has space"))).toEqual(["V_EXTERNAL_ID"]);
    expect(ids(acct('q"uote'))).toEqual(["V_EXTERNAL_ID"]);
    expect(ids(acct("x".repeat(1225)))).toEqual(["V_EXTERNAL_ID"]);
    expect(ids(acct("x".repeat(1224)))).toEqual([]);
  });
  it("managed policy ARNs", () => {
    const m = (managedPolicyArns: string[]) => ({ ...createEmptyModel(), managedPolicyArns });
    expect(ids(m(["arn:aws:iam::aws:policy/ReadOnlyAccess", "arn:aws:iam::123456789012:policy/team/p"]))).toEqual([]);
    expect(ids(m(["arn:aws:iam::aws:role/x"]))).toEqual(["V_MANAGED_POLICY_ARN"]);
    expect(ids(m(["arn:aws:iam::12345:policy/x"]))).toEqual(["V_MANAGED_POLICY_ARN"]);
    expect(ids(m(["ReadOnlyAccess"]))).toEqual(["V_MANAGED_POLICY_ARN"]);
  });
  it("duplicate managed policy ARNs", () => {
    const m = (managedPolicyArns: string[]) => ({ ...createEmptyModel(), managedPolicyArns });
    const a = "arn:aws:iam::aws:policy/A";
    const b = "arn:aws:iam::aws:policy/B";
    expect(ids(m([a, b]))).toEqual([]);
    const issues = validateModelValues(m([a, b, a, a]));
    expect(issues.map((i) => i.id)).toEqual(["V_DUPLICATE_MANAGED_POLICY_ARN", "V_DUPLICATE_MANAGED_POLICY_ARN"]);
    expect(issues.map((i) => i.path)).toEqual(["managedPolicyArns[2]", "managedPolicyArns[3]"]);
    expect(issues[0]?.severity).toBe("error");
  });
  it("managed policy count: ARNs plus the generated managed policy, at most 10", () => {
    const arns = (n: number) => Array.from({ length: n }, (_, i) => `arn:aws:iam::aws:policy/P${i}`);
    const m = (n: number) => ({ ...createEmptyModel(), managedPolicyArns: arns(n) });
    // validateModelValues doesn't know whether a policy is generated; generate() adds this check.
    expect(ids(m(25))).toEqual([]);
    expect(managedPolicyCountIssue(m(9), true)).toBeNull();
    expect(managedPolicyCountIssue(m(10), false)).toBeNull();
    const over = managedPolicyCountIssue(m(10), true);
    expect(over?.id).toBe("V_TOO_MANY_MANAGED_POLICIES");
    expect(over?.severity).toBe("error");
    expect(over?.path).toBe("managedPolicyArns");
    expect(over?.message).toContain("11");
    expect(over?.message).toContain("the policy RoleCraft generates counts");
    expect(over?.message).toContain("20");
    const overNoGen = managedPolicyCountIssue(m(11), false);
    expect(overNoGen?.id).toBe("V_TOO_MANY_MANAGED_POLICIES");
    expect(overNoGen?.message).not.toContain("generates");
  });
});
