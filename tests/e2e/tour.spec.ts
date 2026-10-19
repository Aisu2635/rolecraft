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
  await expect(card.getByRole("button", { name: "Previous tour stop" })).toBeDisabled();

  for (let i = 0; i < 4; i++) await page.getByRole("dialog").getByRole("button", { name: "Next tour stop" }).click();
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

test("Esc closes an open dropdown first, then skips the tour from anywhere on the page", async ({ page }) => {
  await page.goto("/builder");
  // The card covers the trust tiles, so GitHub is picked before the tour is taken, and the dropdown is opened
  // from the keyboard.
  await page.getByRole("dialog").getByRole("button", { name: "Skip tour" }).click();
  await page.getByText("GitHub Actions", { exact: true }).click();
  await page.getByRole("button", { name: "Take the tour" }).click();
  const card = page.getByRole("dialog", { name: "Pick AWS services" });
  await expect(card).toBeVisible();
  const refType = page.getByRole("button", { name: /Ref type/ });
  await refType.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("option", { name: "Tag", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option", { name: "Tag", exact: true })).toHaveCount(0);
  await expect(card).toBeVisible();

  await page.getByRole("searchbox", { name: "Search services" }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the card shows a focus ring when it has keyboard focus", async ({ page }) => {
  await page.goto("/builder");
  const card = page.getByRole("dialog", { name: "Pick AWS services" });
  // Back from step 2 from the keyboard disables Back, so focus moves to the card, after a keyboard interaction.
  await card.getByRole("button", { name: "Next tour stop" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").getByRole("button", { name: "Previous tour stop" }).focus();
  await page.keyboard.press("Enter");
  await expect(card).toBeFocused();
  const outline = await card.evaluate((el) => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
  expect(outline).toBe("solid 2px");
});

test("a shared link opens without the tour", async ({ page }) => {
  await page.goto("/builder" + shareHash({ ...createEmptyModel(), name: "shared-role" }));
  await expect(page.getByRole("button", { name: "Trusted entity" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
