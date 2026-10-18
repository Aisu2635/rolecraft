import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HeroDemo } from "./HeroDemo";

function stubMatchMedia(reduced: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: reduced,
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal("matchMedia", () => mql);
  return {
    flip(next: boolean) {
      mql.matches = next;
      listeners.forEach((l) => l());
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const DESCRIPTION =
  "Example: instead of a hand-written policy that allows every S3 action on every resource, RoleCraft builds: " +
  "analytics-team can list and read files in data-lake/reports/.";

describe("HeroDemo", () => {
  it("describes the animation once in visually-hidden text and hides the animated region", () => {
    stubMatchMedia(false);
    render(<HeroDemo />);
    const group = screen.getByLabelText("Example policy preview");
    const desc = screen.getByText(DESCRIPTION);
    expect(desc).toHaveClass("lp-sr");
    expect(desc.closest("[aria-hidden]")).toBeNull();
    const stage = group.querySelector("[aria-hidden='true']");
    expect(stage).not.toBeNull();
    expect(stage?.textContent).not.toContain(DESCRIPTION);
  });

  it("animated: starts by typing the hand-written JSON", () => {
    stubMatchMedia(false);
    const { container } = render(<HeroDemo />);
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-phase", "typing");
    expect(container.querySelector(".lp-hd")?.textContent).toContain("policy.json");
    expect(container.querySelector(".lp-hd")?.textContent).toContain("written by hand");
    act(() => {
      vi.advanceTimersByTime(28 * 8 + 1);
    });
    expect(container.querySelector(".lp-code")?.textContent?.startsWith('{\n  "Ver')).toBe(true);
    expect(container.querySelector(".lp-strike")).not.toBeNull();
  });

  it("animated: flag phase shows both red callouts beside the bad values", () => {
    stubMatchMedia(false);
    const { container } = render(<HeroDemo />);
    act(() => {
      vi.advanceTimersByTime(28 * 120 + 450 + 10);
    });
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-phase", "flag");
    const flags = Array.from(container.querySelectorAll(".lp-flag")).map((f) => f.textContent);
    expect(flags).toEqual(["every S3 action", "every bucket"]);
    const bad = Array.from(container.querySelectorAll(".lp-code .lp-bad")).map((b) => b.textContent);
    expect(bad).toEqual(['"s3:*"', '"*"']);
    expect(container.querySelectorAll(".lp-gutter span")).toHaveLength(8);
  });

  it("animated: reaches the replace state with the sentence and policy", () => {
    stubMatchMedia(false);
    const { container } = render(<HeroDemo />);
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-phase", "replace");
    expect(screen.getAllByText("analytics-team").length).toBeGreaterThan(0);
  });

  it("reduced motion: shows the final sentence and policy immediately, with no timers", () => {
    stubMatchMedia(true);
    const { container } = render(<HeroDemo />);
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-phase", "replace");
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-reduced", "true");
    const stage = container.querySelector(".lp-stage");
    expect(stage?.textContent).toContain("analytics-team");
    expect(stage?.textContent).toContain("list + read");
    expect(stage?.textContent).toContain("data-lake / reports/");
    expect(stage?.textContent).toContain('"Action": "s3:ListBucket"');
    expect(stage?.textContent).toContain('"Resource": "arn:aws:s3:::data-lake/reports/*"');
    expect(stage?.textContent).toContain("Least privilege");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("follows live changes of the reduced-motion preference", () => {
    const mm = stubMatchMedia(false);
    const { container } = render(<HeroDemo />);
    act(() => mm.flip(true));
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-reduced", "true");
  });

  it("falls back to animating when matchMedia is missing, and supports legacy addListener", () => {
    const { container, unmount } = render(<HeroDemo />);
    expect(container.querySelector(".lp-stage")).toHaveAttribute("data-phase", "typing");
    unmount();
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("matchMedia", () => ({ matches: false, addListener: add, removeListener: remove }));
    render(<HeroDemo />).unmount();
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
