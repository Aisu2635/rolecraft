import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
        json: () => Promise.resolve({ generatedAt: "2026-10-19", services: [1, 2, 3] }),
      }),
    );
    renderLanding();
    expect(await screen.findByText("3 services")).toBeInTheDocument();
    expect(screen.getByText("AWS data updated 19 Oct 2026")).toBeInTheDocument();
  });

  it("shows a generatedAt that is not a YYYY-MM-DD date as it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ generatedAt: "soon", services: [1] }) }),
    );
    renderLanding();
    expect(await screen.findByText("AWS data updated soon")).toBeInTheDocument();
  });

  it("falls back when the response is not ok", async () => {
    const f = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", f);
    renderLanding();
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(screen.getByText("450+ services")).toBeInTheDocument();
  });
});

describe("LandingPage hero and motion", () => {
  it("replaces the static preview with the animated hero demo", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderLanding();
    expect(screen.getByLabelText("Example policy preview")).toBeInTheDocument();
    expect(container.querySelector(".lp-stage")).not.toBeNull();
    expect(container.querySelector(".lp-preview > pre")).toBeNull();
  });

  it("reveals feature cards immediately when IntersectionObserver is missing", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const { container } = renderLanding();
    const cards = container.querySelectorAll(".lp-feat");
    expect(cards.length).toBe(3);
    cards.forEach((c) => expect(c).toHaveClass("lp-feat-in"));
  });

  it("reveals each feature card once when it scrolls into view, then stops observing it", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const observed: Element[] = [];
    let callback: IntersectionObserverCallback = () => undefined;
    const unobserve = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe(el: Element) {
          observed.push(el);
        }
        unobserve = unobserve;
        disconnect = disconnect;
      },
    );
    const { container, unmount } = renderLanding();
    const cards = Array.from(container.querySelectorAll(".lp-feat"));
    expect(cards.every((c) => !c.classList.contains("lp-feat-in"))).toBe(true);
    expect(observed).toEqual(cards);
    act(() => {
      callback([{ isIntersecting: false, target: cards[0] } as unknown as IntersectionObserverEntry], {} as never);
    });
    expect(cards[0]).not.toHaveClass("lp-feat-in");
    act(() => {
      callback([{ isIntersecting: true, target: cards[1] } as unknown as IntersectionObserverEntry], {} as never);
    });
    expect(cards[1]).toHaveClass("lp-feat-in");
    expect(cards[0]).not.toHaveClass("lp-feat-in");
    expect(unobserve).toHaveBeenCalledWith(cards[1]);
    unmount();
    expect(disconnect.mock.calls.length).toBeGreaterThan(0);
  });
});
