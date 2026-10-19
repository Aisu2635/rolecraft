import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Summary } from "./Summary";

afterEach(cleanup);

describe("Summary", () => {
  it("lists what the role can and cannot do under text headings", () => {
    render(
      <Summary
        summary={{
          can: [
            { grantId: "a", text: "Read objects in bucket x" },
            { grantId: "b", text: "Start instances" },
          ],
          cannot: ["Delete anything"],
        }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Can" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cannot" })).toBeInTheDocument();
    const items = screen.getAllByRole("listitem").map((l) => l.textContent);
    expect(items).toEqual(["Read objects in bucket x", "Start instances", "Delete anything"]);
  });

  it("says so when there is nothing to list", () => {
    render(<Summary summary={{ can: [], cannot: [] }} />);
    expect(screen.getByText("Nothing yet. Add a permission to see what this role can do.")).toBeInTheDocument();
  });
});
