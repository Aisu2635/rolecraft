// Writes exportAll output for every reference and variant case to tmp/exports/ (Layer-4 tooling input).
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REFERENCE_CASES } from "../src/core/export/__fixtures__/cases.ts";
import { VARIANT_CASES } from "../src/core/export/__fixtures__/variants.ts";
import { exportAll, type ExportInput } from "../src/core/export/index.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// loadRealCatalog reads public/data relative to the working directory.
process.chdir(root);
const outDir = path.join(root, "tmp", "exports");

rmSync(outDir, { recursive: true, force: true });

const cases: [string, () => ExportInput][] = [
  ...Object.entries(REFERENCE_CASES),
  ...Object.entries(VARIANT_CASES).map(([id, b]): [string, () => ExportInput] => [`variant-${id}`, b]),
];

let files = 0;
/** case id -> file names exportAll returned (scripts/check_manifest.py compares it with the directories). */
const manifest: Record<string, string[]> = {};
for (const [id, build] of cases) {
  const outcome = exportAll(build());
  if (!outcome.ok) throw new Error(`${id}: ${outcome.reason}`);
  const dir = path.join(outDir, id);
  mkdirSync(dir, { recursive: true });
  manifest[id] = outcome.files.map((f) => f.filename);
  for (const f of outcome.files) {
    writeFileSync(path.join(dir, f.filename), f.content);
    files++;
  }
}
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({ cases: manifest }, null, 2) + "\n");
console.log(`Wrote ${files} files for ${cases.length} cases to ${path.relative(root, outDir)}/`);
