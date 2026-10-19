import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library only auto-registers this when `afterEach` is a global, and Vitest runs without `globals`. Without it
// rendered trees outlive their test and their timers fire after jsdom is torn down ("window is not defined").
afterEach(() => {
  cleanup();
});
