import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Scope } from "../../../core/model/model";
import { s3Module } from "../../../core/engine/modules/s3";
import { runModule } from "../../../core/engine/modules/types";
import type { Grant } from "../../../core/model/model";
import type { Issue, SlimService } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
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

  it("Add prefix on a lone empty row focuses that row instead of adding a second empty one", () => {
    const seen = setup({ bucket: "b-ucket", prefixes: [""] });
    expect(screen.getByLabelText("Prefix 1")).toHaveAttribute("placeholder", "Folder, e.g. reports/");
    fireEvent.click(screen.getByRole("button", { name: "Add prefix" }));
    expect(seen).toEqual([]);
    expect(screen.getAllByLabelText(/^Prefix \d$/)).toHaveLength(1);
    expect(screen.getByLabelText("Prefix 1")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Prefix 1"), { target: { value: "reports/" } });
    expect(data(seen.at(-1))?.prefixes).toEqual(["reports/"]);
  });

  it("Add prefix appends a row after filled rows", () => {
    const seen = setup({ bucket: "b-ucket", prefixes: ["a/", "b/"] });
    fireEvent.click(screen.getByRole("button", { name: "Add prefix" }));
    expect(data(seen.at(-1))?.prefixes).toEqual(["a/", "b/", ""]);
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

  it("shows errors without a blur once every error is revealed, and hides them again after reset", () => {
    const issues: Issue[] = [
      { id: "E_MODULE_DATA", severity: "error", message: "bad bucket", path: "data.bucket", grantId: "g1" },
      { id: "E_MODULE_DATA", severity: "error", message: "bad prefix", path: "data.prefixes[0]", grantId: "g1" },
    ];
    act(() => useBuilderStore.getState().revealAllErrors());
    const { unmount } = render(
      <S3ScopeEditor data={{ bucket: "Bad", prefixes: ["x"] }} issues={issues} onChange={() => {}} />,
    );
    expect(screen.getByText("bad bucket")).toBeInTheDocument();
    expect(screen.getByText("bad prefix")).toBeInTheDocument();
    unmount();
    act(() => useBuilderStore.getState().reset());
    render(<S3ScopeEditor data={{ bucket: "Bad", prefixes: ["x"] }} issues={issues} onChange={() => {}} />);
    expect(screen.queryByText("bad bucket")).toBeNull();
    expect(screen.queryByText("bad prefix")).toBeNull();
  });

  it("shows the empty-folder error on the blank second row after reveal", () => {
    const data = { bucket: "data-lake", prefixes: ["reports/", ""] };
    const grant: Grant = {
      id: "g1",
      service: "s3",
      module: "s3",
      scope: { type: "module", data },
      access: { type: "preset", preset: "list-read" },
    };
    const { issues } = runModule(s3Module, grant, { key: "s3" } as unknown as SlimService, { partition: "aws" });
    act(() => useBuilderStore.getState().revealAllErrors());
    render(<S3ScopeEditor data={data} issues={issues} onChange={() => {}} />);
    expect(screen.getByLabelText("Prefix 2")).toHaveAccessibleDescription(/Folder 2 is empty\. Fill it in or remove it\./);
    expect(screen.getByLabelText("Prefix 1")).not.toHaveAccessibleDescription(/is empty/);
    act(() => useBuilderStore.getState().reset());
  });

  it("tolerates data that is not shaped like S3 data", () => {
    setup(undefined);
    expect(screen.getByLabelText("Bucket")).toHaveValue("");
  });
});
