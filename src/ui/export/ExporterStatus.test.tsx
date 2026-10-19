import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBuilderStore } from "../../state/builder";
import { ExporterStatus } from "./ExporterStatus";

const store = () => useBuilderStore.getState();
const UPDATED = "RoleCraft has been updated. Reload to continue. Your role is kept in the link.";
const TOO_LARGE = "This role is too large to keep in the link. Export or copy it before reloading.";

/** Policy ARNs of incompressible text, far past the share-link limit. */
function tooLargeArns(): string[] {
  let a = 7;
  const next = (): number => (a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296;
  const rnd = (n: number): string =>
    Array.from({ length: n }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(next() * 36)]).join("");
  return Array.from({ length: 100 }, () => rnd(200));
}

beforeEach(() => {
  store().reset();
  window.history.replaceState(null, "", "/builder");
});
afterEach(cleanup);

describe("ExporterStatus", () => {
  it("a first failure keeps the connection message and Retry", () => {
    const retry = vi.fn();
    render(<ExporterStatus state={{ status: "error", retry, stale: false }} />);
    expect(screen.getByText("Couldn't load the exporters. Check your connection and try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("a stale app says RoleCraft was updated and offers Reload instead of Retry", () => {
    render(<ExporterStatus state={{ status: "error", retry: vi.fn(), stale: true }} reload={vi.fn()} />);
    expect(screen.getByText(UPDATED)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("a stale app shows the Reload message even while a load is still pending", () => {
    render(<ExporterStatus state={{ status: "loading", retry: vi.fn(), stale: true }} reload={vi.fn()} />);
    expect(screen.getByText(UPDATED)).toBeInTheDocument();
    expect(screen.queryByText("Loading exporters…")).toBeNull();
  });

  it("Reload writes the role into the link first, then reloads", () => {
    act(() => store().setFields({ name: "kept-role" }));
    const order: string[] = [];
    const reload = vi.fn(() => order.push("reload:" + window.location.hash));
    render(<ExporterStatus state={{ status: "error", retry: vi.fn(), stale: true }} reload={reload} />);
    expect(window.location.hash).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(order[0]).toMatch(/^reload:#s=./);
  });

  it("a role too large for the link warns before reloading", () => {
    act(() => store().setShareStatus("too-large"));
    render(<ExporterStatus state={{ status: "error", retry: vi.fn(), stale: true }} reload={vi.fn()} />);
    expect(screen.getByText(TOO_LARGE)).toBeInTheDocument();
    expect(screen.queryByText(UPDATED)).toBeNull();
    expect(screen.getByText("RoleCraft has been updated. Reload to continue.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload anyway" })).toBeInTheDocument();
  });

  it("Reload does not reload a role too large for the link: it shows the warning, then Reload anyway reloads", () => {
    act(() => store().setFields({ managedPolicyArns: tooLargeArns() }));
    const reload = vi.fn();
    render(<ExporterStatus state={{ status: "error", retry: vi.fn(), stale: true }} reload={reload} />);
    expect(screen.queryByText(TOO_LARGE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).not.toHaveBeenCalled();
    expect(store().shareStatus).toBe("too-large");
    expect(screen.getByText(TOO_LARGE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload anyway" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
