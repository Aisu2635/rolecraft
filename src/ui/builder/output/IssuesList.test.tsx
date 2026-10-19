import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Issue } from "../../../core/types";
import { useBuilderStore } from "../../../state/builder";
import { IssuesList } from "./IssuesList";

const issues: Issue[] = [
  { id: "E1", severity: "error", message: "Owner is bad", path: "trust.owner" },
  { id: "W1", severity: "warning", message: "Wide access", grantId: "g1" },
  { id: "I1", severity: "info", message: "Just so you know" },
];

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

describe("IssuesList", () => {
  it("lists every issue, with Jump to only where there is a place to go", () => {
    render(<IssuesList issues={issues} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Jump to/ })).toHaveLength(2);
  });

  it("can be limited to some severities", () => {
    render(<IssuesList issues={issues} severities={["error"]} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText("Wide access")).toBeNull();
  });

  it("says when there are no issues", () => {
    render(<IssuesList issues={[]} />);
    expect(screen.getByText("No issues.")).toBeInTheDocument();
  });

  it("Jump to opens the step, focuses the target and reveals errors", () => {
    useBuilderStore.getState().setStep(2);
    render(<IssuesList issues={issues} />);
    fireEvent.click(screen.getByRole("button", { name: /Owner is bad/ }));
    const st = useBuilderStore.getState();
    expect([st.step, st.focusTarget, st.revealErrors]).toEqual([0, "field:trust.owner", true]);
    fireEvent.click(screen.getByRole("button", { name: /Wide access/ }));
    expect([useBuilderStore.getState().step, useBuilderStore.getState().focusTarget]).toEqual([1, "grant:g1"]);
  });

  it("a Jump to a grant from the Grid switches the editor to Sentences, where the grant's fields are", () => {
    useBuilderStore.getState().setEditor("grid");
    render(<IssuesList issues={issues} />);
    fireEvent.click(screen.getByRole("button", { name: /Owner is bad/ }));
    expect(useBuilderStore.getState().editor).toBe("grid");
    fireEvent.click(screen.getByRole("button", { name: /Wide access/ }));
    const st = useBuilderStore.getState();
    expect([st.step, st.editor, st.focusTarget]).toEqual([1, "sentences", "grant:g1"]);
  });
});

describe("IssuesList onJump", () => {
  it("calls onJump first and navigates after it", async () => {
    const order: string[] = [];
    const unsub = useBuilderStore.subscribe(() => order.push("store"));
    render(
      <IssuesList
        issues={[{ id: "E_X", severity: "error", message: "bad", grantId: "g1" } as never]}
        onJump={() => order.push("jump")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Jump to: bad" }));
    expect(order).toEqual(["jump"]);
    await waitFor(() => expect(useBuilderStore.getState().step).toBe(1));
    unsub();
    expect(order[0]).toBe("jump");
  });
});
