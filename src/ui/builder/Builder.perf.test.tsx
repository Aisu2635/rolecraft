import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moduleGrant } from "../../core/export/__fixtures__/cases";
import { explain } from "../../core/explain/explain";
import { generate } from "../../core/generate";
import { useBuilderStore } from "../../state/builder";
import { CatalogContext } from "../../state/catalog";
import { Builder } from "./Builder";
import { grantFor, readyCatalog } from "./permissions/test-catalog";

// Wraps the real functions, so the panels show real output while the test counts the calls.
vi.mock("../../core/generate", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../core/generate")>();
  return { ...m, generate: vi.fn(m.generate) };
});
vi.mock("../../core/explain/explain", async (importOriginal) => {
  const m = await importOriginal<typeof import("../../core/explain/explain")>();
  return { ...m, explain: vi.fn(m.explain) };
});
// Counts renders of each Button by its text, so a test can tell which sidebar lists re-rendered.
const renders = new Map<string, number>();
vi.mock("@cloudscape-design/components/button", async (importOriginal) => {
  const m = await importOriginal<typeof import("@cloudscape-design/components/button")>();
  const Real = m.default;
  const Counted = Object.assign(
    (props: Parameters<typeof Real>[0]) => {
      if (typeof props.children === "string") renders.set(props.children, (renders.get(props.children) ?? 0) + 1);
      return <Real {...props} />;
    },
    { displayName: "CountedButton" },
  );
  return { ...m, default: Counted };
});

beforeEach(() => {
  // The builder writes the role into the link; start each test from a clean one.
  window.history.replaceState(null, "", "/");
  useBuilderStore.getState().reset();
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The Builder provides the derived output itself, so only the catalog comes from the test.
const renderBuilder = (cat: Awaited<ReturnType<typeof readyCatalog>>) =>
  render(
    <CatalogContext.Provider value={cat}>
      <Builder />
    </CatalogContext.Provider>,
  );

async function s3OnStep1() {
  const cat = await readyCatalog("s3");
  act(() => {
    const s = useBuilderStore.getState();
    s.setFields({ name: "reader" });
    s.addGrant(moduleGrant("g1", "s3", "list-read", { bucket: "", prefixes: [""] }));
    s.setStep(1);
  });
  renderBuilder(cat);
  await screen.findByText("Popular");
  return screen.getByLabelText("Bucket");
}

describe("Builder per-keystroke work", () => {
  it("one edit on step 1 runs generate and explain once each", async () => {
    const bucket = await s3OnStep1();
    vi.mocked(generate).mockClear();
    vi.mocked(explain).mockClear();
    fireEvent.change(bucket, { target: { value: "d" } });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledTimes(1);
  });

  it("the output panel's policy follows every keystroke", async () => {
    const bucket = await s3OnStep1();
    const seen: string[] = [];
    for (const value of ["abc", "abcd", "abcde", "abcdef"]) {
      fireEvent.change(bucket, { target: { value } });
      const policy = screen.getByLabelText("Policy JSON").textContent!;
      expect(policy).toContain(`arn:aws:s3:::${value}`);
      seen.push(policy);
    }
    expect(new Set(seen).size).toBe(4);
  });

  it("an edit to a grant field doesn't re-render the sidebar's service lists", async () => {
    const bucket = await s3OnStep1();
    renders.clear();
    fireEvent.change(bucket, { target: { value: "d" } });
    // AWS Lambda is in Popular only; Amazon S3 is in this role and in Popular.
    expect(renders.get("AWS Lambda") ?? 0).toBe(0);
    expect(renders.get("Amazon S3") ?? 0).toBe(0);
  });

  it("typing in the sidebar search doesn't re-render the In this role list", async () => {
    const cat = await readyCatalog("textract");
    act(() => useBuilderStore.getState().addGrant(grantFor(cat, "textract", "tx1")));
    renderBuilder(cat);
    await screen.findByText("In this role");
    renders.clear();
    fireEvent.change(screen.getByLabelText("Search services"), { target: { value: "z" } });
    // Amazon Textract is listed only in this role (not Popular), and "z" doesn't match it.
    expect(renders.get("Amazon Textract") ?? 0).toBe(0);
    expect(renders.get("AWS Lambda") ?? 0).toBe(0);
  });
});
