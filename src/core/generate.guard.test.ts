import { describe, expect, it, vi } from "vitest";
import { createCatalog } from "./catalog/catalog";
import { generate } from "./generate";
import { createEmptyModel } from "./model/model";

vi.mock("./trust/trust", () => ({
  buildTrust: () => {
    throw new Error("boom");
  },
}));

describe("generate trust guard", () => {
  it("turns a throwing trust builder into E_INTERNAL", () => {
    let r: ReturnType<typeof generate> | undefined;
    expect(() => {
      r = generate(createEmptyModel(), createCatalog([]));
    }).not.toThrow();
    expect(r?.trust).toBeNull();
    expect(r?.issues.find((i) => i.id === "E_INTERNAL")?.severity).toBe("error");
  });
});
