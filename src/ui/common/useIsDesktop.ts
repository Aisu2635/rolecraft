import { useCallback, useSyncExternalStore } from "react";

export const DESKTOP_QUERY = "(min-width: 1024px)";

/** Missing matchMedia (old browsers, jsdom) counts as desktop so the builder never locks anyone out. */
export function useIsDesktop(query: string = DESKTOP_QUERY): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      // Safari < 14 only has the deprecated addListener/removeListener.
      if (typeof mql.addEventListener === "function") {
        mql.addEventListener("change", cb);
        return () => mql.removeEventListener("change", cb);
      }
      mql.addListener(cb);
      return () => mql.removeListener(cb);
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
