import { describe, expect, it } from "vitest";
import { EKS_PROPAGATION_ERROR, shortHash } from "./eks";

function fnvBytes(bytes: number[]): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

describe("shortHash", () => {
  it("is FNV-1a 32-bit over UTF-8 as 8 lowercase hex characters", () => {
    expect(shortHash("")).toBe("811c9dc5");
    expect(shortHash("a")).toBe("e40c292c");
    expect(shortHash("foobar")).toBe("bf9cf968");
    expect(shortHash("é")).toMatch(/^[0-9a-f]{8}$/);
    expect(shortHash("é")).not.toBe(shortHash("e"));
    // Same bytes as Node's UTF-8 encoding for 2-, 3- and 4-byte characters.
    expect(shortHash("é€😀")).toBe(fnvBytes([...new TextEncoder().encode("é€😀")]));
  });
});

describe("EKS_PROPAGATION_ERROR", () => {
  // The AWS CLI's stderr when EKS hasn't seen a just-created IAM principal yet.
  const propagation =
    "An error occurred (InvalidParameterException) when calling the CreateAccessEntry operation: The specified principalArn is invalid: invalid principal";
  const re = new RegExp(EKS_PROPAGATION_ERROR, "i");
  it("matches the propagation error, case-insensitively", () => {
    expect(re.test(propagation)).toBe(true);
    expect(re.test(propagation.toLowerCase())).toBe(true);
  });
  it("does not match permanent errors", () => {
    for (const permanent of [
      "An error occurred (ResourceNotFoundException) when calling the CreateAccessEntry operation: No cluster found for name: prod.",
      "An error occurred (AccessDeniedException) when calling the CreateAccessEntry operation: User: arn:aws:iam::123456789012:user/x is not authorized to perform: eks:CreateAccessEntry",
      "An error occurred (InvalidParameterException) when calling the CreateAccessEntry operation: The cluster's authentication mode must be set to one of [API, API_AND_CONFIG_MAP]",
      "An error occurred (ResourceInUseException) when calling the CreateAccessEntry operation: The specified access entry resource is already in use on this cluster.",
    ]) {
      expect(re.test(permanent), permanent).toBe(false);
    }
  });
  it("is safe inside single quotes in bash and PowerShell", () => {
    expect(EKS_PROPAGATION_ERROR).not.toMatch(/['‘’‚‛\n]/);
  });
});
