import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { globalConfig } from "zod/v4/core";
import "./zod-config";

describe("zod config", () => {
  it("runs zod jitless, so it never probes `new Function` (a violation under the CSP's script-src 'self')", () => {
    expect(globalConfig.jitless).toBe(true);
  });
  it("is the first import of main.tsx, before any schema can parse", () => {
    const main = readFileSync(resolve(process.cwd(), "src/main.tsx"), "utf8");
    expect(main.split("\n")[0]).toBe('import "./zod-config";');
  });
});
