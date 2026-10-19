import Button from "@cloudscape-design/components/button";
import {
  borderRadiusContainer,
  borderRadiusPopover,
  colorBackgroundPopover,
  colorBorderItemFocused,
  colorBorderPopover,
  colorTextBodyDefault,
  colorTextBodySecondary,
  colorTextHeadingDefault,
  fontSizeBodyS,
  fontSizeHeadingS,
  fontWeightHeadingS,
  shadowContainerActive,
  spaceScaledL,
  spaceScaledS,
  spaceScaledXs,
  spaceScaledXxs,
} from "@cloudscape-design/design-tokens";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type JSX } from "react";
import { createPortal } from "react-dom";
import { hasSeenTour, mountTour, useTourStore } from "../../../state/tour";
import { TOUR_STEPS } from "./steps";

/** Space between the card and its target, and between the card and the viewport edge. */
const GAP = 16;
const MARGIN = 16;
/** The cut-out is this much larger than its target, kept this far inside the viewport so its outline shows. */
const PAD = 4;
const INSET = 2;
const CARD_WIDTH = 340;
/** An open dropdown, menu or modal (or the trigger of one): Esc there closes it, not the tour. */
const OVERLAY = [
  '[aria-expanded="true"][aria-haspopup]',
  '[aria-expanded="true"][role="combobox"]',
  '[role="listbox"]',
  '[role="menu"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(", ");

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
}
interface Size {
  width: number;
  height: number;
}

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(v, Math.max(min, max)));

/**
 * Where the card goes: beside the target (right, left, below, above, in that order), on the first side with room
 * for it, aligned with the target's start and kept inside the viewport. With no room anywhere it is centred.
 */
export function placeCard(target: Rect | null, card: Size, vp: Size): { left: number; top: number } {
  const centred = { left: (vp.width - card.width) / 2, top: (vp.height - card.height) / 2 };
  if (!target) return centred;
  const alongY = clamp(target.top, MARGIN, vp.height - card.height - MARGIN);
  const alongX = clamp(target.left, MARGIN, vp.width - card.width - MARGIN);
  if (vp.width - target.right - GAP - MARGIN >= card.width) return { left: target.right + GAP, top: alongY };
  if (target.left - GAP - MARGIN >= card.width) return { left: target.left - GAP - card.width, top: alongY };
  if (vp.height - target.bottom - GAP - MARGIN >= card.height) return { left: alongX, top: target.bottom + GAP };
  if (target.top - GAP - MARGIN >= card.height) return { left: alongX, top: target.top - GAP - card.height };
  return centred;
}

function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

interface Layout {
  card: { left: number; top: number };
  /** The cut-out, or null when the target is missing (the whole page is dimmed). */
  hole: { left: number; top: number; width: number; height: number } | null;
}

/** The first-run tour: a card beside each highlighted region of the builder. Mount it once, inside the builder. */
export function Tour(): JSX.Element | null {
  const open = useTourStore((s) => s.open);
  const index = useTourStore((s) => s.index);
  const { next, back, close } = useTourStore.getState();
  const card = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const [layout, setLayout] = useState<Layout | null>(null);
  const animate = useRef(false);
  const step = TOUR_STEPS[index] ?? TOUR_STEPS[0]!;
  const last = index === TOUR_STEPS.length - 1;

  // Auto-start on a first visit, unless the visitor came to see a shared role. Leaving the builder mid-tour hides
  // it without marking it seen, so it is offered again next time.
  useEffect(() => {
    const unregister = mountTour();
    if (!hasSeenTour(safeStorage()) && !window.location.hash.startsWith("#s=")) useTourStore.getState().start();
    return () => {
      unregister();
      useTourStore.setState({ open: false });
    };
  }, []);

  // Focus goes back on close to whatever had it on open. (This effect runs before the one below moves it.)
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    return () => {
      setLayout(null);
      animate.current = false;
      if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [open]);

  // Focus moves into the card once it is placed (a hidden card cannot take focus), and stays there when a step
  // change disables or removes the focused button (Back on step 1).
  const placed = layout !== null;
  useEffect(() => {
    if (!open || !placed) return;
    const active = document.activeElement;
    const lost =
      !card.current?.contains(active) ||
      (active instanceof HTMLButtonElement && (active.disabled || active.getAttribute("aria-disabled") === "true"));
    if (lost) card.current?.focus({ preventScroll: true });
    // Glide between later steps, but do not fly in from the corner on the first placement.
    animate.current = true;
  }, [open, index, placed]);

  // Esc skips from anywhere, except when it closes a dropdown, popover or modal: one that handled it (prevented
  // the default or stopped it before the document), or one the key was pressed in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof Element && !card.current?.contains(t) && t.closest(OVERLAY)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const measure = useCallback((): void => {
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    const vp = { width: document.documentElement.clientWidth || window.innerWidth, height: window.innerHeight };
    const size = { width: card.current?.offsetWidth ?? CARD_WIDTH, height: card.current?.offsetHeight ?? 0 };
    if (!el) {
      setLayout({ card: placeCard(null, size, vp), hole: null });
      return;
    }
    const r = el.getBoundingClientRect();
    const left = Math.max(INSET, r.left - PAD);
    const top = Math.max(INSET, r.top - PAD);
    const right = Math.min(vp.width - INSET, r.right + PAD);
    const bottom = Math.min(vp.height - INSET, r.bottom + PAD);
    const hole = { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
    const rect = { ...hole, right, bottom };
    setLayout({ card: placeCard(rect, size, vp), hole });
  }, [step.target]);

  useLayoutEffect(() => {
    if (!open) return;
    document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView?.({ block: "nearest" });
    measure();
  }, [open, step.target, measure]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener("resize", measure);
    // Columns scroll on their own, so a scroll anywhere can move the target.
    window.addEventListener("scroll", measure, true);
    const el = document.querySelector(`[data-tour="${step.target}"]`);
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (el) ro?.observe(el);
    if (card.current) ro?.observe(card.current);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      ro?.disconnect();
    };
  }, [open, step.target, measure]);

  if (!open) return null;
  const hole = layout?.hole;
  return createPortal(
    <>
      <div
        className={animate.current ? "rc-tour-hl rc-tour-anim" : "rc-tour-hl"}
        aria-hidden="true"
        style={{
          position: "fixed",
          zIndex: 1500,
          pointerEvents: "none",
          borderRadius: borderRadiusContainer,
          boxShadow: "0 0 0 200vmax rgba(0, 7, 22, 0.6)",
          outline: hole ? `2px solid ${colorBorderItemFocused}` : "none",
          ...(hole ?? { left: "50%", top: "50%", width: 0, height: 0 }),
        }}
      />
      <div
        ref={card}
        className={animate.current ? "rc-tour-card rc-tour-anim" : "rc-tour-card"}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{
          position: "fixed",
          zIndex: 1501,
          left: layout?.card.left ?? 0,
          top: layout?.card.top ?? 0,
          visibility: layout ? "visible" : "hidden",
          boxSizing: "border-box",
          width: CARD_WIDTH,
          maxWidth: `calc(100vw - ${2 * MARGIN}px)`,
          padding: spaceScaledL,
          background: colorBackgroundPopover,
          color: colorTextBodyDefault,
          border: `1px solid ${colorBorderPopover}`,
          borderRadius: borderRadiusPopover,
          boxShadow: shadowContainerActive,
        }}
      >
        <div style={{ fontSize: fontSizeBodyS, color: colorTextBodySecondary, marginBottom: spaceScaledXxs }}>
          {index + 1} of {TOUR_STEPS.length}
        </div>
        <h2
          id={titleId}
          style={{
            margin: `0 0 ${spaceScaledXs}`,
            fontSize: fontSizeHeadingS,
            fontWeight: fontWeightHeadingS,
            lineHeight: 1.4,
            color: colorTextHeadingDefault,
          }}
        >
          {step.title}
        </h2>
        <p style={{ margin: `0 0 ${spaceScaledL}`, lineHeight: 1.5 }}>{step.body}</p>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: spaceScaledS }}>
          <Button variant="link" onClick={close}>
            Skip tour
          </Button>
          <div style={{ display: "flex", gap: spaceScaledXs, flexShrink: 0 }}>
            <Button disabled={index === 0} ariaLabel="Previous tour stop" onClick={back}>
              Back
            </Button>
            {/* Named apart from the builder's own Next and Back; Done ends the tour, so it keeps its label. */}
            <Button variant="primary" ariaLabel={last ? undefined : "Next tour stop"} onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
