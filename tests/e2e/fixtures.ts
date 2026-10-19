import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { expect as baseExpect, test as base, type Download, type Locator, type Page } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { exportAll } from "../../src/core/export";
import { REFERENCE_CASES } from "../../src/core/export/__fixtures__/cases";
import { VARIANT_CASES } from "../../src/core/export/__fixtures__/variants";
import { roleModelSchema, type RoleModel } from "../../src/core/model/model";

/** Collects a page's console errors and uncaught exceptions into `errors`. */
function trackErrors(page: Page, errors: string[]): void {
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
}

/**
 * Every spec imports `test` from here: a test fails if any page of its context logged a console error or threw,
 * including pages opened later with `context.newPage()`.
 * The first-run tour is marked as seen, so it does not cover the builder; `test.use({ tourSeen: false })` opts out.
 */
export const test = base.extend<{ tourSeen: boolean }>({
  tourSeen: [true, { option: true }],
  context: async ({ context, tourSeen }, use) => {
    // Pages opened with context.newPage() start on about:blank, where localStorage throws.
    if (tourSeen)
      await context.addInitScript(() => {
        try {
          localStorage.setItem("rolecraft.tour.v1", "seen");
        } catch {
          // not an app page
        }
      });
    await use(context);
  },
  page: async ({ page, context }, use) => {
    const errors: string[] = [];
    trackErrors(page, errors);
    context.on("page", (p) => trackErrors(p, errors));
    await use(page);
    if (errors.length > 0) console.log(errors.join("\n"));
    baseExpect(errors, "console errors and page errors").toEqual([]);
  },
});
export const expect = baseExpect;

// lz-string is CommonJS without named ESM exports, so src/core/model/share.ts cannot load under Node ESM.
const lz = createRequire(import.meta.url)("lz-string") as typeof import("lz-string");

/** The `#s=` hash that restores `model`, encoded as share.ts encodeModel does. */
export const shareHash = (model: RoleModel): string => "#s=" + lz.compressToEncodedURIComponent(JSON.stringify(model));

/** The files of a downloaded ZIP, by name, decoded as UTF-8. */
export async function readZip(download: Download): Promise<Record<string, string>> {
  const path = await download.path();
  const entries = unzipSync(new Uint8Array(await readFile(path)));
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
}

/**
 * The files the core exports for a reference (or variant) case: the golden the UI's ZIP must equal byte for byte.
 */
export function referenceFiles(name: string): Record<string, string> {
  const make = REFERENCE_CASES[name] ?? VARIANT_CASES[name];
  if (!make) throw new Error(`No reference case ${name}`);
  const outcome = exportAll(make());
  if (!outcome.ok) throw new Error(`Reference case ${name} does not export: ${outcome.reason}`);
  return Object.fromEntries(outcome.files.map((f) => [f.filename, f.content]));
}

/**
 * The role in the current URL hash, decoded as share.ts decodeModel does (lz-string, then the model schema).
 * The builder writes the hash after a 300 ms debounce, so callers poll.
 */
export async function modelFromPage(page: Page): Promise<RoleModel | null> {
  const hash = await page.evaluate(() => window.location.hash);
  if (!hash.startsWith("#s=")) return null;
  const json = lz.decompressFromEncodedURIComponent(hash.slice(3));
  const parsed = json ? roleModelSchema.safeParse(JSON.parse(json)) : null;
  return parsed?.success ? parsed.data : null;
}

/** Picks an option of a Cloudscape Select by its trigger's accessible name. */
export async function choose(page: Page, select: Locator, option: string): Promise<void> {
  await select.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** Adds a service through the sidebar search. */
export async function addService(page: Page, query: string, name: string): Promise<void> {
  await page.getByRole("searchbox", { name: "Search services" }).fill(query);
  await page.getByRole("list", { name: "Search results" }).getByRole("button", { name, exact: true }).click();
}

/** Adds an S3 permission on `bucket` (default trust: EC2), in the sentence editor. */
export async function buildS3Role(page: Page, bucket: string): Promise<Locator> {
  await page.goto("/builder");
  await addService(page, "s3", "Amazon S3");
  const grant = page.getByRole("group", { name: "Amazon S3 permission" });
  await grant.getByRole("textbox", { name: "Bucket" }).fill(bucket);
  return grant;
}

/** The text of the output panel's code view with this label. */
export const codeText = (page: Page, label: string): Promise<string> =>
  page.getByRole("region", { name: "Generated output" }).getByLabel(label, { exact: true }).innerText();

/**
 * Reads the clipboard (the context must grant clipboard-read). The Windows clipboard turns LF into CRLF on the way
 * through, which is the OS, not the app, so it is undone there.
 */
export async function readClipboard(page: Page): Promise<string> {
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return process.platform === "win32" ? text.replaceAll("\r\n", "\n") : text;
}

/** Opens the Export modal and downloads the ZIP. */
export async function downloadZip(page: Page): Promise<Record<string, string>> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  const pending = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download ZIP" }).click();
  const files = await readZip(await pending);
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
  return files;
}
