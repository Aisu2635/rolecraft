import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CodeView } from "./CodeView";

afterEach(cleanup);

describe("CodeView", () => {
  it("renders the text verbatim in a focusable, labelled monospace block", () => {
    render(<CodeView text={'{\n  "a": 1\n}\n'} language="json" label="Policy JSON" />);
    const pre = screen.getByLabelText("Policy JSON");
    expect(pre.tagName).toBe("PRE");
    expect(pre).toHaveAttribute("tabindex", "0");
    expect(pre.textContent).toBe('{\n  "a": 1\n}\n');
    expect(pre).toHaveAttribute("data-language", "json");
  });
});

describe("CodeView landmark", () => {
  it("is a region named by its label", () => {
    render(<CodeView text="x" language="json" label="Policy JSON" />);
    expect(screen.getByRole("region", { name: "Policy JSON" }).tagName).toBe("PRE");
  });
});
