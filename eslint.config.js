import { builtinModules } from "node:module";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

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

export default tseslint.config(
  { ignores: ["dist", "coverage", "docs", ".superpowers"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
);
