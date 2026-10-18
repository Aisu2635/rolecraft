import { useEffect, useState } from "react";
import { HAND_WRITTEN_JSON } from "./hero-content";

export type HeroPhase = "typing" | "flag" | "strike" | "replace";
export interface HeroTimeline {
  phase: HeroPhase;
  typed: number;
}

export const CHAR_MS = 28;
/** Beat between the last typed character and the red callouts. */
export const BEAT_MS = 300;
export const FLAG_MS = 1400;
export const STRIKE_MS = 1000;
export const HOLD_MS = 4600;

const TOTAL = HAND_WRITTEN_JSON.length;
const START: HeroTimeline = { phase: "typing", typed: 0 };
const DONE: HeroTimeline = { phase: "replace", typed: TOTAL };

/** Delay before the next transition, and the state it leads to. */
function next(s: HeroTimeline): [number, HeroTimeline] {
  if (s.phase === "typing") {
    return s.typed < TOTAL
      ? [CHAR_MS, { phase: "typing", typed: s.typed + 1 }]
      : [BEAT_MS, { phase: "flag", typed: TOTAL }];
  }
  if (s.phase === "flag") return [FLAG_MS, { phase: "strike", typed: TOTAL }];
  if (s.phase === "strike") return [STRIKE_MS, DONE];
  return [HOLD_MS, START];
}

/**
 * Drives the hero loop: type -> flag -> strike -> replace -> repeat. One timer at a time; paused while the tab is hidden;
 * with reduced motion it settles on the final state and never schedules anything.
 */
export function useHeroTimeline(reduced: boolean): HeroTimeline {
  const [state, setState] = useState<HeroTimeline>(START);

  useEffect(() => {
    if (reduced) return undefined;
    let current = START;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      stop();
      const [delay, following] = next(current);
      timer = setTimeout(() => {
        timer = undefined;
        current = following;
        setState(following);
        schedule();
      }, delay);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") stop();
      else if (timer === undefined) schedule();
    };
    document.addEventListener("visibilitychange", onVisibility);
    setState(START);
    onVisibility();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced]);

  return reduced ? DONE : state;
}
