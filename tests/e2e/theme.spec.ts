import { expect, test } from "./fixtures";

test("dark by default; the toggle switches to light and a reload keeps it", async ({ page }) => {
  await page.goto("/builder");
  const body = page.locator("body");
  await expect(body).toHaveClass(/\bawsui-dark-mode\b/);
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await expect(body).not.toHaveClass(/\bawsui-dark-mode\b/);
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch to dark theme" })).toBeVisible();
  await expect(body).not.toHaveClass(/\bawsui-dark-mode\b/);
});
