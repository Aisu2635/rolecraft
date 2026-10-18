import { buildS3Role, expect, test } from "./fixtures";

test("an invalid bucket blocks Export, and Jump to lands on the bucket", async ({ page }) => {
  const grant = await buildS3Role(page, "Bad_Bucket");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export is blocked" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Fix the errors before exporting.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download ZIP" })).toHaveCount(0);

  await dialog.getByRole("button", { name: /^Jump to: / }).first().click();
  await expect(dialog).toBeHidden();
  await expect(grant.getByRole("textbox", { name: "Bucket" })).toBeFocused();

  const output = page.getByRole("region", { name: "Generated output" });
  await output.getByRole("tab", { name: "Terraform" }).click();
  await expect(output.getByRole("tabpanel").getByText("Fix the errors before exporting.")).toBeVisible();
});
