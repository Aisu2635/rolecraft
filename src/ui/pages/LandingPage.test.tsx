import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDataDate, LandingPage } from "./LandingPage";

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
    expect(screen.queryByRole("link", { name: "Browse templates" })).toBeNull();
    const start = screen.getByRole("link", { name: "Start from scratch" });
    expect(start).toHaveAttribute("href", "/builder");
    expect(start).toHaveClass("primary");
    expect(document.querySelectorAll('a[href="/templates"]')).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/template/i);
    expect(screen.getByText("Share a role as a link")).toBeInTheDocument();
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

  it("formats the data date in UTC with three-letter months (Sep, not en-GB's Sept)", () => {
    expect(formatDataDate("2026-09-19")).toBe("19 Sep 2026");
    expect(formatDataDate("2026-10-19")).toBe("19 Oct 2026");
    const months = Array.from({ length: 12 }, (_, i) => formatDataDate(`2026-${String(i + 1).padStart(2, "0")}-01`));
    expect(months.map((m) => m.split(" ")[1])).toEqual(
      ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    );
    expect(formatDataDate("2026-01-01")).toBe("1 Jan 2026");
    expect(formatDataDate("2026-13-01")).toBe("2026-13-01");
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
