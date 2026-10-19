import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./App";

describe("App shell", () => {
  it("renders the brand", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getAllByText("RoleCraft").length).toBeGreaterThan(0);
  });

  it("shows the builder page at /builder", () => {
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: /Review and export/ })).toBeInTheDocument();
  });

  it("toggles the theme label", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const toLight = screen.getAllByRole("button", { name: "Switch to light theme", hidden: true })[0]!;
    fireEvent.click(toLight);
    expect(screen.getAllByRole("button", { name: "Switch to dark theme", hidden: true })[0]).toBeDefined();
  });

  it("offers Take the tour on the builder only, and it opens the tour", () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={["/"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryAllByRole("button", { name: "Take the tour", hidden: true })).toHaveLength(0);
    unmount();
    render(
      <MemoryRouter initialEntries={["/builder"]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("dialog", { name: "Pick AWS services" })).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Take the tour", hidden: true })[0]!);
    expect(screen.getByRole("dialog", { name: "Pick AWS services" })).toBeInTheDocument();
  });
});
