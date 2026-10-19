import { useContext, useEffect } from "react";
import { useBuilderStore } from "./builder";
import { CatalogContext } from "./catalog";

/** Keeps the catalog loaded for every service the model uses, including grants restored from a share link. */
export function useEnsureCatalog(): void {
  const store = useContext(CatalogContext);
  // A joined string keeps the dependency stable while the set of services is unchanged.
  const keys = useBuilderStore((s) =>
    [...new Set(s.model.grants.map((g) => g.service))].sort().join(","),
  );
  useEffect(() => {
    const { ensureIndex, ensureServices } = store.getState();
    void ensureIndex();
    if (keys) void ensureServices(keys.split(","));
  }, [store, keys]);
}
