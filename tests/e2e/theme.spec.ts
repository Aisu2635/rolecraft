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

/** Relative luminance (0 black .. 1 white) of a computed `rgb(...)` / `rgba(...)` colour. */
function luminance(css: string): number {
  const [r = 0, g = 0, b = 0] = (css.match(/[\d.]+/g) ?? []).map(Number);
  const lin = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

test("the landing preview card follows the theme", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const parts = [".lp-preview", ".lp-rc", ".lp-rc .lp-sel"];
  const colours = () =>
    page.evaluate(
      (sels) =>
        sels.map((s) => {
          const cs = getComputedStyle(document.querySelector(s)!);
          return { bg: cs.backgroundColor, fg: cs.color };
        }),
      parts,
    );
  for (const { bg, fg } of await colours()) {
    expect(luminance(bg), `dark background ${bg}`).toBeLessThan(0.1);
    expect(luminance(fg), `light text ${fg}`).toBeGreaterThan(0.5);
  }
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  for (const { bg, fg } of await colours()) {
    expect(luminance(bg), `light background ${bg}`).toBeGreaterThan(0.8);
    expect(luminance(fg), `dark text ${fg}`).toBeLessThan(0.1);
  }
});
