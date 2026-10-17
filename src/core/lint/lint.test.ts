import { describe, expect, it } from "vitest";
import iamRaw from "../../../public/data/svc/iam.json";
import stsRaw from "../../../public/data/svc/sts.json";
import kmsRaw from "../../../public/data/svc/kms.json";
import ec2Raw from "../../../public/data/svc/ec2.json";
import { createCatalog } from "../catalog/catalog";
import { generate } from "../generate";
import { createEmptyModel, type Grant, type RoleModel } from "../model/model";
import type { Issue, PolicyDocument, SlimService, Statement } from "../types";
import { lint } from "./lint";

const catalog = createCatalog([iamRaw, stsRaw, kmsRaw, ec2Raw] as unknown as SlimService[]);

const doc = (...s: Statement[]): PolicyDocument => ({ Version: "2012-10-17", Statement: s });
const allow = (Action: string | string[], Resource: string | string[]): Statement => ({
  Effect: "Allow",
  Action,
  Resource,
});
const run = (policy: PolicyDocument | null, over: Partial<RoleModel> = {}, trust: PolicyDocument | null = null) =>
  lint({ ...createEmptyModel(), ...over }, policy, trust, catalog);
const ids = (issues: Issue[]) => issues.map((i) => i.id);

describe("L_PASSROLE_STAR", () => {
  it("flags PassRole on *", () => {
    const r = run(doc(allow("iam:PassRole", "*")));
    const i = r.find((x) => x.id === "L_PASSROLE_STAR");
    expect(i?.severity).toBe("error");
    expect(i?.message).toContain("iam:PassRole");
  });
  it("flags iam:*, *, and iam:Pass* with star in array", () => {
    for (const a of ["iam:*", "*", "iam:Pass*"]) {
      expect(ids(run(doc(allow(a, ["arn:aws:iam::1:role/x", "*"]))))).toContain("L_PASSROLE_STAR");
    }
  });
  it("does not flag PassRole on a role ARN or a Deny", () => {
    expect(ids(run(doc(allow("iam:PassRole", "arn:aws:iam::123456789012:role/x"))))).not.toContain("L_PASSROLE_STAR");
    expect(ids(run(doc({ Effect: "Deny", Action: "iam:PassRole", Resource: "*" })))).not.toContain("L_PASSROLE_STAR");
  });
});

describe("L_ACTION_STAR", () => {
  it("flags * and svc:*", () => {
    expect(ids(run(doc(allow("*", "arn:aws:s3:::b"))))).toContain("L_ACTION_STAR");
    const i = run(doc(allow(["ec2:*", "ec2:DescribeVpcs"], "arn:aws:s3:::b"))).find((x) => x.id === "L_ACTION_STAR");
    expect(i?.severity).toBe("warning");
    expect(i?.message).toContain("ec2:*");
    expect(i?.message).not.toContain("DescribeVpcs");
  });
  it("does not flag specific actions or Deny", () => {
    expect(ids(run(doc(allow("ec2:Describe*", "*"))))).not.toContain("L_ACTION_STAR");
    expect(ids(run(doc({ Effect: "Deny", Action: "*", Resource: "*" })))).not.toContain("L_ACTION_STAR");
  });
});

describe("L_DESTRUCTIVE_STAR", () => {
  it("flags Delete/Terminate on *", () => {
    const i = run(doc(allow(["ec2:TerminateInstances", "ec2:DeleteVpc", "ec2:DescribeVpcs"], "*"))).find(
      (x) => x.id === "L_DESTRUCTIVE_STAR",
    );
    expect(i?.severity).toBe("warning");
    expect(i?.message).toContain("ec2:DeleteVpc");
    expect(i?.message).toContain("ec2:TerminateInstances");
    expect(i?.message).not.toContain("DescribeVpcs");
  });
  it("flags permissions-management level via catalog", () => {
    const i = run(doc(allow("iam:AttachRolePolicy", "*"))).find((x) => x.id === "L_DESTRUCTIVE_STAR");
    expect(i?.message).toContain("iam:AttachRolePolicy");
  });
  it("expands wildcards and * and truncates long lists", () => {
    const w = run(doc(allow("iam:*", "*"))).find((x) => x.id === "L_DESTRUCTIVE_STAR");
    expect(w?.message).toMatch(/and \d+ more/);
    expect(ids(run(doc(allow("*", "*"))))).toContain("L_DESTRUCTIVE_STAR");
  });
  it("flags unknown-service Delete actions by name only", () => {
    expect(ids(run(doc(allow("nosuch:DeleteThing", "*"))))).toContain("L_DESTRUCTIVE_STAR");
  });
  it("not flagged when scoped, safe, or Deny", () => {
    expect(ids(run(doc(allow("ec2:DeleteVpc", "arn:aws:ec2:*:*:vpc/*"))))).not.toContain("L_DESTRUCTIVE_STAR");
    expect(ids(run(doc(allow("ec2:DescribeVpcs", "*"))))).not.toContain("L_DESTRUCTIVE_STAR");
    expect(ids(run(doc({ Effect: "Deny", Action: "ec2:DeleteVpc", Resource: "*" })))).not.toContain("L_DESTRUCTIVE_STAR");
    expect(ids(run(doc({ Effect: "Allow", Action: "ec2:DeleteVpc" })))).not.toContain("L_DESTRUCTIVE_STAR");
  });
});

describe("L_SENSITIVE", () => {
  it("flags iam write families", () => {
    for (const a of ["iam:CreateRole", "iam:PutRolePolicy", "iam:AttachRolePolicy", "iam:UpdateRole", "iam:DeleteRole"]) {
      const i = run(doc(allow(a, "arn:aws:iam::1:role/x"))).find((x) => x.id === "L_SENSITIVE");
      expect(i?.severity).toBe("warning");
      expect(i?.message).toContain(a);
    }
  });
  it("expands wildcards: iam:* and *", () => {
    expect(ids(run(doc(allow("iam:*", "arn:aws:iam::1:role/x"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("*", "arn:aws:iam::1:role/x"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("iam:Create*", "arn:aws:iam::1:role/x"))))).toContain("L_SENSITIVE");
  });
  it("sts:AssumeRole only on *", () => {
    expect(ids(run(doc(allow("sts:AssumeRole", "*"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("sts:*", "*"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("sts:AssumeRole", "arn:aws:iam::1:role/x"))))).not.toContain("L_SENSITIVE");
  });
  it("flags kms:* and organizations:* only as full wildcards", () => {
    expect(ids(run(doc(allow("kms:*", "arn:aws:kms:*:*:key/k"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("organizations:*", "*"))))).toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("kms:Encrypt", "*"))))).not.toContain("L_SENSITIVE");
  });
  it("ignores safe actions, missing services and Deny", () => {
    expect(ids(run(doc(allow("iam:GetRole", "*"))))).not.toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("nosuch:*", "*"))))).not.toContain("L_SENSITIVE");
    expect(ids(run(doc({ Effect: "Deny", Action: "iam:CreateRole", Resource: "*" })))).not.toContain("L_SENSITIVE");
    expect(ids(run(doc(allow("noColon", "*"))))).not.toContain("L_SENSITIVE");
  });
});

describe("L_GITHUB_SAML", () => {
  const gh = "arn:aws:iam::1:oidc-provider/token.actions.githubusercontent.com";
  const t = (Federated: string | string[], Action: string | string[]): PolicyDocument =>
    doc({ Effect: "Allow", Principal: { Federated }, Action });
  it("flags GitHub OIDC with SAML", () => {
    const i = run(null, {}, t(gh, "sts:AssumeRoleWithSAML")).find((x) => x.id === "L_GITHUB_SAML");
    expect(i?.severity).toBe("error");
    expect(ids(run(null, {}, t([gh], ["sts:AssumeRoleWithSAML"])))).toContain("L_GITHUB_SAML");
  });
  it("not flagged for web identity, other providers, or non-federated", () => {
    expect(ids(run(null, {}, t(gh, "sts:AssumeRoleWithWebIdentity")))).not.toContain("L_GITHUB_SAML");
    expect(ids(run(null, {}, t("arn:aws:iam::1:saml-provider/Okta", "sts:AssumeRoleWithSAML")))).not.toContain("L_GITHUB_SAML");
    expect(
      ids(run(null, {}, doc({ Effect: "Allow", Principal: { AWS: "x" }, Action: "sts:AssumeRoleWithSAML" }))),
    ).not.toContain("L_GITHUB_SAML");
    expect(
      ids(run(null, {}, doc({ Effect: "Allow", Principal: "*", Action: "sts:AssumeRoleWithSAML" }))),
    ).not.toContain("L_GITHUB_SAML");
    expect(ids(run(null, {}, doc({ Effect: "Allow", Action: "sts:AssumeRoleWithSAML" })))).not.toContain("L_GITHUB_SAML");
  });
});

describe("L_USERNAME_IN_ROLE", () => {
  const p = doc(allow("s3:GetObject", "arn:aws:s3:::b/${aws:username}/*"));
  const msg =
    "${aws:username} is empty for role sessions, so these statements grant nothing to this role. Use ${aws:userid} or ${aws:PrincipalTag/<key>}.";
  it("flags in resource with service trust", () => {
    const i = run(p, { trust: { kind: "service", service: "ec2" } }).find((x) => x.id === "L_USERNAME_IN_ROLE");
    expect(i?.severity).toBe("warning");
    expect(i?.message).toBe(msg);
  });
  it("flags in condition values (string and array)", () => {
    for (const v of ["${aws:username}", ["x", "a/${aws:username}"]]) {
      const s: Statement = { Effect: "Allow", Action: "s3:ListBucket", Resource: "*", Condition: { StringLike: { "s3:prefix": v } } };
      expect(ids(run(doc(s)))).toContain("L_USERNAME_IN_ROLE");
    }
  });
  it("not flagged for principal trust or when absent", () => {
    expect(ids(run(p, { trust: { kind: "principal", target: "user", name: "bob" } }))).not.toContain("L_USERNAME_IN_ROLE");
    expect(ids(run(doc(allow("s3:GetObject", "*"))))).not.toContain("L_USERNAME_IN_ROLE");
  });
});

describe("L_UNUSED_ARN", () => {
  const grant = (arns: string[], over: Partial<Grant> = {}): Grant => ({
    id: "g1",
    service: "ec2",
    scope: { type: "arns", arns },
    access: { type: "actions", actions: ["DescribeVpcs"] },
    ...over,
  });
  it("flags scope ARNs absent from every statement", () => {
    const used = "arn:aws:ec2:*:*:vpc/vpc-1";
    const unused = "arn:aws:ec2:*:*:subnet/subnet-1";
    const p = doc(allow("ec2:DeleteVpc", used));
    const r = run(p, { grants: [grant([used, unused, " ", "*"])] });
    const hits = r.filter((x) => x.id === "L_UNUSED_ARN");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.severity).toBe("info");
    expect(hits[0]?.message).toContain(unused);
    expect(hits[0]?.grantId).toBe("g1");
  });
  it("counts ARNs in array resources and ignores all-scope/module grants", () => {
    const a = "arn:aws:ec2:*:*:vpc/vpc-1";
    const p = doc(allow("ec2:DeleteVpc", [a, "arn:aws:ec2:*:*:vpc/vpc-2"]), { Effect: "Allow", Action: "ec2:X" });
    expect(ids(run(p, { grants: [grant([a])] }))).not.toContain("L_UNUSED_ARN");
    const others: Grant[] = [
      grant([], { scope: { type: "all" } }),
      grant([a], { scope: { type: "module", data: {} } }),
    ];
    expect(ids(run(p, { grants: others }))).not.toContain("L_UNUSED_ARN");
    expect(ids(run(null, { grants: [grant([a])] }))).not.toContain("L_UNUSED_ARN");
  });
});

describe("lint robustness", () => {
  it("never throws and returns [] for null inputs", () => {
    expect(run(null)).toEqual([]);
    expect(lint(createEmptyModel(), { Version: "2012-10-17", Statement: null } as never, null, catalog)).toEqual([]);
  });
  it("is deterministic", () => {
    const p = doc(allow("*", "*"), allow("iam:*", "*"));
    expect(run(p)).toEqual(run(p));
  });
});

describe("generate integration", () => {
  it("surfaces L_DESTRUCTIVE_STAR for iam permissions management on all", () => {
    const r = generate(
      {
        ...createEmptyModel(),
        grants: [
          {
            id: "g1",
            service: "iam",
            scope: { type: "all" },
            access: { type: "levels", levels: ["Permissions management"] },
          },
        ],
      },
      catalog,
    );
    expect(ids(r.issues)).toContain("L_DESTRUCTIVE_STAR");
    expect(ids(r.issues)).toContain("L_SENSITIVE");
  });
});
