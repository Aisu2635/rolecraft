import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// The first-run tour would open over every builder test; the tour's own tests clear this flag.
beforeEach(() => {
  globalThis.localStorage?.setItem("rolecraft.tour.v1", "seen");
});

// Testing Library only auto-registers this when `afterEach` is a global, and Vitest runs without `globals`. Without it
// rendered trees outlive their test and their timers fire after jsdom is torn down ("window is not defined").
afterEach(() => {
  cleanup();
});
