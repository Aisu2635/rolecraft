import { buildS3Role, codeText, expect, readClipboard, test } from "./fixtures";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test("Share copies a link that reopens the same role", async ({ page, context }) => {
  await buildS3Role(page, "shared-bucket");
  const policy = await codeText(page, "Policy JSON");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  const url = await readClipboard(page);
  expect(url).toMatch(/\/builder#s=/);

  const other = await context.newPage();
  await other.goto(url);
  await expect(other.getByLabel("Policy JSON", { exact: true })).toBeVisible();
  expect(await codeText(other, "Policy JSON")).toBe(policy);
});

test("a broken share link warns and starts with an empty role", async ({ page }) => {
  await page.goto("/builder#s=garbage");
  await expect(page.getByText("This share link couldn't be opened.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Trusted entity" })).toHaveAttribute("aria-current", "step");
  const output = page.getByRole("region", { name: "Generated output" });
  const policyTab = output.getByRole("tabpanel", { name: "Policy" });
  await expect(policyTab.getByText("No permissions yet. Add a service to generate a policy.")).toBeVisible();
  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  await expect(page.getByText("No permissions yet. Pick a service on the left to add one.")).toBeVisible();
});
