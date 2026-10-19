import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Vitest runs without `globals`, so Testing Library cannot register its own afterEach cleanup; test-setup.ts does it.
// Without it every rendered tree outlives its test, and live timers (e.g. the landing hero loop) fire after jsdom is
// torn down: "ReferenceError: window is not defined" from React's scheduler.
describe("test setup", () => {
  it("renders into the document", () => {
    render(<p>left behind?</p>);
    expect(document.body.textContent).toContain("left behind?");
  });

  it("unmounts what the previous test rendered", () => {
    expect(document.body.innerHTML).toBe("");
  });
});
