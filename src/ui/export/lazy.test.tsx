import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Exporters } from "./lazy";

type Lazy = typeof import("./lazy");
let lazy: Lazy;
const fake = { exportAll: vi.fn() } as unknown as Exporters;

beforeEach(async () => {
  vi.resetModules();
  lazy = await import("./lazy");
});
afterEach(cleanup);

describe("loadExporters", () => {
  it("clears the memo on a rejection, then memoizes the module", async () => {
    const importer = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(fake);
    await expect(lazy.loadExporters(importer)).rejects.toThrow("offline");
    await expect(lazy.loadExporters(importer)).resolves.toBe(fake);
    expect(importer).toHaveBeenCalledTimes(2);
    await expect(lazy.loadExporters(importer)).resolves.toBe(fake);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight load", async () => {
    const importer = vi.fn().mockResolvedValue(fake);
    await Promise.all([lazy.loadExporters(importer), lazy.loadExporters(importer)]);
    expect(importer).toHaveBeenCalledTimes(1);
  });

  it("loads the real exporters module by default", async () => {
    const mod = await lazy.loadExporters();
    expect(typeof mod.exportAll).toBe("function");
    expect(typeof mod.exportZip).toBe("function");
    expect(typeof mod.applySections).toBe("function");
  });
});

describe("useExporters", () => {
  it("stays idle until enabled, then loads", async () => {
    const { result, rerender } = renderHook(({ on }) => lazy.useExporters(on), { initialProps: { on: false } });
    expect(result.current.status).toBe("idle");
    rerender({ on: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(typeof result.current.mod?.exportAll).toBe("function");
  });
});

describe("useExporters after a redeploy", () => {
  it("a first failure is retryable; a second failure in a row marks the app stale", async () => {
    lazy.resetExportersForTests(() => Promise.reject(new Error("MIME type")));
    const { result } = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.stale).toBe(false);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.status).toBe("error");
  });

  it("a success resets the count of failures in a row", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(fake)
      .mockRejectedValue(new Error("never"));
    lazy.resetExportersForTests(importer);
    const { result } = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.stale).toBe(false);
  });

  it("Vite's preloadError event marks the app stale and is handled (preventDefault)", async () => {
    lazy.resetExportersForTests(() => new Promise<Exporters>(() => {}));
    const { result } = renderHook(() => lazy.useExporters(true));
    const e = new Event("vite:preloadError", { cancelable: true });
    act(() => {
      window.dispatchEvent(e);
    });
    expect(e.defaultPrevented).toBe(true);
    expect(result.current.stale).toBe(true);
  });

  it("a load that resolves to nothing (a handled preload error) is a failure, not ready", async () => {
    lazy.resetExportersForTests(() => Promise.resolve(undefined as unknown as Exporters));
    const { result } = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.mod).toBeUndefined();
  });

  it("failures add up across callers: one in the modal, then one in a tab, and both show Reload", async () => {
    lazy.resetExportersForTests(() => Promise.reject(new Error("MIME type")));
    const modal = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(modal.result.current.status).toBe("error"));
    expect(lazy.redeployState()).toEqual({ failures: 1, stale: false });
    const tab = renderHook(({ on }) => lazy.useExporters(on), { initialProps: { on: false } });
    expect(tab.result.current.stale).toBe(false);
    tab.rerender({ on: true });
    await waitFor(() => expect(tab.result.current.status).toBe("error"));
    expect(lazy.redeployState()).toEqual({ failures: 2, stale: true });
    expect(tab.result.current.stale).toBe(true);
    expect(modal.result.current.stale).toBe(true);
  });

  it("one failed load shared by two callers counts once", async () => {
    lazy.resetExportersForTests(() => Promise.reject(new Error("offline")));
    const a = renderHook(() => lazy.useExporters(true));
    const b = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(a.result.current.status).toBe("error"));
    await waitFor(() => expect(b.result.current.status).toBe("error"));
    expect(lazy.redeployState()).toEqual({ failures: 1, stale: false });
  });

  it("a success anywhere resets the shared count", async () => {
    const importer = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(fake)
      .mockRejectedValue(new Error("never"));
    lazy.resetExportersForTests(importer);
    const modal = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(modal.result.current.status).toBe("error"));
    const tab = renderHook(() => lazy.useExporters(true));
    await waitFor(() => expect(tab.result.current.status).toBe("ready"));
    expect(lazy.redeployState()).toEqual({ failures: 0, stale: false });
    expect(modal.result.current.stale).toBe(false);
  });
});
