import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText, CopyFallbackModal, useCopy } from "./clipboard";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("copyText", () => {
  it("returns copied when writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(
      await copyText("hi", {
        clipboard: { writeText } as unknown as Clipboard,
      }),
    ).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("hi");
  });
  it("falls back when clipboard is missing", async () => {
    expect(await copyText("hi", {} as Navigator)).toBe("fallback");
  });
  it("falls back when writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    expect(
      await copyText("hi", {
        clipboard: { writeText } as unknown as Clipboard,
      }),
    ).toBe("fallback");
  });
  it("defaults to the global navigator", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("x")).toBe("copied");
  });
});

describe("CopyFallbackModal", () => {
  it("renders nothing visible when text is null", () => {
    render(<CopyFallbackModal text={null} onDismiss={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("shows a read-only textarea with the text selected, and dismisses", async () => {
    const onDismiss = vi.fn();
    render(<CopyFallbackModal text="arn:aws:s3:::b" onDismiss={onDismiss} />);
    const ta = (await screen.findByRole("textbox")) as HTMLTextAreaElement;
    expect(ta).toHaveAttribute("readonly");
    expect(ta.value).toBe("arn:aws:s3:::b");
    await waitFor(() => {
      expect(ta.selectionStart).toBe(0);
      expect(ta.selectionEnd).toBe(ta.value.length);
    });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalled();
  });
  it("shows the exact copy hint", async () => {
    render(<CopyFallbackModal text="x" onDismiss={() => {}} />);
    await screen.findByRole("textbox");
    expect(screen.getByText(/Press Ctrl\+C \(⌘C on Mac\) to copy\./)).toBeInTheDocument();
  });
});

function Harness({ text }: { text: string }) {
  const { copy, modal } = useCopy();
  return (
    <>
      <button onClick={() => void copy(text)}>go</button>
      {modal}
    </>
  );
}

describe("useCopy", () => {
  it("flashes Copied then clears it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<Harness text="abc" />);
    fireEvent.click(screen.getByText("go"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Copied")).toBeNull(), {
      timeout: 3000,
    });
  });
  it("opens the fallback modal when the clipboard is unavailable", async () => {
    vi.stubGlobal("navigator", {});
    render(<Harness text="abc" />);
    fireEvent.click(screen.getByText("go"));
    expect(
      ((await screen.findByRole("textbox")) as HTMLTextAreaElement).value,
    ).toBe("abc");
    expect(screen.queryByText("Copied")).toBeNull();
    await act(async () => {});
  });
});
