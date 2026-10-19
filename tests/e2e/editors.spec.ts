import type { Page } from "@playwright/test";
import { addService, downloadZip, expect, modelFromPage, referenceFiles, test } from "./fixtures";

const editorButton = (page: Page, name: string) =>
  page.getByRole("toolbar", { name: "Editor" }).getByRole("button", { name, exact: true });

test("cross-account built in the grid survives editor switches and exports the reference files", async ({ page }) => {
  await page.goto("/builder");
  await page.getByText("Another AWS account", { exact: true }).click();
  await page.getByRole("textbox", { name: "Trusted account ID" }).fill("210987654321");
  await page.getByRole("textbox", { name: "External ID (optional)" }).fill("rolecraft-ext-01");
  await page.getByRole("checkbox", { name: "Require MFA" }).check();

  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await editorButton(page, "Grid").click();
  await addService(page, "textract", "Amazon Textract");

  const table = page.getByRole("region", { name: "Amazon Textract" });
  await expect(table.getByRole("checkbox", { name: "Read, Not set", exact: true })).toBeChecked();
  for (const level of ["List", "Write", "Tagging", "Permissions management"]) {
    const box = table.getByRole("checkbox", { name: `${level}, Not set`, exact: true });
    if ((await box.count()) > 0) await expect(box).not.toBeChecked();
  }
  await table.getByRole("button", { name: "Edit scope of Amazon Textract" }).click();
  const modal = page.getByRole("dialog", { name: "Edit scope of Amazon Textract" });
  await modal.getByRole("radio", { name: "All resources (*)" }).check();
  await modal.getByRole("button", { name: "Done" }).click();

  await page.getByRole("button", { name: "Review and export" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("audit-reader");
  await expect.poll(async () => (await modelFromPage(page))?.name).toBe("audit-reader");
  const captured = await modelFromPage(page);

  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  for (const editor of ["Sentences", "Grid", "Sentences"]) {
    await editorButton(page, editor).click();
    await expect(editorButton(page, editor)).toHaveAttribute("aria-pressed", "true");
  }
  // Wait past the 300 ms share debounce, so a model change from the switches would have reached the hash.
  await page.waitForTimeout(600);
  expect(await modelFromPage(page)).toEqual(captured);

  expect(await downloadZip(page)).toEqual(referenceFiles("cross-account"));
});
