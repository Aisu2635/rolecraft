import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LandingPage } from "./LandingPage";

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LandingPage", () => {
  it("renders headline, CTAs and disclaimer; falls back when fetch fails", async () => {
    const f = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", f);
    renderLanding();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Least-privilege AWS roles");
    expect(screen.getByRole("link", { name: "Browse templates" })).toHaveAttribute("href", "/templates");
    expect(screen.getByRole("link", { name: "Start from scratch" })).toHaveAttribute("href", "/builder");
    expect(screen.getByText("Not affiliated with Amazon Web Services")).toBeInTheDocument();
    expect(screen.getByText("450+ services")).toBeInTheDocument();
    await waitFor(() => expect(f).toHaveBeenCalled());
  });

  it("reads service count and date from index.json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ generatedAt: "2026-10-16", services: [1, 2, 3] }),
      }),
    );
    renderLanding();
    expect(await screen.findByText("3 services")).toBeInTheDocument();
    expect(screen.getByText("AWS data updated 2026-10-16")).toBeInTheDocument();
  });

  it("falls back when the response is not ok", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", f);
    renderLanding();
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.getByText("450+ services")).toBeInTheDocument();
  });
});
