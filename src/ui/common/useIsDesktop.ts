import { useCallback, useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Missing matchMedia (old browsers, jsdom) counts as desktop so the builder never locks anyone out. */
export function useIsDesktop(query: string = DESKTOP_QUERY): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", cb);
      return () => mql.removeEventListener("change", cb);
    },
    [query],
  );
  const get = useCallback(
    () =>
      typeof window.matchMedia === "function"
        ? window.matchMedia(query).matches
        : true,
    [query],
  );
  return useSyncExternalStore(subscribe, get, () => true);
}
