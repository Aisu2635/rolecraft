import { buildS3Role, codeText, expect, readClipboard, test } from "./fixtures";

test.describe("with clipboard access", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("Copy on Policy and on Trust puts the visible code on the clipboard", async ({ page }) => {
    await buildS3Role(page, "copy-bucket");
    const output = page.getByRole("region", { name: "Generated output" });
    const copy = output.getByRole("button", { name: "Copy", exact: true });

    await copy.click();
    await expect.poll(() => readClipboard(page)).toBe(await codeText(page, "Policy JSON"));

    await output.getByRole("tab", { name: "Trust" }).click();
    const trust = await codeText(page, "Trust policy JSON");
    expect(trust).toContain("ec2.amazonaws.com");
    await copy.click();
    await expect.poll(() => readClipboard(page)).toBe(trust);
  });
});

test("when the browser blocks copying, the fallback dialog has the text selected", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: () => Promise.reject(new DOMException("blocked", "NotAllowedError")) },
    });
  });
  await buildS3Role(page, "copy-bucket");
  const policy = await codeText(page, "Policy JSON");
  await page.getByRole("region", { name: "Generated output" }).getByRole("button", { name: "Copy", exact: true }).click();
  const box = page.getByRole("dialog", { name: "Copy manually" }).getByRole("textbox", { name: "Text to copy" });
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(policy);
  await expect
    .poll(() => box.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd]))
    .toEqual([0, policy.length]);
});
