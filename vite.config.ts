import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  build: {
    // scripts/check-bundle.ts reads dist/.vite/manifest.json.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("@cloudscape-design")) return "cloudscape";
          const posix = id.replaceAll("\\", "/");
          // The exporters' dependencies: kept in their own chunks so check-bundle can prove they load lazily.
          if (posix.includes("node_modules/yaml/")) return "yaml";
          if (posix.includes("node_modules/fflate/")) return "fflate";
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
      // Snapshot files (.sh/.ps1/.tf/.yaml/.md) aren't source: v8 would report "Failed to parse" for each.
      exclude: ["src/core/catalog/loader.ts", "src/core/__fixtures__/**", "src/core/**/__snapshots__/**"],
      thresholds: { lines: 95, branches: 95 },
    },
  },
});
