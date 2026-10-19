import { cleanup, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLoader } from "../core/catalog/loader";
import { createEmptyModel } from "../core/model/model";
import { useBuilderStore } from "./builder";
import { CatalogContext, createCatalogStore } from "./catalog";
import { useEnsureCatalog } from "./useEnsureCatalog";

const read = (p: string): unknown =>
  JSON.parse(readFileSync(resolve("public", p.replace(/^\//, "")), "utf8"));

function setup() {
  const calls: string[] = [];
  const store = createCatalogStore(
    createLoader(async (p) => {
      calls.push(p);
      return read(p);
    }),
  );
  function Probe() {
    useEnsureCatalog();
    return null;
  }
  const ui = (
    <CatalogContext.Provider value={store}>
      <Probe />
    </CatalogContext.Provider>
  );
  return { calls, store, ui };
}

const grant = (id: string, service: string) => ({
  id,
  service,
  scope: { type: "all" as const },
  access: { type: "levels" as const, levels: ["Read" as const] },
});

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

describe("useEnsureCatalog", () => {
  it("loads the index and the services of restored grants", async () => {
    const { store, ui } = setup();
    useBuilderStore
      .getState()
      .replaceModel({ ...createEmptyModel(), grants: [grant("a", "s3")] });
    render(ui);
    await waitFor(() => expect(store.getState().status["s3"]).toBe("ready"));
    expect(store.getState().indexStatus).toBe("ready");
  });
  it("loads services for grants added later, without refetching", async () => {
    const { store, calls, ui } = setup();
    render(ui);
    await waitFor(() => expect(store.getState().indexStatus).toBe("ready"));
    useBuilderStore.getState().addGrant(grant("a", "s3"));
    await waitFor(() => expect(store.getState().status["s3"]).toBe("ready"));
    useBuilderStore.getState().addGrant(grant("b", "s3"));
    expect(calls.filter((c) => c.endsWith("/s3.json"))).toHaveLength(1);
  });
});
