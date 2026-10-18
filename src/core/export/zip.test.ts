import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { REFERENCE_CASES } from "./__fixtures__/cases";
import { exportAll } from "./index";
import type { ExportFile } from "./json";
import { exportZip } from "./zip";

const filesOf = (n: string): ExportFile[] => {
  const out = exportAll((REFERENCE_CASES[n] as () => Parameters<typeof exportAll>[0])());
  if (!out.ok) throw new Error(out.reason);
  return out.files;
};

interface Entry {
  name: string;
  madeBy: number;
  mode: number;
  dosTime: number;
  dosDate: number;
}

/** Central directory entries (APPNOTE 4.3.12). */
function centralDirectory(zip: Uint8Array): Entry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    out.push({
      name: new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen)),
      madeBy: v.getUint16(p + 4, true) >> 8,
      mode: v.getUint32(p + 38, true) >>> 16,
      dosTime: v.getUint16(p + 12, true),
      dosDate: v.getUint16(p + 14, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const DOS_2020_01_01 = ((2020 - 1980) << 9) | (1 << 5) | 1;

describe("exportZip", () => {
  it.each(Object.keys(REFERENCE_CASES))("round-trips every file: %s", (n) => {
    const files = filesOf(n);
    const unzipped = unzipSync(exportZip(files));
    expect(Object.keys(unzipped)).toEqual(files.map((f) => f.filename));
    for (const f of files) expect(strFromU8(unzipped[f.filename] as Uint8Array)).toBe(f.content);
  });

  it("is deterministic", () => {
    const files = filesOf("github-deploy");
    expect(exportZip(files)).toEqual(exportZip(files));
    expect(exportZip(files)).toEqual(exportZip(filesOf("github-deploy")));
  });

  it("puts files at the root with a fixed 2020-01-01 00:00 timestamp", () => {
    for (const e of centralDirectory(exportZip(filesOf("eks-user")))) {
      expect(e.name).not.toContain("/");
      expect(e.dosTime).toBe(0);
      expect(e.dosDate).toBe(DOS_2020_01_01);
    }
  });

  it("marks .sh files executable (Unix attributes)", () => {
    const entries = centralDirectory(exportZip(filesOf("ec2-ssm")));
    expect(entries.map((e) => e.name)).toContain("create-role.sh");
    for (const e of entries) {
      expect(e.madeBy).toBe(3);
      expect(e.mode).toBe(e.name.endsWith(".sh") ? 0o100755 : 0o100644);
    }
  });

  it("produces the same bytes in every timezone", () => {
    // Vitest runs from the repository root (import.meta.url is not a file URL under jsdom).
    const zipModule = pathToFileURL(resolve("src/core/export/zip.ts")).href;
    const files: ExportFile[] = [
      { filename: "create-role.sh", language: "bash", content: "echo hi\n" },
      { filename: "README.md", language: "markdown", content: "# hi\n" },
    ];
    const script = [
      `import { exportZip } from ${JSON.stringify(zipModule)};`,
      `process.stdout.write(Buffer.from(exportZip(${JSON.stringify(files)})).toString("base64"));`,
    ].join("\n");
    const run = (tz: string): string =>
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
        env: { ...process.env, TZ: tz },
        encoding: "utf8",
      });
    const here = Buffer.from(exportZip(files)).toString("base64");
    for (const tz of ["America/Los_Angeles", "Asia/Tokyo", "UTC", "Pacific/Kiritimati"]) {
      expect(run(tz)).toBe(here);
    }
  }, 30_000);
});
