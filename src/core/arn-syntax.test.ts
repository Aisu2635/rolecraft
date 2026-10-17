import { describe, expect, it } from "vitest";
import { isValidArnSyntax, hasOnlyAllowedPolicyVariables } from "./arn-syntax";

describe("isValidArnSyntax", () => {
  it.each([
    "arn:aws:s3:::b\nc/*",
    'arn:aws:s3:::b"c/x',
    "arn:aws:s3:::b c/x",
    "arn:aws:s3:::${foo}/x",
    "arn:aws:*",
    "arn:aws:s3:*",
    "arn:aws:s3:::b\\c",
    "arn:aws:s3:::b\u007fc",
    "arn:aws-cn:s3:::b",
    "arn:aws:s3:::",
    "s3:::b",
    "arn:aws:s3:::" + "a".repeat(2048),
  ])("rejects %j", (arn) => {
    expect(isValidArnSyntax(arn)).toBe(false);
  });
  it.each([
    "arn:aws:s3:::home/${aws:username}/*",
    "arn:aws:s3:::t/${aws:PrincipalTag/team}/${aws:userid}",
    "arn:aws:s3:::a${*}b${?}c${$}d",
    "arn:*:s3:::b",
    "arn:aws:logs:us-east-1:123456789012:log-group:/aws/lambda/fn:*",
  ])("accepts %j", (arn) => {
    expect(isValidArnSyntax(arn)).toBe(true);
  });
});

describe("hasOnlyAllowedPolicyVariables", () => {
  it("accepts allowed variables and plain text", () => {
    expect(hasOnlyAllowedPolicyVariables("a/b/")).toBe(true);
    expect(
      hasOnlyAllowedPolicyVariables("h/${aws:username}/${aws:userid}/"),
    ).toBe(true);
    expect(hasOnlyAllowedPolicyVariables("t/${aws:PrincipalTag/team}/")).toBe(
      true,
    );
  });
  it("rejects unknown or incomplete variables", () => {
    expect(hasOnlyAllowedPolicyVariables("h/${foo}/")).toBe(false);
    expect(hasOnlyAllowedPolicyVariables("a${b/")).toBe(false);
  });
});
