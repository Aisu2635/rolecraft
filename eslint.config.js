import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage", "docs", ".superpowers"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "react", message: "src/core must stay UI-free." },
            { name: "react-dom", message: "src/core must stay UI-free." },
          ],
          patterns: [
            { group: ["react/*", "react-dom/*", "@cloudscape-design/*"], message: "src/core must stay UI-free." },
            { group: ["**/ui/**", "**/state/**"], message: "src/core must not import UI or state code." },
          ],
        },
      ],
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
