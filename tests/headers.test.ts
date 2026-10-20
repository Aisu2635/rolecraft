import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Cloudflare Pages: a line with no indent is a path pattern; the indented "Name: value" lines under it are its headers.
function parseHeaders(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] ??= {};
      continue;
    }
    const at = line.indexOf(":");
    if (!current || at < 0) throw new Error(`Bad _headers line: ${line}`);
    current[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return rules;
}

const rules = parseHeaders(readFileSync(resolve(process.cwd(), "public/_headers"), "utf8"));

describe("public/_headers", () => {
  it("sends the CSP on every path, with frame-ancestors 'none' and no off-origin sources", () => {
    const csp = rules["/*"]?.["Content-Security-Policy"];
    expect(csp).toBeDefined();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:|'unsafe-eval'|\*/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it("sends the other security headers on every path", () => {
    expect(rules["/*"]).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("caches hashed assets for a year, data for an hour, and revalidates index.html", () => {
    expect(rules["/assets/*"]?.["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(rules["/data/*"]?.["Cache-Control"]).toBe("public, max-age=3600");
    expect(rules["/index.html"]?.["Cache-Control"]).toBe("no-cache");
    // Pages joins a header set by two matching rules, so /* must not set Cache-Control too.
    expect(rules["/*"]?.["Cache-Control"]).toBeUndefined();
  });
});
