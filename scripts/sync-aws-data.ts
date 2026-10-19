import { mkdir, readdir, rename as fsRename, rm, unlink, writeFile as fsWriteFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSanity,
  buildIndex,
  toSlimService,
} from "../src/core/catalog/transform.ts";
import type { SlimService } from "../src/core/types.ts";

const ORIGIN = "https://servicereference.us-east-1.amazonaws.com";
/** Every service-list entry url must start with this: https, the AWS host, no port or userinfo. */
const URL_PREFIX = `${ORIGIN}/`;
export const LIST_URL = `${ORIGIN}/v1/service-list.json`;
const SERVICE_KEY = /^[a-z0-9-]{1,64}$/;
const CONCURRENCY = 8;
const RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;
// Windows refuses a rename while another process (an editor, the dev server, antivirus) briefly holds the file.
const LOCKED = new Set(["EPERM", "EACCES", "EBUSY"]);
const MOVE_RETRIES = 5;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public", "data");

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface SyncOptions {
  fetch: typeof fetch;
  /** The output directory, e.g. public/data. */
  outDir: string;
  /** Where files are written first; must be on the same volume as outDir. Default: a sibling of outDir. */
  tmpDir?: string;
  sleep?: (ms: number) => Promise<void>;
  /** The index's generatedAt (YYYY-MM-DD). Default: today in UTC. */
  today?: string;
  log?: (msg: string) => void;
  writeFile?: (file: string, data: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
}

class PermanentError extends Error {}

async function fetchJson(
  url: string,
  fetchFn: typeof fetch,
  sleep: (ms: number) => Promise<void>,
): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // A 4xx will not change on retry; a 5xx, a network error or a timeout might.
      if (res.status >= 400 && res.status < 500) {
        throw new PermanentError(`HTTP ${res.status} for ${url}`);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      if (e instanceof PermanentError) {
        throw new Error(`Failed to fetch ${url}: ${e.message}`, { cause: e });
      }
      lastErr = e;
    }
  }
  throw new Error(
    `Failed to fetch ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

export interface ListEntry {
  service: string;
  url: string;
}

/** Validates the service list: entry shape, key charset, url under the AWS service-reference origin, no duplicate keys. */
export function validateList(list: unknown): ListEntry[] {
  if (!Array.isArray(list)) throw new Error("Unexpected service list shape");
  const seen = new Set<string>();
  return list.map((raw: unknown, i) => {
    const e = raw as Partial<ListEntry> | null;
    if (
      typeof e !== "object" ||
      e === null ||
      typeof e.service !== "string" ||
      typeof e.url !== "string"
    ) {
      throw new Error(`Service list entry ${i} is malformed`);
    }
    if (!SERVICE_KEY.test(e.service)) {
      throw new Error(`Service list entry ${i} has an invalid service key`);
    }
    // A plain prefix check on the raw string: it rules out http, other hosts, ports and userinfo alike.
    if (!e.url.startsWith(URL_PREFIX)) {
      throw new Error(`Service "${e.service}" url must start with ${URL_PREFIX}`);
    }
    if (seen.has(e.service)) {
      throw new Error(`Duplicate service key "${e.service}" in service list`);
    }
    seen.add(e.service);
    return { service: e.service, url: e.url };
  });
}

/** Every file under dir, as paths relative to it ("svc/s3.json"); [] when dir does not exist. */
async function listFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((d) => d.isFile())
      .map((d) => path.relative(dir, path.join(d.parentPath, d.name)));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

/**
 * Fetches the AWS Service Reference and writes `<outDir>/svc/<key>.json` and `<outDir>/index.json`.
 * Nothing in outDir changes until every service is fetched, validated and written to tmpDir. Then the files
 * are moved in one by one (a file rename replaces its target on every platform; there is no portable atomic
 * directory swap), the index last so it never lists a service whose file is missing, and only then are stale
 * files removed. Returns the number of services written.
 */
export async function syncAwsData(opts: SyncOptions): Promise<number> {
  const {
    fetch: fetchFn,
    outDir,
    tmpDir = path.join(path.dirname(outDir), `.${path.basename(outDir)}-new`),
    sleep = defaultSleep,
    today = new Date().toISOString().slice(0, 10),
    log = console.log,
    writeFile = (file, data) => fsWriteFile(file, data),
    rename = fsRename,
  } = opts;

  const list = validateList(await fetchJson(LIST_URL, fetchFn, sleep));
  log(`Fetching ${list.length} services...`);

  const results: SlimService[] = new Array<SlimService>(list.length);
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const entry = list[i];
      if (!entry) continue;
      try {
        const slim = toSlimService(await fetchJson(entry.url, fetchFn, sleep));
        if (slim.key !== entry.service)
          throw new Error(`key mismatch: ${slim.key} vs ${entry.service}`);
        results[i] = slim;
      } catch (e) {
        errors.push(
          `${entry.service}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (errors.length > 0) {
    throw new Error(`${errors.length} service(s) failed:\n${errors.join("\n")}`);
  }

  const index = buildIndex(results, today);
  assertSanity(index);

  const files = new Map<string, string>(results.map((s) => [path.join("svc", `${s.key}.json`), JSON.stringify(s)]));
  files.set("index.json", JSON.stringify(index));

  // 1. Write everything to tmpDir. allSettled: no write may still be running when tmpDir is removed.
  await rm(tmpDir, { recursive: true, force: true });
  try {
    await mkdir(path.join(tmpDir, "svc"), { recursive: true });
    const writes = await Promise.allSettled([...files].map(([rel, data]) => writeFile(path.join(tmpDir, rel), data)));
    const failed = writes.find((w) => w.status === "rejected");
    if (failed) throw failed.reason;
  } catch (e) {
    await rm(tmpDir, { recursive: true, force: true });
    throw e;
  }

  // 2. Move them in, index.json last. 3. Only then remove stale files.
  const moveWithRetry = async (from: string, to: string) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await rename(from, to);
      } catch (e) {
        if (attempt >= MOVE_RETRIES || !LOCKED.has((e as NodeJS.ErrnoException).code ?? "")) throw e;
        await sleep(200 * 2 ** attempt);
      }
    }
  };
  const stale = (await listFiles(outDir)).filter((rel) => !files.has(rel));
  try {
    await mkdir(path.join(outDir, "svc"), { recursive: true });
    for (const rel of [...files.keys()].filter((r) => r !== "index.json")) {
      await moveWithRetry(path.join(tmpDir, rel), path.join(outDir, rel));
    }
    await moveWithRetry(path.join(tmpDir, "index.json"), path.join(outDir, "index.json"));
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  for (const rel of stale) await unlink(path.join(outDir, rel));
  return results.length;
}

async function main(): Promise<void> {
  const n = await syncAwsData({ fetch, outDir: dataDir });
  console.log(`Wrote ${n} services to public/data`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
