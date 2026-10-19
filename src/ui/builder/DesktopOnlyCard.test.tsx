import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesktopOnlyCard } from "./DesktopOnlyCard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DesktopOnlyCard", () => {
  it("explains and hides Share without navigator.share", () => {
    vi.stubGlobal("navigator", {});
    render(<DesktopOnlyCard />);
    expect(
      screen.getByRole("heading", {
        name: "Works best on a laptop or desktop",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "The builder needs a screen at least 1024 pixels wide. Open this link on a computer to keep going.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Copy link" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });
  it("Copy link copies location.href", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<DesktopOnlyCard />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(location.href));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
  it("Share calls navigator.share and swallows AbortError", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    vi.stubGlobal("navigator", { share });
    render(<DesktopOnlyCard />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: "RoleCraft",
        url: location.href,
      }),
    );
    await Promise.resolve();
  });
  it("Share ignores other errors too (no unhandled rejection)", async () => {
    const share = vi.fn().mockRejectedValue(new Error("nope"));
    vi.stubGlobal("navigator", { share });
    render(<DesktopOnlyCard />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
  });
});
