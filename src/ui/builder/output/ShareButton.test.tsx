import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeModel } from "../../../core/model/share";
import { useBuilderStore } from "../../../state/builder";
import { ShareButton } from "./ShareButton";

const store = () => useBuilderStore.getState();
const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  store().reset();
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ShareButton", () => {
  it("writes the current role into the URL and copies the link, even before the debounce fires", async () => {
    render(<ShareButton />);
    act(() => store().setFields({ name: "fresh-role" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(window.location.hash).toBe("#s=" + encodeModel(store().model));
    expect(writeText).toHaveBeenCalledWith(window.location.href);
    await screen.findByText("Copied");
  });
  it("is disabled with an explanation when the role is too large to share", () => {
    act(() => store().setShareStatus("too-large"));
    render(<ShareButton />);
    expect(screen.getByRole("button", { name: "Share" })).toBeDisabled();
    expect(screen.getByText("This role is too large to share as a link. Export it instead.")).toBeInTheDocument();
  });
  it("does not copy and flags too-large when the role no longer fits", async () => {
    render(<ShareButton />);
    const big = Array.from({ length: 1500 }, (_, i) => `arn:aws:iam::aws:policy/p${i}-${(i * 7919).toString(36)}`);
    act(() => store().setFields({ managedPolicyArns: big }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(store().shareStatus).toBe("too-large"));
    expect(writeText).not.toHaveBeenCalled();
  });
});
