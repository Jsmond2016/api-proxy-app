import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "docs-site/.vitepress", "node_modules", "src-tauri/target"],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  reactRefresh.configs.vite,
  {
    files: ["src/**/*.{ts,tsx}", "vite.config.ts"],
    rules: {
      // TypeScript resolves globals from the configured DOM and Node types.
      "no-undef": "off",
    },
  },
  prettier,
);
