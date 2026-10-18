import { buildS3Role, expect, test } from "./fixtures";

const CHUNK = /\/assets\/(yaml|fflate)-/;

test("the exporter chunks load only when a format tab opens", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await buildS3Role(page, "lazy-bucket");
  await expect(page.getByLabel("Policy JSON", { exact: true })).toBeVisible();
  expect(requests.filter((u) => CHUNK.test(u))).toEqual([]);

  const output = page.getByRole("region", { name: "Generated output" });
  await output.getByRole("tab", { name: "CLI" }).click();
  await expect(output.getByLabel("Bash script", { exact: true })).toBeVisible();
  for (const name of ["yaml", "fflate"]) expect(requests.some((u) => u.includes(`/assets/${name}-`)), name).toBe(true);

  await output.getByRole("toolbar", { name: "Shell" }).getByRole("button", { name: "PowerShell" }).click();
  const panel = output.getByRole("tabpanel");
  await expect(panel.getByLabel("PowerShell script", { exact: true })).toBeVisible();
  await expect(panel).toContainText("Unblock-File");
  await expect(panel).toContainText("2.15.38");
});
