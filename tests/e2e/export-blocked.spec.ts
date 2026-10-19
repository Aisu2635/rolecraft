import { addService, buildS3Role, expect, test } from "./fixtures";

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

test("in the Grid, Jump to switches to Sentences and lands on the visible bucket field", async ({ page }) => {
  const grant = await buildS3Role(page, "Bad_Bucket");
  await page.getByRole("toolbar", { name: "Editor" }).getByRole("button", { name: "Grid", exact: true }).click();
  await expect(grant).toHaveCount(0);
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export is blocked" });
  await dialog.getByRole("button", { name: /^Jump to: / }).first().click();
  await expect(dialog).toBeHidden();
  const bucket = grant.getByRole("textbox", { name: "Bucket" });
  await expect(bucket).toBeFocused();
  await expect(bucket).toBeInViewport();
});

test("a new S3 grant is a to-do, not an error, until Export reveals it", async ({ page }) => {
  await page.goto("/builder");
  await addService(page, "s3", "Amazon S3");
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output.getByText("To do", { exact: true })).toBeVisible();
  await expect(output.getByText("Enter the bucket name")).toBeVisible();
  await expect(output.locator("[class*=awsui_status-error]")).toHaveCount(0);

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export is blocked" });
  await expect(dialog.locator("[class*=awsui_status-error]").getByText(/not a valid S3 bucket name/)).toBeVisible();
  await dialog.getByRole("button", { name: /^Jump to: / }).first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("group", { name: "Amazon S3 permission" }).getByRole("textbox", { name: "Bucket" })).toBeFocused();
  await expect(output.getByText("To do", { exact: true })).toHaveCount(0);
});

test("in the Grid, a new S3 grant shows no error anywhere on the page", async ({ page }) => {
  await page.goto("/builder");
  await addService(page, "s3", "Amazon S3");
  await page.getByRole("toolbar", { name: "Editor" }).getByRole("button", { name: "Grid", exact: true }).click();
  await expect(page.getByRole("region", { name: "Amazon S3" }).getByText("Enter the bucket name")).toBeVisible();
  await expect(page.locator("[class*=awsui_status-error]")).toHaveCount(0);
});

test("reloading the builder after adding S3 keeps the empty bucket a to-do", async ({ page }) => {
  await page.goto("/builder");
  await addService(page, "s3", "Amazon S3");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toMatch(/^#s=/);
  await page.reload();
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output.getByText("Enter the bucket name")).toBeVisible();
  await expect(page.locator("[class*=awsui_status-error]")).toHaveCount(0);
});
