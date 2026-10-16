import { describe, expect, it } from "vitest";
import { LIMITS, policySize } from "./size";

describe("policySize", () => {
  it("counts compact JSON length", () => {
    expect(policySize({ Version: "2012-10-17", Statement: [] })).toBe(39);
  });
  it("excludes whitespace everywhere", () => {
    const d = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "s3:Get Object", Resource: "*" }] } as const;
    expect(policySize(d as never)).toBe(JSON.stringify(d).length - 1);
  });
  it("exposes limits", () => {
    expect(LIMITS).toEqual({ managed: 6144, inline: 10240, trust: 2048 });
  });
});
