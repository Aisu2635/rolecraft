import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assertSanity,
  buildIndex,
  toSlimService,
} from "../src/core/catalog/transform.ts";
import type { SlimService } from "../src/core/types.ts";

const LIST_URL =
  "https://servicereference.us-east-1.amazonaws.com/v1/service-list.json";
const ALLOWED_HOST = "servicereference.us-east-1.amazonaws.com";
const SERVICE_KEY = /^[a-z0-9-]{1,64}$/;
const CONCURRENCY = 8;
const RETRIES = 3;
const REQUEST_TIMEOUT_MS = 30_000;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const dataDir = path.join(publicDir, "data");
const newDir = path.join(publicDir, ".data-new");
const oldDir = path.join(publicDir, ".data-old");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class PermanentError extends Error {}

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
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

/** Validates the service list: entry shape, key charset, https URL on the AWS host, no duplicate keys. */
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
    let u: URL;
    try {
      u = new URL(e.url);
    } catch {
      throw new Error(`Service "${e.service}" has an invalid url`);
    }
    if (u.protocol !== "https:" || u.hostname !== ALLOWED_HOST) {
      throw new Error(
        `Service "${e.service}" url must be https on ${ALLOWED_HOST}`,
      );
    }
    if (seen.has(e.service)) {
      throw new Error(`Duplicate service key "${e.service}" in service list`);
    }
    seen.add(e.service);
    return { service: e.service, url: e.url };
  });
}

async function main(): Promise<void> {
  const list = validateList(await fetchJson(LIST_URL));
  console.log(`Fetching ${list.length} services...`);

  const results: SlimService[] = new Array<SlimService>(list.length);
  const errors: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      const entry = list[i];
      if (!entry) continue;
      try {
        const slim = toSlimService(await fetchJson(entry.url));
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
  const keys = new Set(results.map((s) => s.key));
  if (keys.size !== results.length) throw new Error("Duplicate service keys in results");

  const index = buildIndex(results, new Date().toISOString().slice(0, 10));
  assertSanity(index);

  // Write everything to a temp dir first; only swap into place once all writes succeed.
  await rm(newDir, { recursive: true, force: true });
  await rm(oldDir, { recursive: true, force: true });
  try {
    await mkdir(path.join(newDir, "svc"), { recursive: true });
    await Promise.all(
      results.map((s) =>
        writeFile(path.join(newDir, "svc", `${s.key}.json`), JSON.stringify(s)),
      ),
    );
    await writeFile(path.join(newDir, "index.json"), JSON.stringify(index));
  } catch (e) {
    await rm(newDir, { recursive: true, force: true });
    throw e;
  }
  let movedOld = false;
  try {
    try {
      await rename(dataDir, oldDir);
      movedOld = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(newDir, dataDir);
  } catch (e) {
    if (movedOld) await rename(oldDir, dataDir).catch(() => undefined);
    await rm(newDir, { recursive: true, force: true });
    throw e;
  }
  await rm(oldDir, { recursive: true, force: true });
  console.log(`Wrote ${results.length} services to public/data`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
