import { cleanup, renderHook, waitFor } from "@testing-library/react";
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
