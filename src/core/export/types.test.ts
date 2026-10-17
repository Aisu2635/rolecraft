import { describe, expect, it } from "vitest";
import { createEmptyModel } from "../model/model";
import type { GenerateResult } from "../generate";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { exportable, hclString, psQuote, shQuote, tfLabel } from "./types";

describe("quoting helpers", () => {
  it("shQuote", () => {
    expect(shQuote("a'b")).toBe(String.raw`'a'\''b'`);
    expect(shQuote("$(rm -rf /)")).toBe("'$(rm -rf /)'");
  });
  it("psQuote", () => {
    expect(psQuote("a'b")).toBe("'a''b'");
  });
  it("hclString", () => {
    expect(hclString("x${y}")).toBe('"x$${y}"');
    expect(hclString("x%{y}")).toBe('"x%%{y}"');
    expect(hclString('a"b')).toBe('"a\\"b"');
  });
  it("psQuote doubles every Unicode single quote", () => {
    for (const q of ["‘", "’", "‚", "‛"]) {
      expect(psQuote(`a${q}b`)).toBe(`'a${q}${q}b'`);
    }
    expect(psQuote("a’b")).toBe("'a’’b'");
  });
  it("psQuote keeps an injection-shaped input a single literal", () => {
    expect(psQuote("x’; calc; ‘")).toBe("'x’’; calc; ‘‘'");
  });
  it("shQuote edge cases", () => {
    expect(shQuote("")).toBe("''");
    expect(shQuote("a\nb`c`")).toBe("'a\nb`c`'");
  });
  it("hclString does not double-escape an already escaped sequence", () => {
    expect(hclString("$${x}")).toBe('"$$${x}"');
  });
  it("tfLabel edge cases", () => {
    expect(tfLabel("")).toBe("r");
    expect(tfLabel("roleCraftRole")).toBe("rolecraftrole");
  });
  it("tfLabel", () => {
    expect(tfLabel("Rolecraft-Role.1")).toBe("rolecraft_role_1");
    expect(tfLabel("1x")).toBe("r_1x");
  });
});

describe("exportable", () => {
  const ok: GenerateResult = {
    policy: { Version: "2012-10-17", Statement: [] },
    trust: null,
    issues: [],
    sizes: { policy: 0, trust: 0 },
  };
  it("is true for every reference case", () => {
    for (const build of Object.values(REFERENCE_CASES)) {
      const { model, result } = build();
      expect(exportable(result, model)).toBe(true);
    }
  });
  it("is false with an error issue", () => {
    const bad = { ...ok, issues: [{ id: "X", severity: "error" as const, message: "m" }] };
    expect(exportable(bad, createEmptyModel())).toBe(false);
  });
  it("needs a policy or managed policy arns", () => {
    const none = { ...ok, policy: null };
    expect(exportable(none, createEmptyModel())).toBe(false);
    const m = { ...createEmptyModel(), managedPolicyArns: ["arn:aws:iam::aws:policy/X"] };
    expect(exportable(none, m)).toBe(true);
  });
});
