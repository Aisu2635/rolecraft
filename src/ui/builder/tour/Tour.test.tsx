import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderStore } from "../../../state/builder";
import { TOUR_KEY, requestTour, useTourStore } from "../../../state/tour";
import { BuilderPage } from "../../pages/BuilderPage";
import { TOUR_STEPS } from "./steps";
import { Tour, placeCard } from "./Tour";

const css = readFileSync(resolve(process.cwd(), "src/ui/global.css"), "utf8");

beforeEach(() => {
  // src/test-setup.ts presets the flag for every other test; these start as a first-time visitor.
  localStorage.removeItem(TOUR_KEY);
  useTourStore.setState({ open: false, index: 0 });
  window.history.replaceState(null, "", "/builder");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

function Targets() {
  return (
    <>
      <button type="button">opener</button>
      {TOUR_STEPS.map((s) => (
        <div key={s.target} data-tour={s.target}>
          {s.target}
        </div>
      ))}
    </>
  );
}

const ui = () =>
  render(
    <>
      <Targets />
      <Tour />
    </>,
  );

describe("TOUR_STEPS", () => {
  it("has the five steps in order", () => {
    expect(TOUR_STEPS.map((s) => [s.target, s.title])).toEqual([
      ["sidebar", "Pick AWS services"],
      ["steps", "Three steps"],
      ["workspace", "Describe access in plain English"],
      ["output", "Your policy, live"],
      ["actions", "Copy, export or share"],
    ]);
  });
});

describe("Tour", () => {
  it("auto-opens on a first visit with the title, body and progress", () => {
    ui();
    const card = screen.getByRole("dialog", { name: "Pick AWS services" });
    expect(card).toHaveAttribute("aria-modal", "false");
    expect(card).toHaveTextContent(
      "Search or browse services here. Each one you add becomes a permission you can fine-tune.",
    );
    expect(card).toHaveTextContent("1 of 5");
    for (const name of ["Back", "Next", "Skip tour"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(card).toHaveFocus();
  });

  it("does not open when the seen flag is set", () => {
    localStorage.setItem(TOUR_KEY, "seen");
    ui();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not open over a share link", () => {
    window.history.replaceState(null, "", "/builder#s=abc");
    ui();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
  });

  it("Next, Back and Done walk the steps; Done closes and sets the flag", () => {
    ui();
    const card = () => screen.getByRole("dialog");
    fireEvent.click(within(card()).getByRole("button", { name: "Next" }));
    expect(card()).toHaveAccessibleName("Three steps");
    expect(card()).toHaveTextContent("2 of 5");
    fireEvent.click(within(card()).getByRole("button", { name: "Back" }));
    expect(card()).toHaveAccessibleName("Pick AWS services");
    for (let i = 0; i < 4; i++) fireEvent.click(within(card()).getByRole("button", { name: "Next" }));
    expect(card()).toHaveAccessibleName("Copy, export or share");
    expect(card()).toHaveTextContent("5 of 5");
    expect(within(card()).queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(within(card()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
  });

  it("Esc skips the tour and sets the flag", () => {
    ui();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
  });

  it("Esc pressed elsewhere on the page (e.g. to close a dropdown) leaves the tour open", () => {
    ui();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    field.remove();
  });

  it("Skip tour closes and sets the flag", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
  });

  it("returns focus to the element that opened it", () => {
    localStorage.setItem(TOUR_KEY, "seen");
    ui();
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();
    act(() => requestTour());
    const card = screen.getByRole("dialog", { name: "Pick AWS services" });
    expect(card).toHaveFocus();
    fireEvent.click(within(card).getByRole("button", { name: "Next" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back" }));
    // Back is disabled on the first step, so focus is put back on the card rather than lost.
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("closes without setting the flag when the builder unmounts mid-tour", () => {
    const { unmount } = ui();
    unmount();
    expect(useTourStore.getState().open).toBe(false);
    expect(localStorage.getItem(TOUR_KEY)).toBeNull();
  });

  it("still shows the card, centred, when a target is missing", () => {
    render(<Tour />);
    expect(screen.getByRole("dialog", { name: "Pick AWS services" })).toBeInTheDocument();
  });

  it("has no transition under prefers-reduced-motion", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.rc-tour[^{]*\{[^}]*transition: none/);
  });
});

describe("placeCard", () => {
  const vp = { width: 1440, height: 900 };
  const card = { width: 340, height: 200 };
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });

  it("puts the card to the right of a target with room there, aligned to its top", () => {
    expect(placeCard(rect(0, 57, 240, 843), card, vp)).toEqual({ left: 256, top: 57 });
  });
  it("falls back to the left when the right is too narrow", () => {
    expect(placeCard(rect(1040, 57, 400, 843), card, vp)).toEqual({ left: 684, top: 57 });
  });
  it("falls back to below a wide, short target", () => {
    expect(placeCard(rect(0, 100, 1440, 40), card, vp)).toEqual({ left: 16, top: 156 });
  });
  it("falls back to above when there is no room below", () => {
    expect(placeCard(rect(0, 700, 1440, 190), card, vp)).toEqual({ left: 16, top: 484 });
  });
  it("keeps the card inside the viewport", () => {
    expect(placeCard(rect(100, 850, 100, 40), card, vp)).toEqual({ left: 216, top: 684 });
  });
  it("centres the card when nothing fits or there is no target", () => {
    expect(placeCard(rect(0, 0, 1440, 900), card, vp)).toEqual({ left: 550, top: 350 });
    expect(placeCard(null, card, vp)).toEqual({ left: 550, top: 350 });
  });
});

describe("BuilderPage tour targets", () => {
  it("marks all five tour targets", () => {
    localStorage.setItem(TOUR_KEY, "seen");
    useBuilderStore.getState().reset();
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
    const { container } = render(<BuilderPage />);
    for (const s of TOUR_STEPS) {
      expect(container.querySelector(`[data-tour="${s.target}"]`), s.target).not.toBeNull();
    }
  });
});
