import { useCallback, useEffect, useState } from "react";
import { createEmptyModel, type RoleModel } from "../core/model/model";
import { encodeModel, MAX_SHARE_LENGTH, readModelFromHash } from "../core/model/share";
import { useBuilderStore } from "./builder";

const HASH_PREFIX = "#s=";
const DEBOUNCE_MS = 300;

/** The role a share hash holds. A hash without "#s=" is just an empty role; a "#s=" that fails to decode is invalid. */
export function initialModel(hash: string): { model: RoleModel; invalid: boolean } {
  if (!hash.startsWith(HASH_PREFIX)) return { model: createEmptyModel(), invalid: false };
  const model = readModelFromHash(hash);
  return model ? { model, invalid: false } : { model: createEmptyModel(), invalid: true };
}

/** Writes the model into the URL hash (no history entry). Past the length limit the hash is cleared instead. */
export function syncHash(
  model: RoleModel,
  loc: Pick<Location, "pathname" | "search" | "hash">,
  h: Pick<History, "replaceState" | "state">,
): "ok" | "too-large" {
  const base = loc.pathname + loc.search;
  const enc = encodeModel(model);
  if (enc.length > MAX_SHARE_LENGTH) {
    h.replaceState(h.state, "", base);
    return "too-large";
  }
  h.replaceState(h.state, "", base + HASH_PREFIX + enc);
  return "ok";
}

const EMPTY_ENCODED = encodeModel(createEmptyModel());

/** Keeps the builder and the URL hash in step. Mount it once, inside the builder. */
export function useShareSync(): { invalidLink: boolean; dismiss(): void } {
  const [invalidLink, setInvalidLink] = useState(false);
  const dismiss = useCallback(() => setInvalidLink(false), []);

  useEffect(() => {
    // Writing onto another route's URL would corrupt it, so remember where the builder lives.
    const path = window.location.pathname;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The hash we wrote ourselves, so the matching hashchange is not mistaken for a pasted link.
    let written: string | null = null;

    const write = (): void => {
      timer = undefined;
      if (window.location.pathname !== path) return;
      const status = syncHash(useBuilderStore.getState().model, window.location, window.history);
      written = window.location.hash;
      useBuilderStore.getState().setShareStatus(status);
    };
    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(write, DEBOUNCE_MS);
    };

    const load = (hash: string): void => {
      if (!hash.startsWith(HASH_PREFIX)) return;
      const { model, invalid } = initialModel(hash);
      written = null;
      setInvalidLink(invalid);
      const s = useBuilderStore.getState();
      s.replaceModel(model);
      s.setStep(model.grants.length > 0 ? 1 : 0);
    };

    const unsubscribe = useBuilderStore.subscribe((s, prev) => {
      if (s.model !== prev.model) schedule();
    });
    const onHashChange = (): void => {
      if (window.location.hash !== written) load(window.location.hash);
    };
    window.addEventListener("hashchange", onHashChange);

    if (window.location.hash.startsWith(HASH_PREFIX)) load(window.location.hash);
    // No link: keep whatever role is already in memory and reflect it, but leave an untouched empty role alone.
    else if (encodeModel(useBuilderStore.getState().model) !== EMPTY_ENCODED) schedule();

    return () => {
      window.removeEventListener("hashchange", onHashChange);
      unsubscribe();
      if (timer !== undefined) {
        clearTimeout(timer);
        write();
      }
    };
  }, []);

  return { invalidLink, dismiss };
}
