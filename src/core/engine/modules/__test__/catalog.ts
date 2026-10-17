import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createCatalog, type Catalog } from "../../../catalog/catalog";
import type { SlimService } from "../../../types";

/** Test helper: loads real slim service files from public/data/svc. */
export function loadRealCatalog(keys: string[]): Catalog {
  const dir = resolve(process.cwd(), "public/data/svc");
  return createCatalog(
    keys.map((k) => JSON.parse(readFileSync(resolve(dir, `${k}.json`), "utf8")) as SlimService),
  );
}
