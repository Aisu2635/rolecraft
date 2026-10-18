import { useContext, useMemo } from "react";
import { createCatalog } from "../core/catalog/catalog";
import { explain } from "../core/explain/explain";
import type { ExportInput } from "../core/export/types";
import { generate } from "../core/generate";
import type { RoleModel } from "../core/model/model";
import { useBuilderStore } from "./builder";
import { CatalogContext, type CatalogState } from "./catalog";

export type Derived =
  | { kind: "loading"; pending: string[] }
  | { kind: "error"; failed: string[] }
  | { kind: "ready"; input: ExportInput; missing: string[] };

export function deriveOutput(
  model: RoleModel,
  cat: Pick<CatalogState, "index" | "services" | "status">,
): Derived {
  const keys = [...new Set(model.grants.map((g) => g.service))];
  const failed = keys.filter((k) => cat.status[k] === "error");
  if (failed.length > 0) return { kind: "error", failed };
  const pending = keys.filter((k) => {
    const s = cat.status[k];
    return s === undefined || s === "loading";
  });
  if (pending.length > 0) return { kind: "loading", pending };
  const missing = keys.filter((k) => cat.status[k] === "missing");
  const catalog = createCatalog(keys.filter((k) => cat.status[k] === "ready").flatMap((k) => cat.services[k] ?? []));
  return { kind: "ready", input: { model, result: generate(model, catalog), summary: explain(model, catalog) }, missing };
}

export function useDerived(): Derived {
  const model = useBuilderStore((s) => s.model);
  const store = useContext(CatalogContext);
  const index = store((s) => s.index);
  const services = store((s) => s.services);
  const status = store((s) => s.status);
  return useMemo(() => deriveOutput(model, { index, services, status }), [model, index, services, status]);
}
