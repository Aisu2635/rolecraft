import { useEffect, useRef, useState, type RefObject } from "react";
import { useBuilderStore } from "../../state/builder";

const FOCUSABLE = 'input:not([disabled]), select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Attach the returned ref to a wrapper. When the store's focusTarget becomes `id` the target is claimed (cleared)
 * and `onFocus` runs, e.g. to reveal an error or open a collapsed section. After the re-render that causes, the
 * wrapper is scrolled into view and its first focusable element is focused. With `prefer`, the first element
 * matching that selector is focused instead when there is one.
 */
export function useFocusTarget<T extends HTMLElement>(
  id: string,
  onFocus?: () => void,
  prefer?: string,
): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const active = useBuilderStore((s) => s.focusTarget === id);
  // Counts claims; each one focuses once, after the render that onFocus caused.
  const [claims, setClaims] = useState(0);
  useEffect(() => {
    if (!active || !ref.current) return;
    onFocus?.();
    useBuilderStore.getState().focus(null);
    setClaims((n) => n + 1);
  }, [active, onFocus]);
  useEffect(() => {
    const el = ref.current;
    if (claims === 0 || !el) return;
    // jsdom has no scrollIntoView.
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    ((prefer ? el.querySelector<HTMLElement>(prefer) : null) ?? el.querySelector<HTMLElement>(FOCUSABLE))?.focus();
  }, [claims, prefer]);
  return ref;
}
