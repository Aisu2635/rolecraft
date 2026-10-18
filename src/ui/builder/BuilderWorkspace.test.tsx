import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { BuilderWorkspace } from "./BuilderWorkspace";

// Vitest serves CSS imports empty, so the stylesheet is read from disk.
const css = readFileSync(resolve(process.cwd(), "src/ui/global.css"), "utf8");

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

  // jsdom has no layout; the real-browser check is tests/e2e/layout.spec.ts. The top nav is 57 px (56 + a 1 px
  // border), so a hard-coded "100vh - 56px" made the page itself scroll by a pixel beside the column scrollbars.
  it("sizes the workspace from the space left under the top nav, not from an assumed nav height", () => {
    /** The declarations of the first rule whose selector is exactly `selector`. */
    const rule = (selector: string): string => {
      const start = css.indexOf(selector + " {");
      return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
    };
    expect(css).not.toMatch(/100vh\s*-\s*\d+px/);
    expect(rule("#root:has(.rc-ws)")).toMatch(/display: flex/);
    expect(rule("#root:has(.rc-ws)")).toMatch(/height: 100vh/);
    expect(rule(".rc-ws")).toMatch(/flex: 1 1 0/);
  });
});
