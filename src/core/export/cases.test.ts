import { describe, expect, it } from "vitest";
import { loadRealCatalog } from "../engine/modules/__test__/catalog";
import { validateIdentityPolicy } from "../validate/policy";
import { REFERENCE_CASES } from "./__fixtures__/cases";

const catalog = loadRealCatalog(["s3", "ec2", "lambda", "dynamodb", "logs", "eks", "cloudfront", "textract"]);

describe("REFERENCE_CASES", () => {
  it("has the six ids", () => {
    expect(Object.keys(REFERENCE_CASES).sort()).toStrictEqual(
      ["cross-account", "ec2-ssm", "eks-kubectl", "github-deploy", "lambda-api", "s3-group"],
    );
  });
  it("s3-group has no trust policy (group principal)", () => {
    expect(REFERENCE_CASES["s3-group"]?.().result.trust).toBeNull();
  });
  for (const [id, build] of Object.entries(REFERENCE_CASES)) {
    it(`${id}: no errors, valid policy, summary present`, () => {
      const { result, summary, model } = build();
      expect(result.issues.filter((i) => i.severity === "error")).toStrictEqual([]);
      expect(result.policy).not.toBeNull();
      expect(validateIdentityPolicy(result.policy as NonNullable<typeof result.policy>, catalog)).toStrictEqual([]);
      // group/user principal trust has no trust policy
      if (model.trust.kind !== "principal") expect(result.trust).not.toBeNull();
      expect(summary.can.length).toBeGreaterThan(0);
    });
  }
});
