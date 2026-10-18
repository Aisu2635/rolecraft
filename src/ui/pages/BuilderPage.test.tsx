import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { BuilderPage } from "./BuilderPage";

function stubWidth(desktop: boolean) {
  vi.stubGlobal("matchMedia", () => ({
    matches: desktop,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => useBuilderStore.getState().reset());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BuilderPage", () => {
  it("shows the three steps on desktop widths", () => {
    stubWidth(true);
    render(<BuilderPage />);
    expect(
      screen.getByRole("button", { name: /Trusted entity/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Permissions/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Review and export/ }),
    ).toBeInTheDocument();
  });
  it("shows the desktop-only card below 1024px", () => {
    stubWidth(false);
    render(<BuilderPage />);
    expect(
      screen.getByRole("heading", {
        name: "Works best on a laptop or desktop",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Trusted entity/ })).toBeNull();
  });
});
