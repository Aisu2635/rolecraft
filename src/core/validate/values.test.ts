import { describe, expect, it } from "vitest";
import { createEmptyModel, type RoleModel, type Trust } from "../model/model";
import { validateModelValues } from "./values";

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
    expect(ids({ ...createEmptyModel(), region: "us-gov-west-1" })).toEqual([]);
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
});
