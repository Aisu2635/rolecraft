import { create } from "zustand";
import { TOUR_STEPS } from "../ui/builder/tour/steps";

export const TOUR_KEY = "rolecraft.tour.v1";

/** Unreadable storage counts as seen: a tour that can never be dismissed for good would nag on every visit. */
export function hasSeenTour(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage ? storage.getItem(TOUR_KEY) === "seen" : true;
  } catch {
    return true;
  }
}

function markSeen(): void {
  try {
    globalThis.localStorage?.setItem(TOUR_KEY, "seen");
  } catch {
    // storage unavailable; the tour simply isn't remembered
  }
}

interface TourState {
  open: boolean;
  index: number;
  start(): void;
  next(): void;
  back(): void;
  close(): void;
}

export const useTourStore = create<TourState>((set, get) => ({
  open: false,
  index: 0,
  start: () => set({ open: true, index: 0 }),
  next: () => {
    if (get().index >= TOUR_STEPS.length - 1) get().close();
    else set({ index: get().index + 1 });
  },
  back: () => set({ index: Math.max(0, get().index - 1) }),
  close: () => {
    markSeen();
    set({ open: false });
  },
}));

let mounted = 0;

/** Called by the Tour on mount; the returned function unregisters it. */
export function mountTour(): () => void {
  mounted++;
  return () => {
    mounted--;
  };
}

/** "Take the tour": starts from step 1 when the builder (and so the Tour) is mounted, and does nothing otherwise. */
export function requestTour(): void {
  if (mounted > 0) useTourStore.getState().start();
}
