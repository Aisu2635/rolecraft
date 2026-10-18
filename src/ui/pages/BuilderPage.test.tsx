import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyModel } from "../../core/model/model";
import { encodeModel } from "../../core/model/share";
import { useBuilderStore } from "../../state/builder";
import { BuilderPage } from "./BuilderPage";

const INVALID =
  "This share link couldn't be opened. It may be incomplete or from a newer version of RoleCraft. Starting with an empty role.";
const sharedModel = () => ({
  ...createEmptyModel(),
  name: "shared-role",
  grants: [{ id: "g_aaaaaaaa", service: "s3", scope: { type: "all" as const }, access: { type: "levels" as const, levels: ["Read" as const] } }],
});

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
  it("offers Export and the CLI, Terraform and CloudFormation tabs", () => {
    stubWidth(true);
    render(<BuilderPage />);
    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
    for (const name of ["CLI", "Terraform", "CloudFormation"]) {
      expect(screen.getByRole("tab", { name })).toBeInTheDocument();
    }
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

describe("BuilderPage export modal", () => {
  it("Jump to from the blocked modal ends with focus on the field, not the Export button", async () => {
    stubWidth(true);
    act(() => {
      useBuilderStore.getState().setTrust({ kind: "github", owner: "", repo: "r", ref: { type: "branch", value: "main" } });
      useBuilderStore.getState().setStep(2);
    });
    render(<BuilderPage />);
    const exportButton = screen.getByRole("button", { name: "Export" });
    exportButton.focus();
    fireEvent.click(exportButton);
    await screen.findByText("Export is blocked");
    const dialog = screen.getByText("Export is blocked").closest<HTMLElement>("[role=dialog]")!;
    const jump = within(dialog)
      .getAllByRole("button", { name: /^Jump to/ })
      .find((b) => /owner/i.test(b.getAttribute("aria-label") ?? ""));
    fireEvent.click(jump!);
    await waitFor(() => expect(useBuilderStore.getState().step).toBe(0));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("GitHub owner")));
  });
});

describe("BuilderPage share link", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("restores a shared role and opens the Permissions step", async () => {
    stubWidth(true);
    window.history.replaceState(null, "", "/#s=" + encodeModel(sharedModel()));
    render(<BuilderPage />);
    await waitFor(() => expect(useBuilderStore.getState().model.name).toBe("shared-role"));
    expect(useBuilderStore.getState().step).toBe(1);
    expect(screen.queryByText(INVALID)).toBeNull();
  });
  it("warns, dismissibly, when the link is invalid, and starts empty", async () => {
    stubWidth(true);
    window.history.replaceState(null, "", "/#s=garbage");
    render(<BuilderPage />);
    expect(await screen.findByText(INVALID)).toBeInTheDocument();
    expect(useBuilderStore.getState().model.name).toBe("rolecraft-role");
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText(INVALID)).toBeNull());
  });
  it("offers Share beside Copy", () => {
    stubWidth(true);
    render(<BuilderPage />);
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
  });
});
