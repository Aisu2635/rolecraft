import { describe, expect, it } from "vitest";
import type { Issue } from "../../core/types";
import { errorTextAt, focusIdFor, grantIssues, issuesAt } from "./issues";

const i = (p: Partial<Issue> & { id: string }): Issue => ({ severity: "error", message: p.id, ...p });

describe("issuesAt", () => {
  it("matches the exact path and lists errors first", () => {
    const list = [
      i({ id: "w", severity: "warning", path: "name" }),
      i({ id: "e", path: "name" }),
      i({ id: "x", path: "name.sub" }),
      i({ id: "y", path: "region" }),
    ];
    expect(issuesAt(list, "name").map((x) => x.id)).toEqual(["e", "w"]);
    expect(issuesAt(list, "nope")).toEqual([]);
  });
});

describe("errorTextAt", () => {
  it("returns the first error message, ignoring warnings", () => {
    const list = [
      i({ id: "w", severity: "warning", path: "name", message: "warn" }),
      i({ id: "e", path: "name", message: "bad" }),
    ];
    expect(errorTextAt(list, "name")).toBe("bad");
    expect(errorTextAt([list[0]!], "name")).toBeUndefined();
    expect(errorTextAt(list, "region")).toBeUndefined();
  });
});

describe("grantIssues", () => {
  it("keeps issues of one grant", () => {
    const list = [i({ id: "a", grantId: "g1" }), i({ id: "b", grantId: "g2" }), i({ id: "c" })];
    expect(grantIssues(list, "g1").map((x) => x.id)).toEqual(["a"]);
  });
});

describe("focusIdFor", () => {
  it("maps grant issues to step 1", () => {
    expect(focusIdFor(i({ id: "a", grantId: "g1", path: "data.bucket" }))).toEqual({ step: 1, target: "grant:g1" });
  });
  it("maps trust paths to step 0", () => {
    expect(focusIdFor(i({ id: "a", path: "trust.owner" }))).toEqual({ step: 0, target: "field:trust.owner" });
  });
  it("maps details paths to step 2", () => {
    for (const path of ["name", "accountId", "region", "policyMode", "managedPolicyArns", "managedPolicyArns[3]"]) {
      expect(focusIdFor(i({ id: "a", path }))).toEqual({ step: 2, target: "field:" + path });
    }
  });
  it("maps path-less GitHub trust issues to their step 0 fields", () => {
    expect(focusIdFor(i({ id: "E_GITHUB_NEEDS_ACCOUNT" }))).toEqual({ step: 0, target: "field:accountId" });
    expect(focusIdFor(i({ id: "E_GITHUB_REF_VALUE" }))).toEqual({ step: 0, target: "field:trust.ref.value" });
    expect(focusIdFor(i({ id: "E_GITHUB_OWNER_REPO_MISSING" }))).toEqual({ step: 0, target: "field:trust.owner" });
  });
  it("returns null for anything else", () => {
    expect(focusIdFor(i({ id: "a" }))).toBeNull();
    expect(focusIdFor(i({ id: "a", path: "other" }))).toBeNull();
    expect(focusIdFor(i({ id: "a", path: "names" }))).toBeNull();
  });
});
