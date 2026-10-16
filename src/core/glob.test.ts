import { describe, expect, it } from "vitest";
import { globMatch } from "./glob";

describe("globMatch", () => {
  it.each([
    ["", "", true],
    ["abc", "abc", true],
    ["abc", "abd", false],
    ["a*", "a", true],
    ["a*c", "abbbc", true],
    ["a*c", "abbbd", false],
    ["a?c", "abc", true],
    ["a?c", "ac", false],
    ["*", "", true],
    ["**a**", "xxaxx", true],
    ["a", "", false],
    ["", "a", false],
  ])("%j vs %j -> %s", (p, t, r) => expect(globMatch(p, t)).toBe(r));
  it("is linear-ish on adversarial input", () => {
    const start = performance.now();
    expect(globMatch("*".repeat(50) + "Z", "a".repeat(5000))).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
