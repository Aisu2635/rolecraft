import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertSanity,
  buildIndex,
  toSlimService,
} from "../src/core/catalog/transform.ts";
import type { SlimService } from "../src/core/types.ts";

const LIST_URL =
  "https://servicereference.us-east-1.amazonaws.com/v1/service-list.json";
const CONCURRENCY = 8;
const RETRIES = 3;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public", "data");
const svcDir = path.join(dataDir, "svc");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `Failed to fetch ${url}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

async function main(): Promise<void> {
  const list = (await fetchJson(LIST_URL)) as { service: string; url: string }[];
  if (!Array.isArray(list)) throw new Error("Unexpected service list shape");
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

  const index = buildIndex(results, new Date().toISOString().slice(0, 10));
  assertSanity(index);

  await mkdir(svcDir, { recursive: true });
  const keep = new Set(results.map((s) => `${s.key}.json`));
  for (const f of await readdir(svcDir)) {
    if (!keep.has(f)) await rm(path.join(svcDir, f));
  }
  await Promise.all(
    results.map((s) =>
      writeFile(path.join(svcDir, `${s.key}.json`), JSON.stringify(s)),
    ),
  );
  await writeFile(path.join(dataDir, "index.json"), JSON.stringify(index));
  console.log(`Wrote ${results.length} services to public/data`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
