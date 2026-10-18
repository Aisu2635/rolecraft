import { useCallback, useEffect, useState } from "react";

export type Exporters = typeof import("./exporters");

const realImporter = (): Promise<Exporters> => import("./exporters");
let defaultImporter = realImporter;
let memo: Promise<Exporters> | undefined;

/** Loads the exporters chunk once; a failed load isn't remembered, so the next call tries again. */
export function loadExporters(importer: () => Promise<Exporters> = defaultImporter): Promise<Exporters> {
  if (!memo) {
    const attempt = importer();
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
  retry(): void;
}

/** Starts loading the exporters once `enabled` is true (and stays loaded). */
export function useExporters(enabled: boolean): ExportersState {
  const [state, setState] = useState<{ status: ExportersState["status"]; mod?: Exporters }>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    loadExporters().then(
      (mod) => live && setState({ status: "ready", mod }),
      () => live && setState({ status: "error" }),
    );
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}
