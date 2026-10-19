import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "./download";

const create = vi.fn(() => "blob:x");
const revoke = vi.fn();
let clicked: { download: string; href: string; connected: boolean } | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  URL.createObjectURL = create as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revoke;
  clicked = undefined;
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked = { download: this.download, href: this.href, connected: this.isConnected };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  create.mockClear();
  revoke.mockClear();
});

describe("downloadFile", () => {
  it("clicks a temporary download link and cleans it up", () => {
    downloadFile("a.zip", new Uint8Array([1, 2]), "application/zip");
    expect(clicked).toEqual({ download: "a.zip", href: "blob:x", connected: true });
    expect(document.querySelector("a[download]")).toBeNull();
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe("application/zip");
    expect(blob.size).toBe(2);
  });

  it("keeps string content as given (LF stays LF)", async () => {
    downloadFile("x.sh", "a\nb\n", "text/x-shellscript");
    const blob = (create.mock.calls[0] as unknown as [Blob])[0];
    expect(await blob.text()).toBe("a\nb\n");
  });

  it("revokes the object URL only after the click was processed", () => {
    downloadFile("x.txt", "t", "text/plain");
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:x");
  });
});
