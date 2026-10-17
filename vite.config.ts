import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("@cloudscape-design")) return "cloudscape";
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id.replaceAll("\\", "/")))
            return "react";
          return undefined;
        },
      },
    },
  },
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
