import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fillArn, matchableTypes } from "../../src/core/arn";
import { createCatalog, type Catalog } from "../../src/core/catalog/catalog";
import type { SlimService } from "../../src/core/types";

const DATA_DIR = join(import.meta.dirname, "..", "..", "public", "data", "svc");
const STANDARD = new Set(["Partition", "Region", "Account"]);
const PLACEHOLDER = /\$\{([A-Za-z0-9]+)\}/g;

export function loadServices(): SlimService[] {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(DATA_DIR, f), "utf8")) as SlimService);
}

export function loadCatalog(services: SlimService[] = loadServices()): Catalog {
  return createCatalog(services);
}

/**
 * One sample ARN per resource type, built from its first ARN format. A trailing placeholder after "/" first gets a
 * multi-segment value (path-like); if the engine then no longer attributes the ARN to its own type (the placeholder
 * was a plain name), fall back to single-segment values.
 */
export function sampleArns(svc: SlimService): string[] {
  const out: string[] = [];
  for (const res of svc.resources) {
    const format = res.arnFormats[0];
    if (format === undefined) continue;
    const matches = [...format.matchAll(PLACEHOLDER)];
    const last = matches[matches.length - 1];
    const build = (pathLike: boolean): string => {
      const values: Record<string, string> = {};
      for (const m of matches) {
        const name = m[1] as string;
        if (STANDARD.has(name)) continue;
        const isLast = m === last;
        values[name] = pathLike && isLast && m.index > 0 && format[m.index - 1] === "/" ? "example/path" : "example";
      }
      return fillArn(format, values, { partition: "aws", accountId: "123456789012", region: "us-east-1" });
    };
    const pathy = build(true);
    out.push(matchableTypes(pathy, svc).includes(res.name) ? pathy : build(false));
  }
  return out;
}
