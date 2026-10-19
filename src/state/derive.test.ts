import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createEmptyModel, type Grant } from "../core/model/model";
import type { SlimService } from "../core/types";
import type { CatalogState, LoadStatus } from "./catalog";
import { deriveOutput } from "./derive";

const s3 = JSON.parse(readFileSync("public/data/svc/s3.json", "utf8")) as SlimService;
const grant = (id: string, service: string): Grant => ({
  id,
  service,
  scope: { type: "all" },
  access: { type: "levels", levels: ["Read"] },
});
const withGrants = (...gs: Grant[]) => ({ ...createEmptyModel(), grants: gs });
type Cat = Pick<CatalogState, "index" | "services" | "status">;
const cat = (status: Record<string, LoadStatus>, ready = true): Cat => ({
  index: null,
  services: ready ? { s3 } : {},
  status,
});

describe("deriveOutput", () => {
  it("is loading with the pending keys", () => {
    expect(deriveOutput(withGrants(grant("a", "s3")), cat({ s3: "loading" }, false))).toEqual({
      kind: "loading",
      pending: ["s3"],
    });
  });
  it("treats a service with no status as pending", () => {
    expect(deriveOutput(withGrants(grant("a", "s3")), cat({}, false))).toEqual({ kind: "loading", pending: ["s3"] });
  });
  it("dedupes services used by several grants", () => {
    expect(deriveOutput(withGrants(grant("a", "s3"), grant("b", "s3")), cat({ s3: "loading" }, false))).toEqual({
      kind: "loading",
      pending: ["s3"],
    });
  });
  it("is error when a grant service failed (error wins over loading)", () => {
    const d = deriveOutput(withGrants(grant("a", "s3"), grant("b", "ec2")), cat({ s3: "error", ec2: "loading" }, false));
    expect(d).toEqual({ kind: "error", failed: ["s3"] });
  });
  it("is ready with missing services surfacing E_UNKNOWN_SERVICE", () => {
    const d = deriveOutput(
      withGrants(grant("a", "s3"), grant("g1", "gone-svc")),
      cat({ s3: "ready", "gone-svc": "missing" }),
    );
    expect(d.kind).toBe("ready");
    if (d.kind !== "ready") return;
    expect(d.missing).toEqual(["gone-svc"]);
    expect(d.input.result.issues.some((i) => i.id === "E_UNKNOWN_SERVICE" && i.grantId === "g1")).toBe(true);
    expect(d.input.model.grants).toHaveLength(2);
  });
  it("an empty model is ready with I_NO_PERMISSIONS", () => {
    const d = deriveOutput(createEmptyModel(), cat({}, false));
    expect(d.kind).toBe("ready");
    if (d.kind !== "ready") return;
    expect(d.input.result.issues.some((i) => i.id === "I_NO_PERMISSIONS")).toBe(true);
  });
});

describe("useDerived", () => {
  it("derives from the builder model and the injected catalog store", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { createCatalogStore, CatalogContext } = await import("./catalog");
    const { createLoader } = await import("../core/catalog/loader");
    const { useBuilderStore } = await import("./builder");
    const { useDerived } = await import("./derive");
    const store = createCatalogStore(
      createLoader(async (p) => JSON.parse(readFileSync(`public${p}`, "utf8"))),
    );
    useBuilderStore.getState().reset();
    useBuilderStore.getState().addGrant(grant("a", "s3"));
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CatalogContext.Provider, { value: store }, children);
    const { result } = renderHook(() => useDerived(), { wrapper });
    expect(result.current.kind).toBe("loading");
    await act(async () => {
      await store.getState().ensureServices(["s3"]);
    });
    expect(result.current.kind).toBe("ready");
    useBuilderStore.getState().reset();
  });
});

describe("useDerivedOutput", () => {
  it("reads the one derived output that DerivedProvider computes, and follows the model", async () => {
    const { renderHook, act } = await import("@testing-library/react");
    const { createElement } = await import("react");
    const { createCatalogStore, CatalogContext } = await import("./catalog");
    const { createLoader } = await import("../core/catalog/loader");
    const { useBuilderStore } = await import("./builder");
    const { DerivedProvider, useDerivedOutput } = await import("./derive");
    const store = createCatalogStore(createLoader(async (p) => JSON.parse(readFileSync(`public${p}`, "utf8"))));
    await store.getState().ensureServices(["s3"]);
    useBuilderStore.getState().reset();
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      createElement(CatalogContext.Provider, { value: store }, createElement(DerivedProvider, null, children));
    const { result } = renderHook(() => [useDerivedOutput(), useDerivedOutput()] as const, { wrapper });
    expect(result.current[0]).toBe(result.current[1]);
    expect(result.current[0].kind === "ready" && result.current[0].input.model.grants).toEqual([]);
    act(() => useBuilderStore.getState().addGrant(grant("a", "s3")));
    expect(result.current[0].kind === "ready" && result.current[0].input.model.grants).toHaveLength(1);
    useBuilderStore.getState().reset();
  });

  it("fails loudly outside DerivedProvider", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useDerivedOutput } = await import("./derive");
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useDerivedOutput())).toThrow("useDerivedOutput must be used inside DerivedProvider");
    vi.restoreAllMocks();
  });
});
