import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { createLoader } from "../../../core/catalog/loader";
import type { Grant } from "../../../core/model/model";
import { CatalogContext, createCatalogStore } from "../../../state/catalog";
import { DerivedProvider } from "../../../state/derive";
import { newGrantFor } from "../../../state/model-ops";

const read = (p: string): unknown => JSON.parse(readFileSync(resolve("public", p.replace(/^\//, "")), "utf8"));

/** A catalog store backed by the real data files in public/. Test helper, not production code. */
export async function readyCatalog(...keys: string[]) {
  const store = createCatalogStore(createLoader(async (p) => read(p)));
  await store.getState().ensureServices(keys);
  return store;
}

/** Provides the catalog and, as the Builder does, the derived output that the panels read. */
export function withCatalog(store: Awaited<ReturnType<typeof readyCatalog>>, children: ReactNode): ReactNode {
  return (
    <CatalogContext.Provider value={store}>
      <DerivedProvider>{children}</DerivedProvider>
    </CatalogContext.Provider>
  );
}

export function grantFor(store: Awaited<ReturnType<typeof readyCatalog>>, key: string, id = "g1"): Grant {
  const svc = store.getState().services[key];
  if (!svc) throw new Error("service not loaded: " + key);
  return { ...newGrantFor(svc), id };
}
