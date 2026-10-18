import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { BuilderWorkspace } from "./BuilderWorkspace";

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

function ui() {
  return render(
    <BuilderWorkspace
      sidebar={<p>side</p>}
      steps={[
        <p key="0">step-trust</p>,
        <p key="1">step-perm</p>,
        <p key="2">step-review</p>,
      ]}
      output={<p>out</p>}
    />,
  );
}

describe("BuilderWorkspace", () => {
  it("shows step labels, marks the current one and renders only its content", () => {
    ui();
    expect(
      screen.getByRole("button", { name: /Trusted entity/ }),
    ).toHaveAttribute("aria-current", "step");
    expect(
      screen.getByRole("button", { name: /Permissions/ }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("button", { name: /Review and export/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("step-trust")).toBeInTheDocument();
    expect(screen.queryByText("step-perm")).toBeNull();
    expect(screen.getByText("side")).toBeInTheDocument();
    expect(screen.getByText("out")).toBeInTheDocument();
  });
  it("clicking a step button sets the store step", () => {
    ui();
    fireEvent.click(screen.getByRole("button", { name: /Review and export/ }));
    expect(useBuilderStore.getState().step).toBe(2);
    expect(screen.getByText("step-review")).toBeInTheDocument();
  });
  it("Previous is hidden on step 0 and Next on step 2; both navigate", () => {
    ui();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(useBuilderStore.getState().step).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(useBuilderStore.getState().step).toBe(1);
  });
});
