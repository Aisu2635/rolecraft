import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

export type Exporters = typeof import("./exporters");

const realImporter = (): Promise<Exporters> => import("./exporters");
let defaultImporter = realImporter;
let memo: Promise<Exporters> | undefined;

/**
 * Whether the app was redeployed under this page, shared by every `useExporters()` caller: the chunk failed to load
 * twice in a row (whichever caller asked), or Vite reported a preload error. The old chunk is gone for good, so
 * Retry cannot help; only a reload can. A successful load anywhere resets it.
 */
export interface RedeployState {
  failures: number;
  stale: boolean;
}

const FRESH: RedeployState = { failures: 0, stale: false };
let redeploy: RedeployState = FRESH;
const listeners = new Set<() => void>();

function setRedeploy(next: RedeployState): void {
  if (next.failures === redeploy.failures && next.stale === redeploy.stale) return;
  redeploy = next;
  for (const l of listeners) l();
}

const onPreloadError = (e: Event): void => {
  e.preventDefault();
  setRedeploy({ ...redeploy, stale: true });
};

/** Listens for Vite's preload error while anyone is subscribed. */
function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("vite:preloadError", onPreloadError);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("vite:preloadError", onPreloadError);
  };
}

/** The shared redeploy state, as every `useExporters()` caller sees it. */
export const redeployState = (): RedeployState => redeploy;

/**
 * Loads the exporters chunk once; a failed load isn't remembered, so the next call tries again. A load that resolves
 * to nothing (Vite resolves it that way once a `vite:preloadError` is handled) counts as a failure. Each load counts
 * once towards the redeploy state, however many callers share it.
 */
export function loadExporters(importer: () => Promise<Exporters> = defaultImporter): Promise<Exporters> {
  if (!memo) {
    const attempt = importer().then((mod) => {
      if (!mod) throw new Error("The exporters chunk did not load");
      return mod;
    });
    memo = attempt;
    attempt.then(
      () => setRedeploy(FRESH),
      () => {
        if (memo === attempt) memo = undefined;
        const failures = redeploy.failures + 1;
        setRedeploy({ failures, stale: redeploy.stale || failures >= 2 });
      },
    );
  }
  return memo;
}

/** Tests only: forget the loaded module and the redeploy state, and use `importer` (default: the real chunk). */
export function resetExportersForTests(importer: () => Promise<Exporters> = realImporter): void {
  memo = undefined;
  defaultImporter = importer;
  setRedeploy(FRESH);
}

export interface ExportersState {
  status: "idle" | "loading" | "ready" | "error";
  mod?: Exporters;
  /** The app was redeployed under this page (see `RedeployState`): only a reload can help. */
  stale: boolean;
  retry(): void;
}

/** Starts loading the exporters once `enabled` is true (and stays loaded). */
export function useExporters(enabled: boolean): ExportersState {
  const [state, setState] = useState<{ status: ExportersState["status"]; mod?: Exporters }>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const { stale } = useSyncExternalStore(subscribe, redeployState);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    loadExporters().then(
      (mod) => {
        if (live) setState({ status: "ready", mod });
      },
      () => {
        if (live) setState({ status: "error" });
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, stale, retry };
}
