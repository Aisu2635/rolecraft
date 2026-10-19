import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Scope } from "../../../core/model/model";
import { Ec2ScopeEditor } from "./Ec2ScopeEditor";
import { ScopeHarness } from "./harness";

afterEach(cleanup);
const data = (s: Scope | undefined) => (s as { data: Record<string, unknown> }).data;

function setup(initial: unknown) {
  const seen: Scope[] = [];
  render(
    <ScopeHarness
      initial={{ type: "module", data: initial }}
      seen={seen}
      render={(scope, onChange, issues) => (
        <Ec2ScopeEditor data={(scope as { data: unknown }).data} issues={issues} onChange={onChange} />
      )}
    />,
  );
  return seen;
}

describe("Ec2ScopeEditor", () => {
  it("edits the tag selector", () => {
    const seen = setup({ selector: { type: "tag", key: "", value: "" } });
    fireEvent.change(screen.getByLabelText("Tag key"), { target: { value: "Env" } });
    fireEvent.change(screen.getByLabelText("Tag value"), { target: { value: "dev" } });
    expect(data(seen.at(-1))).toEqual({ selector: { type: "tag", key: "Env", value: "dev" } });
  });

  it("switching selector keeps a valid shape at each step", () => {
    const seen = setup({ selector: { type: "tag", key: "Env", value: "dev" } });
    fireEvent.click(screen.getByLabelText("Specific instance IDs"));
    expect(data(seen.at(-1))).toEqual({ selector: { type: "ids", ids: [""] } });
    fireEvent.change(screen.getByLabelText("Instance ID 1"), { target: { value: "i-0123456789abcdef0" } });
    fireEvent.click(screen.getByRole("button", { name: "Add instance ID" }));
    expect(data(seen.at(-1))).toEqual({ selector: { type: "ids", ids: ["i-0123456789abcdef0", ""] } });
    fireEvent.click(screen.getByRole("button", { name: "Remove instance ID 2" }));
    expect(screen.getByRole("button", { name: "Remove instance ID 1" })).toBeDisabled();
    fireEvent.click(screen.getByLabelText("All instances"));
    expect(data(seen.at(-1))).toEqual({ selector: { type: "all" } });
    fireEvent.click(screen.getByLabelText("Instances with tag"));
    expect(data(seen.at(-1))).toEqual({ selector: { type: "tag", key: "", value: "" } });
  });

  it("tolerates data that is not shaped like EC2 data", () => {
    setup(undefined);
    expect(screen.getByLabelText("Tag key")).toHaveValue("");
  });
});
