import { useEffect, useRef, type RefObject } from "react";
import { useBuilderStore } from "../../state/builder";

const FOCUSABLE = 'input:not([disabled]), select, textarea, button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Attach the returned ref to a wrapper. When the store's focusTarget becomes `id` the wrapper is scrolled into
 * view, its first focusable element is focused and the target is cleared. `onFocus` runs just before the clear.
 */
export function useFocusTarget<T extends HTMLElement>(id: string, onFocus?: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const active = useBuilderStore((s) => s.focusTarget === id);
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    // jsdom has no scrollIntoView.
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center" });
    el.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    onFocus?.();
    useBuilderStore.getState().focus(null);
  }, [active, onFocus]);
  return ref;
}
