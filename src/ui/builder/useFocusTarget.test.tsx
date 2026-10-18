import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { useFocusTarget } from "./useFocusTarget";

function Probe(props: { id: string; onFocus?: () => void }) {
  const ref = useFocusTarget<HTMLDivElement>(props.id, props.onFocus);
  return (
    <div ref={ref}>
      <span>label</span>
      <input aria-label="first" />
      <input aria-label="second" />
    </div>
  );
}

beforeEach(() => useBuilderStore.getState().reset());
afterEach(cleanup);

describe("useFocusTarget", () => {
  it("focuses the first focusable, scrolls it into view and clears the target", () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const onFocus = vi.fn();
    render(<Probe id="field:x" onFocus={onFocus} />);
    expect(screen.getByLabelText("first")).not.toHaveFocus();
    act(() => useBuilderStore.getState().focus("field:x"));
    expect(screen.getByLabelText("first")).toHaveFocus();
    expect(scroll).toHaveBeenCalled();
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(useBuilderStore.getState().focusTarget).toBeNull();
  });

  it("acts on a target that was set before mounting", () => {
    useBuilderStore.getState().focus("field:x");
    render(<Probe id="field:x" />);
    expect(screen.getByLabelText("first")).toHaveFocus();
    expect(useBuilderStore.getState().focusTarget).toBeNull();
  });

  it("ignores other targets", () => {
    render(<Probe id="field:x" />);
    act(() => useBuilderStore.getState().focus("field:y"));
    expect(screen.getByLabelText("first")).not.toHaveFocus();
    expect(useBuilderStore.getState().focusTarget).toBe("field:y");
  });
});
