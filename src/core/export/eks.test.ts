import { describe, expect, it } from "vitest";
import { shortHash } from "./eks";

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
