import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moduleGrant } from "../../core/export/__fixtures__/cases";
import { useBuilderStore } from "../../state/builder";
import { grantFor, readyCatalog, withCatalog } from "../builder/permissions/test-catalog";
import { BuilderPage } from "./BuilderPage";

// Its own file: React reports each missing-key warning once per module instance, so an earlier test that rendered
// the same component would hide it.
beforeEach(() => {
  useBuilderStore.getState().reset();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BuilderPage in development", () => {
  it("renders grants and the issues list without a React warning such as a missing key", async () => {
    const error = vi.spyOn(console, "error");
    const cat = await readyCatalog("s3", "textract", "ec2");
    const s = useBuilderStore.getState();
    act(() => {
      s.addGrant(moduleGrant("s3a", "s3", "list-read", { bucket: "", prefixes: ["reports/", ""] }));
      s.addGrant(grantFor(cat, "textract", "tx1"));
      s.addGrant(moduleGrant("ec2a", "ec2", "tags", { selector: { type: "tag", key: "", value: "" } }));
      s.revealAllErrors();
      s.setStep(1);
    });
    render(withCatalog(cat, <BuilderPage />));
    expect(await screen.findAllByRole("button", { name: /^Jump to/ })).not.toHaveLength(0);
    for (const editor of ["grid", "sentences"] as const) act(() => useBuilderStore.getState().setEditor(editor));
    for (const step of [0, 2, 1] as const) act(() => useBuilderStore.getState().setStep(step));
    expect(error).not.toHaveBeenCalled();
  });
});
