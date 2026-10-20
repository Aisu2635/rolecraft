import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { addService, codeText, downloadZip, expect, readClipboard, test } from "./fixtures";

/** The headers public/_headers sets for "/*", parsed from the file so this spec and the deployed headers cannot drift. */
function headersForAllPaths(): Record<string, string> {
  const text = readFileSync(resolve(process.cwd(), "public/_headers"), "utf8");
  const out: Record<string, string> = {};
  let inAll = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === "" || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === "/*";
      continue;
    }
    if (!inAll) continue;
    const at = line.indexOf(":");
    out[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return out;
}

const SECURITY = headersForAllPaths();

test.use({ tourSeen: false, permissions: ["clipboard-read", "clipboard-write"] });

test("the whole flow runs under the production CSP with no violations", async ({ page }) => {
  expect(SECURITY["content-security-policy"]).toContain("frame-ancestors 'none'");
  // Vite preview sends no CSP; every response gets the one Cloudflare Pages will send.
  await page.route("**/*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...SECURITY } });
  });
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  const cspConsole: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|CSP/i.test(m.text())) cspConsole.push(m.text());
  });
  const violations = () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);

  // Landing: hero, feature cards and the data fetch.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const cspHeader = await page.evaluate(async () => (await fetch("/")).headers.get("content-security-policy"));
  expect(cspHeader).toBe(SECURITY["content-security-policy"]);
  await page.getByRole("link", { name: "Start from scratch" }).click();

  // Builder: the first-run tour, then skip it.
  const tour = page.getByRole("dialog", { name: "Pick AWS services" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Skip tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // S3 with a bucket.
  await addService(page, "s3", "Amazon S3");
  await page.getByRole("group", { name: "Amazon S3 permission" }).getByRole("textbox", { name: "Bucket" }).fill("csp-bucket");
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output.getByLabel("Policy JSON", { exact: true })).toBeVisible();

  // Every output tab, including the lazily loaded exporters.
  for (const tab of ["Trust", "CLI", "Terraform", "CloudFormation", "Policy"]) {
    await output.getByRole("tab", { name: tab }).click();
    await expect(output.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  }

  // Export modal and the ZIP download (a blob: URL).
  const files = await downloadZip(page);
  expect(Object.keys(files).length).toBeGreaterThan(0);

  // Copy and Share (the clipboard).
  await output.getByRole("button", { name: "Copy", exact: true }).click();
  await expect.poll(() => readClipboard(page)).toBe(await codeText(page, "Policy JSON"));
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect.poll(() => readClipboard(page)).toMatch(/\/builder#s=/);

  expect(await violations()).toEqual([]);
  expect(cspConsole).toEqual([]);
});
