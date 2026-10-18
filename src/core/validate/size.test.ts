import { describe, expect, it } from "vitest";
import { LIMITS, policyLimit, policySize } from "./size";

describe("policySize", () => {
  it("counts compact JSON length", () => {
    expect(policySize({ Version: "2012-10-17", Statement: [] })).toBe(39);
  });
  it("excludes whitespace everywhere", () => {
    const d = { Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: "s3:Get Object", Resource: "*" }] } as const;
    expect(policySize(d as never)).toBe(JSON.stringify(d).length - 1);
  });
  it("exposes limits", () => {
    expect(LIMITS).toEqual({ managed: 6144, inline: 10240, inlineUser: 2048, inlineGroup: 5120, trust: 2048 });
  });
});

describe("policyLimit", () => {
  it("picks the quota by mode and target", () => {
    const user = { kind: "principal", target: "user", name: "u" } as const;
    const group = { kind: "principal", target: "group", name: "g" } as const;
    const role = { kind: "service", service: "ec2" } as const;
    expect(policyLimit("managed", user)).toBe(6144);
    expect(policyLimit("managed", role)).toBe(6144);
    expect(policyLimit("inline", user)).toBe(2048);
    expect(policyLimit("inline", group)).toBe(5120);
    expect(policyLimit("inline", role)).toBe(10240);
  });
});
