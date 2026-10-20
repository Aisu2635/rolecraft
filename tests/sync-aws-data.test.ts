// @vitest-environment node
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIST_URL, syncAwsData, type SyncOptions } from "../scripts/sync-aws-data";

const H = "https://servicereference.us-east-1.amazonaws.com";
const svcUrl = (k: string) => `${H}/v1/${k}/${k}.json`;
// assertSanity wants >= 400 services including s3, ec2 and iam.
const KEYS = ["s3", "ec2", "iam", ...Array.from({ length: 397 }, (_, i) => `svc-${i}`)];
const FLAGS = { IsList: false, IsWrite: false, IsPermissionManagement: false, IsTaggingOnly: false };
const svcJson = (k: string, extra: unknown[] = []) => ({
  Name: k,
  Actions: [{ Name: "GetThing", Annotations: { Properties: FLAGS } }, ...extra],
});
/** An action whose Properties lacks IsWrite: its access level is unknown, so it must be dropped. */
const noWrite = (name: string) => ({
  Name: name,
  Annotations: { Properties: { IsList: false, IsPermissionManagement: false, IsTaggingOnly: false } },
});
/** Serves each of these services with one extra action that lacks IsWrite. */
const withNoWrite = (keys: string[]) => (url: string) => {
  const k = keys.find((x) => svcUrl(x) === url);
  return k ? json(svcJson(k, [noWrite(`Put${k}`)])) : undefined;
};

type Reply = (url: string, attempt: number) => Response | Promise<Response> | undefined;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** A fake fetch serving the list and the services; `override` can change any reply. */
function fakeFetch(override?: Reply, list: unknown = KEYS.map((k) => ({ service: k, url: svcUrl(k) }))) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const attempts = new Map<string, number>();
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const n = attempts.get(url) ?? 0;
    attempts.set(url, n + 1);
    const o = override ? await override(url, n) : undefined;
    if (o) return o;
    if (url === LIST_URL) return json(list);
    const key = KEYS.find((k) => svcUrl(k) === url);
    return key ? json(svcJson(key)) : json({}, 404);
  });
  return { fn: fn as unknown as typeof fetch, calls, attempts };
}

let root: string;
let outDir: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "rc-sync-"));
  outDir = path.join(root, "data");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

const opts = (fetch: typeof globalThis.fetch, extra: Partial<SyncOptions> = {}): SyncOptions => ({
  fetch,
  outDir,
  sleep: async () => undefined,
  today: "2026-10-19",
  log: () => undefined,
  warn: () => undefined,
  ...extra,
});

/** A previous sync's output: one service that is no longer listed (stale) and an old index. */
function seedOld() {
  mkdirSync(path.join(outDir, "svc"), { recursive: true });
  writeFileSync(path.join(outDir, "svc", "gone.json"), "{}");
  writeFileSync(path.join(outDir, "svc", "s3.json"), '"old s3"');
  writeFileSync(path.join(outDir, "index.json"), '"old index"');
}
const read = (...p: string[]) => readFileSync(path.join(outDir, ...p), "utf8");
const siblings = () => readdirSync(root).sort();

describe("syncAwsData", () => {
  it("writes every service and the index, removes stale files, and leaves no temp dir", async () => {
    seedOld();
    const { fn } = fakeFetch();
    await expect(syncAwsData(opts(fn))).resolves.toBe(400);
    expect(readdirSync(path.join(outDir, "svc"))).toHaveLength(400);
    expect(existsSync(path.join(outDir, "svc", "gone.json"))).toBe(false);
    expect(JSON.parse(read("svc", "s3.json")).key).toBe("s3");
    const index = JSON.parse(read("index.json"));
    expect(index.generatedAt).toBe("2026-10-19");
    expect(index.services).toHaveLength(400);
    expect(siblings()).toEqual(["data"]);
  });

  it("works when there is no previous output", async () => {
    const { fn } = fakeFetch();
    await syncAwsData(opts(fn));
    expect(readdirSync(path.join(outDir, "svc"))).toHaveLength(400);
    expect(siblings()).toEqual(["data"]);
  });

  it("gives every request a 30 s timeout signal", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const { fn, calls } = fakeFetch();
    await syncAwsData(opts(fn));
    expect(calls).toHaveLength(401);
    expect(timeout).toHaveBeenCalledTimes(401);
    for (const [ms] of timeout.mock.calls) expect(ms).toBe(30_000);
    for (const c of calls) expect(c.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not retry a 4xx", async () => {
    seedOld();
    const { fn, attempts } = fakeFetch((url) => (url === svcUrl("ec2") ? json({}, 403) : undefined));
    await expect(syncAwsData(opts(fn))).rejects.toThrow(/ec2: Failed to fetch .*HTTP 403/);
    expect(attempts.get(svcUrl("ec2"))).toBe(1);
    expect(read("index.json")).toBe('"old index"');
  });

  it("does not retry a 4xx on the service list", async () => {
    const { fn, attempts } = fakeFetch((url) => (url === LIST_URL ? json({}, 404) : undefined));
    await expect(syncAwsData(opts(fn))).rejects.toThrow(/HTTP 404/);
    expect(attempts.get(LIST_URL)).toBe(1);
  });

  it("retries a 5xx and a network error, then succeeds", async () => {
    const slept: number[] = [];
    const { fn, attempts } = fakeFetch((url, n) => {
      if (url === svcUrl("s3") && n < 2) return json({}, 503);
      if (url === svcUrl("iam") && n === 0) return Promise.reject(new TypeError("fetch failed"));
      return undefined;
    });
    await syncAwsData(opts(fn, { sleep: async (ms) => void slept.push(ms) }));
    expect(attempts.get(svcUrl("s3"))).toBe(3);
    expect(attempts.get(svcUrl("iam"))).toBe(2);
    expect(slept.sort((a, b) => a - b)).toEqual([1000, 1000, 2000]);
  });

  it("gives up after 3 retries of a 5xx", async () => {
    const { fn, attempts } = fakeFetch((url) => (url === svcUrl("s3") ? json({}, 500) : undefined));
    await expect(syncAwsData(opts(fn))).rejects.toThrow(/s3: Failed to fetch .*HTTP 500/);
    expect(attempts.get(svcUrl("s3"))).toBe(4);
  });

  it("fails on a duplicate service key in the list, naming it", async () => {
    const list = [...KEYS, "s3"].map((k) => ({ service: k, url: svcUrl(k) }));
    const { fn, calls } = fakeFetch(undefined, list);
    await expect(syncAwsData(opts(fn))).rejects.toThrow('Duplicate service key "s3" in service list');
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["another host", "https://evil.example.com/v1/s3/s3.json"],
    ["http", svcUrl("s3").replace("https:", "http:")],
    ["a port", `${H}:8443/v1/s3/s3.json`],
    ["userinfo", svcUrl("s3").replace("https://", "https://user@")],
    ["no path", H],
  ])("fails when an entry url has %s", async (_n, url) => {
    const list = KEYS.map((k) => ({ service: k, url: k === "s3" ? url : svcUrl(k) }));
    const { fn, calls } = fakeFetch(undefined, list);
    await expect(syncAwsData(opts(fn))).rejects.toThrow(`Service "s3" url must start with ${H}/`);
    expect(calls).toHaveLength(1);
  });

  it("leaves the previous output untouched and removes the temp dir when a write fails", async () => {
    seedOld();
    const { fn } = fakeFetch();
    let n = 0;
    const failing = async (p: string, d: string) => {
      if (++n === 200) throw new Error("disk full");
      await writeFile(p, d);
    };
    await expect(syncAwsData(opts(fn, { writeFile: failing }))).rejects.toThrow("disk full");
    expect(read("index.json")).toBe('"old index"');
    expect(read("svc", "s3.json")).toBe('"old s3"');
    expect(existsSync(path.join(outDir, "svc", "gone.json"))).toBe(true);
    expect(siblings()).toEqual(["data"]);
  });

  it("removes a leftover .data-old from an older sync at the start", async () => {
    mkdirSync(path.join(root, ".data-old", "svc"), { recursive: true });
    writeFileSync(path.join(root, ".data-old", "svc", "x.json"), "{}");
    const { fn } = fakeFetch();
    await syncAwsData(opts(fn));
    expect(siblings()).toEqual(["data"]);
  });

  it("drops an action missing IsWrite, warns once for its service with the action names, and still syncs", async () => {
    const warnings: string[] = [];
    const { fn } = fakeFetch(withNoWrite(["svc-1"]));
    await expect(syncAwsData(opts(fn, { warn: (m) => void warnings.push(m) }))).resolves.toBe(400);
    expect(warnings).toEqual(['svc-1: dropped 1 action(s) with missing access-level flags: Putsvc-1']);
    const svc1 = JSON.parse(read("svc", "svc-1.json"));
    expect(svc1.actions.map((a: { name: string }) => a.name)).toEqual(["GetThing"]);
  });

  it("accepts dropping up to 1% of all actions (4 of 404)", async () => {
    const warnings: string[] = [];
    const { fn } = fakeFetch(withNoWrite(["svc-1", "svc-2", "svc-3", "svc-4"]));
    await syncAwsData(opts(fn, { warn: (m) => void warnings.push(m) }));
    expect(warnings).toHaveLength(4);
  });

  it("fails when more than 1% of all actions would be dropped (5 of 405), naming them, and writes nothing", async () => {
    seedOld();
    const { fn } = fakeFetch(withNoWrite(["svc-1", "svc-2", "svc-3", "svc-4", "svc-5"]));
    const run = syncAwsData(opts(fn));
    await expect(run).rejects.toThrow(/5 of 405 actions \(1\.23%\) .*more than 1%/);
    await expect(run).rejects.toThrow(/svc-1: Putsvc-1.*svc-5: Putsvc-5/s);
    expect(read("index.json")).toBe('"old index"');
  });

  it("fails when any action of a curated service would be dropped, naming it", async () => {
    seedOld();
    const { fn } = fakeFetch(withNoWrite(["s3"]));
    await expect(syncAwsData(opts(fn))).rejects.toThrow(
      "Curated services have actions with missing access-level flags: s3: Puts3",
    );
    expect(read("index.json")).toBe('"old index"');
  });

  it("removes stale files only after every file is moved in, and moves the index last", async () => {
    seedOld();
    const { fn } = fakeFetch();
    const moved: string[] = [];
    const failing = async (from: string, to: string) => {
      moved.push(path.relative(outDir, to));
      if (to.endsWith("index.json")) throw new Error("locked");
      await rename(from, to);
    };
    await expect(syncAwsData(opts(fn, { rename: failing }))).rejects.toThrow("locked");
    expect(moved).toHaveLength(401);
    expect(moved.at(-1)).toBe("index.json");
    // Expected, index-consistent outcome of a mid-move failure: the new svc files are in, the old index still
    // lists only services whose files exist (each file valid on its own), nothing stale is deleted, and the next
    // sync repairs it. There is no rollback (see the swap ruling in scripts/sync-aws-data.ts).
    expect(existsSync(path.join(outDir, "svc", "gone.json"))).toBe(true);
    expect(read("index.json")).toBe('"old index"');
    expect(siblings()).toEqual(["data"]);
  });

  it("retries a move that Windows refuses while a file is briefly locked", async () => {
    const { fn } = fakeFetch();
    let refused = 0;
    const flaky = async (from: string, to: string) => {
      if (to.endsWith("s3.json") && refused++ < 2) throw Object.assign(new Error("EPERM"), { code: "EPERM" });
      await rename(from, to);
    };
    await syncAwsData(opts(fn, { rename: flaky }));
    expect(refused).toBe(3);
    expect(JSON.parse(read("svc", "s3.json")).key).toBe("s3");
  });
});
