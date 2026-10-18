import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HAND_WRITTEN_JSON } from "./hero-content";
import { BEAT_MS, CHAR_MS, FLAG_MS, HOLD_MS, STRIKE_MS, useHeroTimeline } from "./useHeroTimeline";

const N = HAND_WRITTEN_JSON.length;

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  setVisibility("visible");
  vi.useRealTimers();
});

describe("useHeroTimeline", () => {
  it("starts typing at 0 and types the whole JSON", () => {
    const { result } = renderHook(() => useHeroTimeline(false));
    expect(result.current).toEqual({ phase: "typing", typed: 0 });
    advance(CHAR_MS * 5 + 1);
    expect(result.current.typed).toBeGreaterThan(0);
    expect(result.current.phase).toBe("typing");
    advance(CHAR_MS * N + 1000);
    expect(result.current.phase).not.toBe("replace");
  });

  it("moves typing -> flag -> strike -> replace -> loops back to typing at 0", () => {
    const { result } = renderHook(() => useHeroTimeline(false));
    for (let i = 0; i < 1000 && result.current.phase === "typing"; i++) advance(10);
    expect(result.current.phase).toBe("flag");
    expect(result.current.typed).toBe(N);
    advance(FLAG_MS - 20);
    expect(result.current.phase).toBe("flag");
    advance(30);
    expect(result.current.phase).toBe("strike");
    expect(result.current.typed).toBe(N);
    advance(STRIKE_MS + 1);
    expect(result.current.phase).toBe("replace");
    advance(HOLD_MS - 20);
    expect(result.current.phase).toBe("replace");
    advance(30);
    expect(result.current).toEqual({ phase: "typing", typed: 0 });
  });

  it("flag lasts 1.4 s and starts after a short beat once typing completes", () => {
    expect(FLAG_MS).toBe(1400);
    const { result } = renderHook(() => useHeroTimeline(false));
    advance(CHAR_MS * N);
    expect(result.current).toEqual({ phase: "typing", typed: N });
    advance(BEAT_MS - 1);
    expect(result.current.phase).toBe("typing");
    advance(1);
    expect(result.current.phase).toBe("flag");
  });

  it("reduced motion: replace immediately and never schedules timers", () => {
    const { result, unmount } = renderHook(() => useHeroTimeline(true));
    expect(result.current.phase).toBe("replace");
    expect(vi.getTimerCount()).toBe(0);
    advance(60_000);
    expect(result.current.phase).toBe("replace");
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses while the document is hidden and resumes when visible", () => {
    const { result } = renderHook(() => useHeroTimeline(false));
    advance(CHAR_MS * 3 + 1);
    const before = result.current.typed;
    setVisibility("hidden");
    expect(vi.getTimerCount()).toBe(0);
    advance(10_000);
    expect(result.current.typed).toBe(before);
    setVisibility("visible");
    advance(CHAR_MS * 3 + 1);
    expect(result.current.typed).toBeGreaterThan(before);
  });

  it("starts paused when mounted in a hidden document", () => {
    setVisibility("hidden");
    const { result } = renderHook(() => useHeroTimeline(false));
    expect(vi.getTimerCount()).toBe(0);
    advance(5000);
    expect(result.current).toEqual({ phase: "typing", typed: 0 });
    setVisibility("visible");
    advance(CHAR_MS * 2 + 1);
    expect(result.current.typed).toBeGreaterThan(0);
  });

  it("unmount clears timers and listeners", () => {
    const { unmount } = renderHook(() => useHeroTimeline(false));
    advance(CHAR_MS * 2 + 1);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    setVisibility("hidden");
    setVisibility("visible");
    expect(vi.getTimerCount()).toBe(0);
  });
});
