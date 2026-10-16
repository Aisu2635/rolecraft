import { describe, expect, it } from "vitest";
import { GLOBAL_CONDITION_KEYS, isGlobalKey, isKnownConditionOperator, keyMatchesTemplate } from "./conditions";

describe("isKnownConditionOperator", () => {
  it.each(["StringEquals", "ForAnyValue:StringLike", "ForAllValues:ArnLike", "StringEqualsIfExists", "Null", "ForAnyValue:NumericLessThanIfExists"])(
    "accepts %s",
    (op) => expect(isKnownConditionOperator(op)).toBe(true),
  );
  it.each(["StringEqual", "NullIfExists", "ForSomeValues:StringLike", "", "stringequals", "ForAnyValue:"])("rejects %s", (op) =>
    expect(isKnownConditionOperator(op)).toBe(false),
  );
});

describe("keys", () => {
  it("lists globals", () => expect(GLOBAL_CONDITION_KEYS).toContain("aws:SourceIp"));
  it("matches global exact and prefix, case-insensitively", () => {
    expect(isGlobalKey("aws:sourceip")).toBe(true);
    expect(isGlobalKey("aws:ResourceTag/env")).toBe(true);
    expect(isGlobalKey("aws:ResourceTag/")).toBe(false);
    expect(isGlobalKey("aws:Nope")).toBe(false);
  });
  it("matches templates", () => {
    expect(keyMatchesTemplate("s3:ExistingObjectTag/a", "s3:ExistingObjectTag/<key>")).toBe(true);
    expect(keyMatchesTemplate("s3:existingobjecttag/a", "s3:ExistingObjectTag/<key>")).toBe(true);
    expect(keyMatchesTemplate("s3:ExistingObjectTag/", "s3:ExistingObjectTag/<key>")).toBe(false);
    expect(keyMatchesTemplate("ec2:Attribute/x", "ec2:Attribute/${AttributeName}")).toBe(true);
    expect(keyMatchesTemplate("s3:prefix", "s3:prefix")).toBe(true);
    expect(keyMatchesTemplate("s3:prefixx", "s3:prefix")).toBe(false);
  });
});
