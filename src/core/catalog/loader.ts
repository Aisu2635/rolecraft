import type { ServiceIndex, SlimService } from "../types";
import { createCatalog, type Catalog } from "./catalog";

export interface Loader {
  loadIndex(): Promise<ServiceIndex>;
  loadService(key: string): Promise<SlimService>;
  loadServices(keys: string[]): Promise<Catalog>;
}

export function createLoader(
  fetchJson: (path: string) => Promise<unknown>,
): Loader {
  let indexP: Promise<ServiceIndex> | undefined;
  const serviceP = new Map<string, Promise<SlimService>>();

  function memo<T>(
    get: () => Promise<T> | undefined,
    set: (p: Promise<T> | undefined) => void,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = get();
    if (hit) return hit;
    const p = load().catch((e: unknown) => {
      set(undefined);
      throw e;
    });
    set(p);
    return p;
  }

  return {
    loadIndex: () =>
      memo(
        () => indexP,
        (p) => {
          indexP = p;
        },
        async () => (await fetchJson("/data/index.json")) as ServiceIndex,
      ),
    loadService: (key) =>
      memo(
        () => serviceP.get(key),
        (p) => {
          if (p) serviceP.set(key, p);
          else serviceP.delete(key);
        },
        async () =>
          (await fetchJson(`/data/svc/${key}.json`)) as SlimService,
      ),
    async loadServices(keys) {
      const all = await Promise.all(keys.map((k) => this.loadService(k)));
      return createCatalog(all);
    },
  };
}
