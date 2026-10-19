import { addService, choose, downloadZip, expect, referenceFiles, test } from "./fixtures";

test("s3-group: a group policy for one S3 prefix exports the reference files", async ({ page }) => {
  const started = Date.now();
  await page.goto("/builder");

  await page.getByText("IAM group or user", { exact: true }).click();
  const attachTo = page.getByRole("toolbar", { name: "Attach to" });
  await expect(attachTo.getByRole("button", { name: "Group" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("analytics-team");

  await addService(page, "s3", "Amazon S3");
  const grant = page.getByRole("group", { name: "Amazon S3 permission" });
  await choose(page, grant.getByRole("button", { name: /Amazon S3 access/ }), "list + read");
  await grant.getByRole("textbox", { name: "Bucket" }).fill("data-lake");
  await grant.getByRole("textbox", { name: "Prefix 1" }).fill("reports/");

  await page.getByRole("button", { name: "Review and export" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("analytics-reader");

  expect(await downloadZip(page)).toEqual(referenceFiles("s3-group"));
  const seconds = (Date.now() - started) / 1000;
  console.log(`s3-group flow: ${seconds.toFixed(1)} s`);
  expect(seconds).toBeLessThan(60);
});
