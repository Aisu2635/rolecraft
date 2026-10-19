import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createLoader } from "../core/catalog/loader";
import { createCatalogStore } from "./catalog";

const read = (p: string): unknown => JSON.parse(readFileSync(resolve("public", p.replace(/^\//, "")), "utf8"));

function fakeLoader(opts: { failOnce?: string[]; failIndexOnce?: boolean } = {}) {
  const failOnce = new Set(opts.failOnce ?? []);
  let failIndex = opts.failIndexOnce ?? false;
  const calls: string[] = [];
  const loader = createLoader(async (path) => {
    calls.push(path);
    if (path === "/data/index.json" && failIndex) {
      failIndex = false;
      throw new Error("index down");
    }
    const m = /^\/data\/svc\/(.+)\.json$/.exec(path);
    const key = m?.[1];
    if (key !== undefined && failOnce.has(key)) {
      failOnce.delete(key);
      throw new Error("boom");
    }
    return read(path);
  });
  return { loader, calls };
}
const svcCalls = (calls: string[]) => calls.filter((c) => c.endsWith("/s3.json"));

describe("catalog store", () => {
  it("loads a listed service on demand", async () => {
    const { loader } = fakeLoader();
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["s3"]);
    expect(store.getState().status["s3"]).toBe("ready");
    expect(store.getState().services["s3"]?.key).toBe("s3");
    expect(store.getState().indexStatus).toBe("ready");
  });

  it("marks keys absent from the index as missing without fetching them", async () => {
    const { loader, calls } = fakeLoader();
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["gone-svc"]);
    expect(store.getState().status["gone-svc"]).toBe("missing");
    expect(calls.some((c) => c.includes("gone-svc"))).toBe(false);
  });

  it("records a failed fetch as error and retry recovers", async () => {
    const { loader } = fakeLoader({ failOnce: ["s3"] });
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["s3"]);
    expect(store.getState().status["s3"]).toBe("error");
    await store.getState().retry("s3");
    expect(store.getState().status["s3"]).toBe("ready");
  });

  it("shares one fetch between concurrent calls for the same key", async () => {
    const { loader, calls } = fakeLoader();
    const store = createCatalogStore(loader);
    await Promise.all([store.getState().ensureServices(["s3"]), store.getState().ensureServices(["s3"])]);
    expect(svcCalls(calls)).toHaveLength(1);
    expect(calls.filter((c) => c.endsWith("index.json"))).toHaveLength(1);
  });

  it("retry while a load is in flight awaits it without refetching", async () => {
    const { loader, calls } = fakeLoader();
    const store = createCatalogStore(loader);
    const first = store.getState().ensureServices(["s3"]);
    const second = store.getState().retry("s3");
    await Promise.all([first, second]);
    expect(store.getState().status["s3"]).toBe("ready");
    expect(svcCalls(calls)).toHaveLength(1);
  });

  it("does not refetch ready services", async () => {
    const { loader, calls } = fakeLoader();
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["s3"]);
    await store.getState().ensureServices(["s3"]);
    expect(svcCalls(calls)).toHaveLength(1);
  });

  it("does not auto-retry errored keys in ensureServices", async () => {
    const { loader, calls } = fakeLoader({ failOnce: ["s3"] });
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["s3"]);
    await store.getState().ensureServices(["s3"]);
    expect(store.getState().status["s3"]).toBe("error");
    expect(svcCalls(calls)).toHaveLength(1);
  });

  it("an index failure marks requested keys as error, and retry recovers", async () => {
    const { loader } = fakeLoader({ failIndexOnce: true });
    const store = createCatalogStore(loader);
    await store.getState().ensureServices(["s3"]);
    expect(store.getState().indexStatus).toBe("error");
    expect(store.getState().status["s3"]).toBe("error");
    await store.getState().retry("s3");
    expect(store.getState().indexStatus).toBe("ready");
    expect(store.getState().status["s3"]).toBe("ready");
  });

  it("reports loading while a request is in flight", async () => {
    const { loader } = fakeLoader();
    const store = createCatalogStore(loader);
    const p = store.getState().ensureServices(["s3"]);
    expect(store.getState().indexStatus).toBe("loading");
    expect(store.getState().status["s3"]).toBe("loading");
    await p;
  });
});

describe("useCatalogStore", () => {
  it("fetches /data over fetch and treats non-2xx as an error", async () => {
    const f = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", f);
    try {
      const { useCatalogStore } = await import("./catalog");
      await useCatalogStore.getState().ensureIndex();
      expect(f).toHaveBeenCalledWith("/data/index.json");
      expect(useCatalogStore.getState().indexStatus).toBe("error");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
