import { useCallback, useEffect, useState } from "react";

export type Exporters = typeof import("./exporters");

const realImporter = (): Promise<Exporters> => import("./exporters");
let defaultImporter = realImporter;
let memo: Promise<Exporters> | undefined;

/**
 * Loads the exporters chunk once; a failed load isn't remembered, so the next call tries again. A load that resolves
 * to nothing (Vite resolves it that way once a `vite:preloadError` is handled) counts as a failure.
 */
export function loadExporters(importer: () => Promise<Exporters> = defaultImporter): Promise<Exporters> {
  if (!memo) {
    const attempt = importer().then((mod) => {
      if (!mod) throw new Error("The exporters chunk did not load");
      return mod;
    });
    memo = attempt;
    attempt.catch(() => {
      if (memo === attempt) memo = undefined;
    });
  }
  return memo;
}

/** Tests only: forget the loaded module and use `importer` (default: the real chunk) for later loads. */
export function resetExportersForTests(importer: () => Promise<Exporters> = realImporter): void {
  memo = undefined;
  defaultImporter = importer;
}

export interface ExportersState {
  status: "idle" | "loading" | "ready" | "error";
  mod?: Exporters;
  /**
   * The app was redeployed under this page: the chunk failed twice in a row, or Vite reported a preload error. The
   * old chunk is gone for good, so Retry cannot help; only a reload can.
   */
  stale: boolean;
  retry(): void;
}

/** Starts loading the exporters once `enabled` is true (and stays loaded). */
export function useExporters(enabled: boolean): ExportersState {
  const [state, setState] = useState<{ status: ExportersState["status"]; mod?: Exporters }>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [failures, setFailures] = useState(0);
  const [preloadFailed, setPreloadFailed] = useState(false);
  useEffect(() => {
    const onPreloadError = (e: Event): void => {
      e.preventDefault();
      setPreloadFailed(true);
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => window.removeEventListener("vite:preloadError", onPreloadError);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    loadExporters().then(
      (mod) => {
        if (!live) return;
        setState({ status: "ready", mod });
        setFailures(0);
      },
      () => {
        if (!live) return;
        setState({ status: "error" });
        setFailures((n) => n + 1);
      },
    );
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, stale: preloadFailed || failures >= 2, retry };
}
