import { createEmptyModel } from "../../src/core/model/model";
import { expect, shareHash, test } from "./fixtures";

// The shared fixture marks the tour as seen; this spec is a first-time visitor.
test.use({ tourSeen: false });

test("a first visit shows the tour; Done hides it for good and Take the tour brings it back", async ({ page }) => {
  await page.goto("/builder");
  const card = page.getByRole("dialog", { name: "Pick AWS services" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 of 5");
  await expect(card).toBeFocused();

  for (let i = 0; i < 4; i++) await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
  const last = page.getByRole("dialog", { name: "Copy, export or share" });
  await expect(last).toContainText("5 of 5");
  await last.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole("button", { name: "Trusted entity" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(page.getByRole("dialog", { name: "Pick AWS services" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Take the tour" })).toBeFocused();
});

test("a shared link opens without the tour", async ({ page }) => {
  await page.goto("/builder" + shareHash({ ...createEmptyModel(), name: "shared-role" }));
  await expect(page.getByRole("button", { name: "Trusted entity" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
