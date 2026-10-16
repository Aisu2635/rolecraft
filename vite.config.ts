import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1000 },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test-setup.ts"],
    include: ["src/**/*.test.ts?(x)", "tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/core/**"],
      exclude: ["src/core/catalog/loader.ts", "src/core/__fixtures__/**"],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
