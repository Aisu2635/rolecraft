import type { Page } from "@playwright/test";
import { addService, choose, downloadZip, expect, referenceFiles, test } from "./fixtures";

/** Picks IAM group or user on the Trust step and names the group or user. */
async function attachTo(page: Page, target: "Group" | "User", name: string): Promise<void> {
  await page.getByText("IAM group or user", { exact: true }).click();
  const toolbar = page.getByRole("toolbar", { name: "Attach to" });
  await toolbar.getByRole("button", { name: target }).click();
  await expect(toolbar.getByRole("button", { name: target })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
}

/** On the Review step: names the role (or policy) and picks the inline policy mode. */
async function reviewInline(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "Review and export" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(name);
  await page.getByRole("radio", { name: /^Inline policy/ }).check();
}

test("github-deploy: GitHub OIDC trust with the account ID on the Trust step exports the reference files", async ({
  page,
}) => {
  await page.goto("/builder");
  await page.getByText("GitHub Actions", { exact: true }).click();
  await page.getByRole("textbox", { name: "GitHub owner" }).fill("omhinge");
  await page.getByRole("textbox", { name: "Repository" }).fill("site");
  await expect(page.getByRole("button", { name: /Ref type/ })).toContainText("Branch");
  await expect(page.getByRole("textbox", { name: "Branch name" })).toHaveValue("main");
  await page.getByRole("textbox", { name: "AWS account ID" }).fill("123456789012");

  await addService(page, "s3", "Amazon S3");
  const s3 = page.getByRole("group", { name: "Amazon S3 permission" });
  await choose(page, s3.getByRole("button", { name: /Amazon S3 access/ }), "read + write");
  await s3.getByRole("textbox", { name: "Bucket" }).fill("site-assets");

  // One individual action, picked in the Grid (Sentences offers access levels only).
  await addService(page, "cloudfront", "Amazon CloudFront");
  const editor = page.getByRole("toolbar", { name: "Editor" });
  await editor.getByRole("button", { name: "Grid", exact: true }).click();
  const grid = page.getByRole("region", { name: "Amazon CloudFront" });
  await grid.getByRole("button", { name: "Pick individual actions" }).click();
  await grid.getByRole("button", { name: /Individual Amazon CloudFront actions/ }).click();
  await page.getByRole("combobox", { name: "Find actions" }).fill("CreateInvalidation");
  await page.getByRole("option", { name: /CreateInvalidation/ }).first().click();
  await page.keyboard.press("Escape");
  await expect(grid.getByText("1 individual action")).toBeVisible();

  // The distribution ARN, built from the account ID given on the Trust step.
  await editor.getByRole("button", { name: "Sentences", exact: true }).click();
  const cf = page.getByRole("group", { name: "Amazon CloudFront permission" });
  const scope = cf.getByRole("button", { name: "Scope" });
  await expect(scope).toHaveAttribute("aria-expanded", "false");
  await scope.click();
  // An option's name carries its ARN format, so "distribution" is told apart from "distribution-tenant" by it.
  await cf.getByRole("button", { name: /Resource type/ }).click();
  await page.getByRole("option", { name: /^distribution arn:\S+:distribution\// }).click();
  await cf.getByRole("textbox", { name: "DistributionId" }).fill("E2EXAMPLE");
  await expect(cf.getByText("arn:aws:cloudfront::123456789012:distribution/E2EXAMPLE", { exact: true })).toBeVisible();
  await cf.getByRole("button", { name: "Add this ARN" }).click();
  await expect(cf.getByRole("textbox", { name: "ARN 1" })).toHaveValue(
    "arn:aws:cloudfront::123456789012:distribution/E2EXAMPLE",
  );

  await page.getByRole("button", { name: "Review and export" }).click();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("github-deploy");

  expect(await downloadZip(page)).toEqual(referenceFiles("github-deploy"));
});

test("group-inline: an inline policy attached to a group exports the reference files", async ({ page }) => {
  await page.goto("/builder");
  await attachTo(page, "Group", "analytics-team");

  await addService(page, "s3", "Amazon S3");
  const grant = page.getByRole("group", { name: "Amazon S3 permission" });
  await choose(page, grant.getByRole("button", { name: /Amazon S3 access/ }), "list + read");
  await grant.getByRole("textbox", { name: "Bucket" }).fill("data-lake");
  await grant.getByRole("textbox", { name: "Prefix 1" }).fill("reports/");

  await reviewInline(page, "analytics-inline");
  expect(await downloadZip(page)).toEqual(referenceFiles("group-inline"));
});

test("user-inline-eks: an inline kubectl policy for an IAM user exports the reference files", async ({ page }) => {
  await page.goto("/builder");
  await attachTo(page, "User", "deploy-bot");

  await addService(page, "eks", "Amazon EKS");
  const grant = page.getByRole("group", { name: "Amazon EKS permission" });
  await choose(page, grant.getByRole("button", { name: /Amazon EKS access/ }), "kubectl access");
  await grant.getByRole("textbox", { name: "Cluster name" }).fill("prod");

  await reviewInline(page, "deploy-bot-inline");
  expect(await downloadZip(page)).toEqual(referenceFiles("user-inline-eks"));
});
