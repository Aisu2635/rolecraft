import { strToU8, zipSync, type Zippable } from "fflate";
import type { ExportFile } from "./json";

/**
 * fflate writes the DOS timestamp from the local-time getters, so a local-time Date (not a UTC instant)
 * gives 2020-01-01 00:00 and identical bytes in every timezone.
 */
const MTIME = new Date(2020, 0, 1, 0, 0, 0);
const UNIX = 3;
const REGULAR_FILE = 0o100000;

/** ZIP of the files at the archive root, byte-identical for identical input; `.sh` files unzip executable on Unix. */
export function exportZip(files: ExportFile[]): Uint8Array {
  const zippable: Zippable = {};
  for (const f of files) {
    const mode = REGULAR_FILE | (f.filename.endsWith(".sh") ? 0o755 : 0o644);
    // Multiplying (not <<) keeps the value positive: the type bits reach bit 31.
    zippable[f.filename] = [strToU8(f.content), { mtime: MTIME, os: UNIX, attrs: mode * 0x10000 }];
  }
  return zipSync(zippable, { level: 9 });
}
