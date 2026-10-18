import { createEmptyModel } from "../../src/core/model/model";
import { expect, readClipboard, shareHash, test } from "./fixtures";

test.use({ viewport: { width: 390, height: 844 }, permissions: ["clipboard-read", "clipboard-write"] });

test("a phone gets the desktop-only card, and Copy link keeps the share hash", async ({ page }) => {
  const hash = shareHash({ ...createEmptyModel(), name: "phone-role" });
  await page.goto("/builder" + hash);
  await expect(page.getByRole("heading", { name: "Works best on a laptop or desktop" })).toBeVisible();
  const copyLink = page.getByRole("button", { name: "Copy link" });
  await expect(copyLink).toBeVisible();
  await expect(page.getByRole("button", { name: "Trusted entity" })).toHaveCount(0);
  await copyLink.click();
  await expect.poll(() => readClipboard(page)).toBe(page.url());
  expect(new URL(await readClipboard(page)).hash).toBe(hash);
});
