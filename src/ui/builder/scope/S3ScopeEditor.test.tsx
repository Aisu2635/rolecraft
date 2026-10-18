import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Scope } from "../../../core/model/model";
import type { Issue } from "../../../core/types";
import { S3ScopeEditor } from "./S3ScopeEditor";
import { ScopeHarness } from "./harness";

afterEach(cleanup);
const data = (s: Scope | undefined) => (s as { data: Record<string, unknown> }).data;

function setup(initial: unknown, issues: Issue[] = []) {
  const seen: Scope[] = [];
  render(
    <ScopeHarness
      initial={{ type: "module", data: initial }}
      seen={seen}
      issues={issues}
      render={(scope, onChange, i) => (
        <S3ScopeEditor data={(scope as { data: unknown }).data} issues={i} onChange={onChange} />
      )}
    />,
  );
  return seen;
}

describe("S3ScopeEditor", () => {
  it("describes prefixes and always writes allowNavigation", () => {
    const seen = setup({ bucket: "", prefixes: [""] });
    expect(screen.getByText(/Leave empty for the whole bucket\./)).toHaveTextContent(
      "Leave empty for the whole bucket. ${aws:username} is allowed.",
    );
    fireEvent.change(screen.getByLabelText("Bucket"), { target: { value: "data-lake" } });
    expect(data(seen.at(-1))).toEqual({ bucket: "data-lake", prefixes: [""], allowNavigation: false });
  });

  it("keeps an empty prefix as the whole bucket", () => {
    const seen = setup({ bucket: "b-ucket", prefixes: ["a/"] });
    fireEvent.change(screen.getByLabelText("Prefix 1"), { target: { value: "" } });
    expect(data(seen.at(-1))?.prefixes).toEqual([""]);
  });

  it("adds and removes prefixes, never removing the last one", () => {
    const seen = setup({ bucket: "b-ucket", prefixes: ["a/"] });
    expect(screen.getByRole("button", { name: "Remove prefix 1" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Add prefix" }));
    expect(data(seen.at(-1))?.prefixes).toEqual(["a/", ""]);
    fireEvent.change(screen.getByLabelText("Prefix 2"), { target: { value: "b/" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove prefix 1" }));
    expect(data(seen.at(-1))?.prefixes).toEqual(["b/"]);
    expect(screen.getByRole("button", { name: "Remove prefix 1" })).toBeDisabled();
  });

  it("toggles navigation", () => {
    const seen = setup({ bucket: "b-ucket", prefixes: ["a/"], allowNavigation: false });
    fireEvent.click(screen.getByLabelText("Allow navigating to the folder"));
    expect(data(seen.at(-1))?.allowNavigation).toBe(true);
  });

  it("shows a field error after blur, from the issue at its path", () => {
    setup({ bucket: "Bad", prefixes: [""] }, [
      { id: "E_MODULE_DATA", severity: "error", message: "bad bucket", path: "data.bucket", grantId: "g1" },
    ]);
    expect(screen.queryByText("bad bucket")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Bucket"));
    expect(screen.getByText("bad bucket")).toBeInTheDocument();
  });

  it("tolerates data that is not shaped like S3 data", () => {
    setup(undefined);
    expect(screen.getByLabelText("Bucket")).toHaveValue("");
  });
});
