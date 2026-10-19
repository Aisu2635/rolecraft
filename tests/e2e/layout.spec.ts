import type { Page } from "@playwright/test";
import { addService, buildS3Role, expect, test } from "./fixtures";

/** The page itself never scrolls: only the three builder columns do. */
async function pageMetrics(page: Page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement ?? document.documentElement;
    const nav = document.getElementById("top-nav")?.getBoundingClientRect().height ?? 0;
    const ws = document.querySelector(".rc-ws")?.getBoundingClientRect();
    const cols = [...document.querySelectorAll<HTMLElement>(".rc-col")].map((c) => ({
      label: c.getAttribute("aria-label") ?? c.className,
      overflowY: getComputedStyle(c).overflowY,
      scrollable: c.scrollHeight > c.clientHeight,
      horizontal: c.scrollWidth > c.clientWidth,
    }));
    return {
      pageScrollY: doc.scrollHeight - window.innerHeight,
      pageScrollX: doc.scrollWidth - window.innerWidth,
      nav,
      wsTop: ws?.top ?? -1,
      wsBottom: ws?.bottom ?? -1,
      innerHeight: window.innerHeight,
      cols,
    };
  });
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport });

    test("the builder fills the window below the top nav, and only the columns scroll", async ({ page }) => {
      await buildS3Role(page, "layout-bucket");
      // Enough content that every column has to scroll.
      for (const [query, name] of [
        ["dynamodb", "Amazon DynamoDB"],
        ["lambda", "AWS Lambda"],
        ["sqs", "Amazon SQS"],
        ["kms", "AWS KMS"],
      ] as const) {
        await addService(page, query, name);
      }
      await page.getByRole("button", { name: "A–Z" }).click();
      const m = await pageMetrics(page);
      console.log(`${viewport.width}×${viewport.height}: ${JSON.stringify(m)}`);
      expect(m.pageScrollY, "page scrolls vertically").toBeLessThanOrEqual(0);
      expect(m.pageScrollX, "page scrolls horizontally").toBeLessThanOrEqual(0);
      expect(m.wsTop).toBe(m.nav);
      expect(m.wsBottom).toBe(m.innerHeight);
      for (const c of m.cols) {
        expect(c.overflowY, c.label).toBe("auto");
        expect(c.horizontal, `${c.label} scrolls horizontally`).toBe(false);
      }
      expect(m.cols.find((c) => c.label === "Services and templates")?.scrollable).toBe(true);

      // A column scrolls on its own: the sidebar moves, the main column does not.
      const side = page.locator(".rc-side");
      const main = page.locator(".rc-main");
      // Adding a grant scrolls it into view, so the main column is compared with where it already is.
      const mainTop = await main.evaluate((el) => el.scrollTop);
      await side.hover();
      await page.mouse.wheel(0, 600);
      await expect.poll(() => side.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await main.evaluate((el) => el.scrollTop)).toBe(mainTop);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });
  });
}

test("the individual action picker stays responsive on the largest service without a module", async ({ page }) => {
  await page.goto("/builder");
  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await page.getByRole("toolbar", { name: "Editor" }).getByRole("button", { name: "Grid" }).click();
  await addService(page, "sagemaker", "Amazon SageMaker");
  const region = page.getByRole("region", { name: "Amazon SageMaker" });
  await region.getByRole("button", { name: "Pick individual actions" }).click();

  let t = Date.now();
  await region.getByRole("button", { name: /Individual Amazon SageMaker actions/ }).click();
  await expect(page.getByRole("option").first()).toBeVisible();
  const openMs = Date.now() - t;

  t = Date.now();
  await page.getByRole("combobox", { name: "Find actions" }).fill("CreateTrainingJob");
  await expect(page.getByRole("option", { name: /CreateTrainingJob/ }).first()).toBeVisible();
  const filterMs = Date.now() - t;

  t = Date.now();
  await page.getByRole("option", { name: /CreateTrainingJob/ }).first().click();
  await expect(region.getByText("1 individual action")).toBeVisible();
  const pickMs = Date.now() - t;
  console.log(`SageMaker action picker: open ${openMs} ms, filter ${filterMs} ms, pick ${pickMs} ms`);
  for (const ms of [openMs, filterMs, pickMs]) expect(ms).toBeLessThan(2000);
});
