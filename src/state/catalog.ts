import { createContext } from "react";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createLoader, type Loader } from "../core/catalog/loader";
import type { ServiceIndex, SlimService } from "../core/types";

export type LoadStatus = "loading" | "ready" | "error" | "missing";

export interface CatalogState {
  index: ServiceIndex | null;
  indexStatus: "idle" | "loading" | "ready" | "error";
  services: Record<string, SlimService>;
  status: Record<string, LoadStatus>;
  ensureIndex(): Promise<void>;
  ensureServices(keys: string[]): Promise<void>;
  retry(key: string): Promise<void>;
}

export function createCatalogStore(loader: Loader): UseBoundStore<StoreApi<CatalogState>> {
  // In-flight work is shared so concurrent callers (and retry during a load) await one request.
  let indexInflight: Promise<void> | undefined;
  const keyInflight = new Map<string, Promise<void>>();

  return create<CatalogState>((set, get) => {
    const setStatus = (key: string, s: LoadStatus): void =>
      set((st) => ({ status: { ...st.status, [key]: s } }));

    function loadKey(key: string): Promise<void> {
      const hit = keyInflight.get(key);
      if (hit) return hit;
      setStatus(key, "loading");
      const p = loader.loadService(key).then(
        (svc) => {
          set((st) => ({ services: { ...st.services, [key]: svc }, status: { ...st.status, [key]: "ready" } }));
        },
        () => setStatus(key, "error"),
      );
      const tracked = p.finally(() => {
        keyInflight.delete(key);
      });
      keyInflight.set(key, tracked);
      return tracked;
    }

    // Assumes ensureIndex has settled.
    async function resolveKey(key: string): Promise<void> {
      const { index } = get();
      if (!index) return setStatus(key, "error");
      if (!index.services.some((s) => s.key === key)) return setStatus(key, "missing");
      await loadKey(key);
    }

    return {
      index: null,
      indexStatus: "idle",
      services: {},
      status: {},

      ensureIndex() {
        if (get().indexStatus === "ready") return Promise.resolve();
        if (indexInflight) return indexInflight;
        set({ indexStatus: "loading" });
        const p = loader.loadIndex().then(
          (index) => set({ index, indexStatus: "ready" }),
          () => set({ indexStatus: "error" }),
        );
        const tracked = p.finally(() => {
          indexInflight = undefined;
        });
        indexInflight = tracked;
        return tracked;
      },

      async ensureServices(keys) {
        const wanted = [...new Set(keys)].filter((k) => {
          const s = get().status[k];
          return s !== "ready" && s !== "missing" && s !== "error";
        });
        for (const k of wanted) if (!get().status[k]) setStatus(k, "loading");
        if (wanted.length === 0) return;
        await get().ensureIndex();
        await Promise.all(wanted.map(resolveKey));
      },

      async retry(key) {
        const hit = keyInflight.get(key);
        if (hit) return hit;
        if (get().status[key] === "ready" || get().status[key] === "missing") return;
        setStatus(key, "loading");
        await get().ensureIndex();
        await resolveKey(key);
      },
    };
  });
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Request for ${path} failed (${res.status}).`);
  return res.json();
}

export const useCatalogStore = createCatalogStore(createLoader(fetchJson));

export const CatalogContext = createContext<ReturnType<typeof createCatalogStore>>(useCatalogStore);
