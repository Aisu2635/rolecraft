import { describe, expect, it } from "vitest";
import { readStoredTheme, writeStoredTheme } from "./theme";

describe("theme storage", () => {
  it("defaults to dark when nothing stored", () => {
    expect(readStoredTheme({ getItem: () => null })).toBe("dark");
  });
  it("defaults to dark when storage throws", () => {
    expect(
      readStoredTheme({
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe("dark");
    expect(readStoredTheme(undefined)).toBe("dark");
  });
  it("reads light", () => {
    expect(readStoredTheme({ getItem: () => "light" })).toBe("light");
    expect(readStoredTheme({ getItem: () => "banana" })).toBe("dark");
  });
  it("write swallows errors", () => {
    expect(() =>
      writeStoredTheme(
        {
          setItem: () => {
            throw new Error("full");
          },
        },
        "light",
      ),
    ).not.toThrow();
    expect(() => writeStoredTheme(undefined, "dark")).not.toThrow();
  });
});
