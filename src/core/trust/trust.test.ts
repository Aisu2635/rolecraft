import { describe, expect, it } from "vitest";
import type { BuildContext } from "../arn";
import type { Trust } from "../model/model";
import { buildTrust } from "./trust";

const ctx: BuildContext = { partition: "aws", accountId: "123456789012" };
const OIDC = "token.actions.githubusercontent.com";
const FED = `arn:aws:iam::123456789012:oidc-provider/${OIDC}`;

function gh(ref: { type: "branch" | "tag" | "environment" | "pull_request"; value?: string }, owner = "o", repo = "r"): Trust {
  return { kind: "github", owner, repo, ref };
}
function ghDoc(sub: string, op: "StringEquals" | "StringLike" = "StringEquals") {
  const condition =
    op === "StringEquals"
      ? { StringEquals: { [`${OIDC}:aud`]: "sts.amazonaws.com", [`${OIDC}:sub`]: sub } }
      : { StringEquals: { [`${OIDC}:aud`]: "sts.amazonaws.com" }, StringLike: { [`${OIDC}:sub`]: sub } };
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Federated: FED },
        Action: "sts:AssumeRoleWithWebIdentity",
        Condition: condition,
      },
    ],
  };
}

describe("buildTrust service", () => {
  it.each(["ec2", "lambda", "ecs-tasks"] as const)("builds %s", (service) => {
    const r = buildTrust({ kind: "service", service }, ctx);
    expect(r.issues).toStrictEqual([]);
    expect(r.doc).toStrictEqual({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Principal: { Service: `${service}.amazonaws.com` }, Action: "sts:AssumeRole" },
      ],
    });
  });
});

describe("buildTrust github", () => {
  it("branch", () => {
    const r = buildTrust(gh({ type: "branch", value: "main" }), ctx);
    expect(r.issues).toStrictEqual([]);
    expect(r.doc).toStrictEqual(ghDoc("repo:o/r:ref:refs/heads/main"));
  });
  it("tag", () => {
    expect(buildTrust(gh({ type: "tag", value: "v1" }), ctx).doc).toStrictEqual(ghDoc("repo:o/r:ref:refs/tags/v1"));
  });
  it("environment", () => {
    expect(buildTrust(gh({ type: "environment", value: "prod" }), ctx).doc).toStrictEqual(
      ghDoc("repo:o/r:environment:prod"),
    );
  });
  it("pull_request ignores value", () => {
    const r = buildTrust(gh({ type: "pull_request", value: "ignored" }), ctx);
    expect(r.issues).toStrictEqual([]);
    expect(r.doc).toStrictEqual(ghDoc("repo:o/r:pull_request"));
  });
  it("wildcard branch uses StringLike and warns", () => {
    const r = buildTrust(gh({ type: "branch", value: "release/*" }), ctx);
    expect(r.doc).toStrictEqual(ghDoc("repo:o/r:ref:refs/heads/release/*", "StringLike"));
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["W_GITHUB_WILDCARD", "warning"]]);
  });
  it("wildcard tag warns", () => {
    const r = buildTrust(gh({ type: "tag", value: "v*" }), ctx);
    expect(r.doc).toStrictEqual(ghDoc("repo:o/r:ref:refs/tags/v*", "StringLike"));
    expect(r.issues[0]?.id).toBe("W_GITHUB_WILDCARD");
  });
  it("missing account", () => {
    const r = buildTrust(gh({ type: "branch", value: "main" }), { partition: "aws" });
    expect(r.doc).toBeNull();
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["E_GITHUB_NEEDS_ACCOUNT", "error"]]);
  });
  it.each(["branch", "tag", "environment"] as const)("missing %s value", (type) => {
    for (const value of [undefined, ""]) {
      const r = buildTrust(gh({ type, value }), ctx);
      expect(r.doc).toBeNull();
      expect(r.issues.map((i) => i.id)).toStrictEqual(["E_GITHUB_REF_VALUE"]);
    }
  });
  it("wildcard owner/repo", () => {
    for (const [o, p] of [["o*", "r"], ["o", "*"]] as const) {
      const r = buildTrust(gh({ type: "branch", value: "main" }, o, p), ctx);
      expect(r.doc).toBeNull();
      expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["E_GITHUB_OWNER_REPO_WILDCARD", "error"]]);
    }
  });
  it("empty owner/repo is missing, not wildcard", () => {
    for (const [o, p] of [["", "r"], ["o", ""]] as const) {
      const r = buildTrust(gh({ type: "pull_request" }, o, p), ctx);
      expect(r.doc).toBeNull();
      expect(r.issues.map((i) => i.id)).toStrictEqual(["E_GITHUB_OWNER_REPO_MISSING"]);
    }
  });
});

describe("buildTrust account", () => {
  const base = { kind: "account", accountId: "999999999999" } as const;
  const stmt = (extra: object) => ({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Principal: { AWS: "arn:aws:iam::999999999999:root" }, Action: "sts:AssumeRole", ...extra },
    ],
  });
  it("no externalId warns", () => {
    const r = buildTrust(base, ctx);
    expect(r.doc).toStrictEqual(stmt({}));
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["W_NO_EXTERNAL_ID", "warning"]]);
  });
  it("empty externalId counts as absent", () => {
    expect(buildTrust({ ...base, externalId: "" }, ctx).issues[0]?.id).toBe("W_NO_EXTERNAL_ID");
  });
  it("externalId", () => {
    const r = buildTrust({ ...base, externalId: "abc" }, ctx);
    expect(r.issues).toStrictEqual([]);
    expect(r.doc).toStrictEqual(stmt({ Condition: { StringEquals: { "sts:ExternalId": "abc" } } }));
  });
  it("mfa only", () => {
    const r = buildTrust({ ...base, requireMfa: true }, ctx);
    expect(r.doc).toStrictEqual(stmt({ Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } }));
    expect(r.issues.map((i) => i.id)).toStrictEqual(["W_NO_EXTERNAL_ID"]);
  });
  it("externalId and mfa", () => {
    const r = buildTrust({ ...base, externalId: "abc", requireMfa: true }, ctx);
    expect(r.issues).toStrictEqual([]);
    expect(r.doc).toStrictEqual(
      stmt({
        Condition: {
          StringEquals: { "sts:ExternalId": "abc" },
          Bool: { "aws:MultiFactorAuthPresent": "true" },
        },
      }),
    );
  });
});

describe("buildTrust principal", () => {
  it("group has no doc and no issues", () => {
    expect(buildTrust({ kind: "principal", target: "group", name: "g" }, ctx)).toStrictEqual({ doc: null, issues: [] });
  });
  it("user prefers group", () => {
    const r = buildTrust({ kind: "principal", target: "user", name: "u" }, ctx);
    expect(r.doc).toBeNull();
    expect(r.issues.map((i) => [i.id, i.severity])).toStrictEqual([["I_PREFER_GROUP", "info"]]);
  });
});
