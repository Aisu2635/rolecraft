// Fails the build when yaml or fflate (the exporters' dependencies) end up in the initial bundle.
// Reads dist/.vite/manifest.json (vite `build.manifest`), walks the static `imports` from the index.html entry.
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ManifestChunk {
  file: string;
  imports?: string[];
  isEntry?: boolean;
}
export type Manifest = Record<string, ManifestChunk>;

const LAZY_PREFIXES = ["assets/yaml-", "assets/fflate-"];

/** Problems found (empty when fine) and the files in the entry's static closure. */
export function checkManifest(manifest: Manifest, entryKey = "index.html"): { errors: string[]; files: string[] } {
  const errors: string[] = [];
  const all = Object.values(manifest).map((c) => c.file);
  for (const prefix of LAZY_PREFIXES) {
    if (!all.some((f) => f.startsWith(prefix))) errors.push(`${prefix}*.js is missing from the manifest (is manualChunks set up?)`);
  }
  const files: string[] = [];
  const seen = new Set<string>();
  const visit = (key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) {
      errors.push(`manifest has no entry for ${key}`);
      return;
    }
    files.push(chunk.file);
    for (const dep of chunk.imports ?? []) visit(dep);
  };
  visit(entryKey);
  for (const f of files) {
    if (LAZY_PREFIXES.some((p) => f.startsWith(p))) errors.push(`${f} is statically imported by the initial bundle`);
  }
  return { errors, files };
}

function main(): number {
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
  const manifest = JSON.parse(readFileSync(path.join(dist, ".vite", "manifest.json"), "utf8")) as Manifest;
  const { errors, files } = checkManifest(manifest);
  const bytes = files.reduce((n, f) => n + statSync(path.join(dist, f)).size, 0);
  console.log(`Initial bundle (index.html static closure): ${files.length} files, ${(bytes / 1024).toFixed(1)} KB`);
  for (const e of errors) console.error(`check-bundle: ${e}`);
  return errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
