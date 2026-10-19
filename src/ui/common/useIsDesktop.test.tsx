import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsDesktop } from "./useIsDesktop";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Probe({ query }: { query?: string }) {
  return <p>{useIsDesktop(query) ? "desktop" : "narrow"}</p>;
}

function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  const mm = vi.fn().mockReturnValue(mql);
  vi.stubGlobal("matchMedia", mm);
  return {
    mm,
    listeners,
    set(v: boolean) {
      matches = v;
      listeners.forEach((l) => l());
    },
  };
}

describe("useIsDesktop", () => {
  it("uses the default query and reacts to change events", () => {
    const s = stubMatchMedia(false);
    render(<Probe />);
    expect(s.mm).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(screen.getByText("narrow")).toBeInTheDocument();
    act(() => s.set(true));
    expect(screen.getByText("desktop")).toBeInTheDocument();
  });
  it("accepts a custom query and unsubscribes on unmount", () => {
    const s = stubMatchMedia(true);
    const { unmount } = render(<Probe query="(min-width: 500px)" />);
    expect(s.mm).toHaveBeenCalledWith("(min-width: 500px)");
    expect(s.listeners.size).toBe(1);
    unmount();
    expect(s.listeners.size).toBe(0);
  });
  it("falls back to addListener/removeListener on old Safari", () => {
    let matches = false;
    const listeners = new Set<() => void>();
    const mql = {
      get matches() {
        return matches;
      },
      addListener: (l: () => void) => listeners.add(l),
      removeListener: (l: () => void) => listeners.delete(l),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(mql));
    const { unmount } = render(<Probe />);
    expect(listeners.size).toBe(1);
    matches = true;
    act(() => listeners.forEach((l) => l()));
    expect(screen.getByText("desktop")).toBeInTheDocument();
    unmount();
    expect(listeners.size).toBe(0);
  });
  it("treats a missing matchMedia as desktop", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    expect(screen.getByText("desktop")).toBeInTheDocument();
  });
});
