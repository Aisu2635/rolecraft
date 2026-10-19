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
    for (const name of ["Back to previous tour stop", "Next tour stop", "Skip tour"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(card).getByRole("button", { name: "Back to previous tour stop" })).toBeDisabled();
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
    fireEvent.click(within(card()).getByRole("button", { name: "Next tour stop" }));
    expect(card()).toHaveAccessibleName("Three steps");
    expect(card()).toHaveTextContent("2 of 5");
    fireEvent.click(within(card()).getByRole("button", { name: "Back to previous tour stop" }));
    expect(card()).toHaveAccessibleName("Pick AWS services");
    for (let i = 0; i < 4; i++) fireEvent.click(within(card()).getByRole("button", { name: "Next tour stop" }));
    expect(card()).toHaveAccessibleName("Copy, export or share");
    expect(card()).toHaveTextContent("5 of 5");
    expect(within(card()).queryByRole("button", { name: "Next tour stop" })).toBeNull();
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

  it("Esc pressed anywhere else on the page skips the tour", () => {
    ui();
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem(TOUR_KEY)).toBe("seen");
    field.remove();
  });

  it("Esc that a dropdown, popover or modal handled (default prevented) leaves the tour open", () => {
    ui();
    const field = document.createElement("input");
    field.addEventListener("keydown", (e) => e.preventDefault());
    document.body.append(field);
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Pick AWS services" })).toBeInTheDocument();
    field.remove();
  });

  it.each([
    ["an open select", '<button type="button" aria-haspopup="listbox" aria-expanded="true">trigger</button>'],
    ["an open autosuggest", '<input role="combobox" aria-expanded="true" />'],
    ["a dropdown list", '<ul role="listbox"><li role="option" tabindex="-1">option</li></ul>'],
    ["a menu", '<ul role="menu"><li role="menuitem" tabindex="-1">item</li></ul>'],
    ["a modal", '<div role="dialog" aria-modal="true"><input /></div>'],
  ])("Esc inside %s leaves the tour open", (_, html) => {
    ui();
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const target = host.querySelector("input, li, button")!;
    fireEvent.keyDown(target, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "Pick AWS services" })).toBeInTheDocument();
    host.remove();
  });

  it("Esc on an expanded section header (not an overlay) still skips the tour", () => {
    ui();
    const header = document.createElement("button");
    header.setAttribute("aria-expanded", "true");
    document.body.append(header);
    fireEvent.keyDown(header, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    header.remove();
  });

  it("Next and Back are named as tour stops; their visible labels stay Next, Back and Done", () => {
    ui();
    const card = () => screen.getByRole("dialog");
    expect(within(card()).getByRole("button", { name: "Next tour stop" })).toHaveTextContent(/^Next$/);
    expect(within(card()).getByRole("button", { name: "Back to previous tour stop" })).toHaveTextContent(/^Back$/);
    for (let i = 0; i < 4; i++) fireEvent.click(within(card()).getByRole("button", { name: "Next tour stop" }));
    expect(within(card()).getByRole("button", { name: "Done" })).toHaveTextContent(/^Done$/);
  });

  it("the card shows the step heading's focus ring when focused from the keyboard", () => {
    ui();
    const card = screen.getByRole("dialog");
    expect(card).toHaveClass("rc-tour-card");
    // An inline outline would override the stylesheet's :focus-visible ring.
    expect(card.style.outline).toBe("");
    expect(css).toContain(".rc-tour-card:focus { outline: none; }");
    expect(css).toContain(".rc-tour-card:focus-visible { outline: 2px solid var(--rc-focus); outline-offset: 2px; }");
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
    fireEvent.click(within(card).getByRole("button", { name: "Next tour stop" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Back to previous tour stop" }));
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
