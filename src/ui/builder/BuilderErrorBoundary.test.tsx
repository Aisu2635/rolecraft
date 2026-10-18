import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { BuilderErrorBoundary } from "./BuilderErrorBoundary";

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error("kaboom");
  return <p>all good</p>;
}

beforeEach(() => {
  shouldThrow = true;
  useBuilderStore.getState().reset();
});
afterEach(cleanup);

describe("BuilderErrorBoundary", () => {
  it("shows the fallback, and Reset clears state and hash and re-mounts children", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    history.replaceState(null, "", "/builder#abc");
    useBuilderStore.getState().setStep(2);
    render(
      <BuilderErrorBoundary>
        <Bomb />
      </BuilderErrorBoundary>,
    );
    expect(
      screen.getByText("Something went wrong in the builder."),
    ).toBeInTheDocument();
    expect(spy).toHaveBeenCalled();
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "Reset builder" }));
    expect(location.hash).toBe("");
    expect(location.pathname).toBe("/builder");
    expect(useBuilderStore.getState().step).toBe(0);
    expect(screen.getByText("all good")).toBeInTheDocument();
    spy.mockRestore();
  });
});
