import { builtinModules } from "node:module";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const UI_FREE = "src/core must stay UI-free.";
const uiPaths = [
  { name: "react", message: UI_FREE },
  { name: "react-dom", message: UI_FREE },
];
const uiPatterns = [
  { group: ["react/*", "react-dom/*", "@cloudscape-design/*"], message: UI_FREE },
  { group: ["**/ui/**", "**/state/**"], message: "src/core must not import UI or state code." },
];
// src/core runs in the browser: no Node builtins (node:fs, fs, path, child_process, ...) outside tests and fixtures.
const NODE_FREE = "src/core runs in the browser: Node builtins are only allowed in tests and test fixtures.";
const nodePaths = builtinModules.filter((m) => !m.startsWith("_")).map((name) => ({ name, message: NODE_FREE }));
const nodePatterns = [{ group: ["node:*"], message: NODE_FREE }];
const coreTests = ["src/core/**/*.test.ts", "src/core/**/__test__/**", "src/core/**/__fixtures__/**"];

// The exporters pull in yaml (CloudFormation) and fflate (ZIP): the UI reaches them only through the lazy chunk.
// (A gitignore-style `**/core/export` would also match core/export/json and the fixtures, so these are regexes.)
const EXPORTER_MODULES = ["cli-bash", "cli-ps", "terraform", "cloudformation", "readme", "zip"];
const SUFFIX = String.raw`(\.(ts|tsx|js))?$`;
const coreExportPattern = {
  regex: `(^|/)core/export(/index|/(${EXPORTER_MODULES.join("|")}))?${SUFFIX}`,
  message: "Load exporters through src/ui/export/lazy.ts so yaml and fflate stay out of the initial bundle.",
  allowTypeImports: true,
};
// Only lazy.ts may name the exporters module (as a dynamic import).
const exportersModulePattern = {
  regex: String.raw`(^|/)export/exporters${SUFFIX}|^\./exporters${SUFFIX}`,
  message: "Only src/ui/export/lazy.ts may import src/ui/export/exporters; use loadExporters/useExporters.",
};

export default tseslint.config(
  { ignores: ["dist", "coverage", "docs", ".superpowers", "test-results", "playwright-report"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Only rules-of-hooks: exhaustive-deps stays off until after launch (turning it on means a broad churn of deps).
    // src only: Playwright fixtures in tests/ take a `use` callback the rule mistakes for React 19 use().
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "off" },
  },
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": ["error", { paths: [...uiPaths, ...nodePaths], patterns: [...uiPatterns, ...nodePatterns] }],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "localStorage", "fetch", "process", "require", "Buffer", "__dirname"].map((name) => ({
          name,
          message: "src/core must be pure and browser-API free.",
        })),
      ],
    },
  },
  {
    // Tests and fixtures may read files and spawn processes (e.g. the ZIP time-zone test).
    files: coreTests,
    rules: {
      "no-restricted-imports": ["error", { paths: uiPaths, patterns: uiPatterns }],
      "no-restricted-globals": [
        "error",
        ...["window", "document", "localStorage", "fetch"].map((name) => ({
          name,
          message: "src/core must be pure and browser-API free.",
        })),
      ],
    },
  },
  {
    files: ["src/ui/**", "src/state/**"],
    // Tests may use the exporters directly: they are not part of the bundle.
    ignores: ["src/ui/export/exporters.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: [coreExportPattern, exportersModulePattern] }],
    },
  },
  {
    files: ["src/ui/export/lazy.ts"],
    rules: { "@typescript-eslint/no-restricted-imports": ["error", { patterns: [coreExportPattern] }] },
  },
);
