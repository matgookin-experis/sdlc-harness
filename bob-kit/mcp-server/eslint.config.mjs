// eslint.config.mjs — ESLint flat config for sdlc-harness MCP server
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.FlatConfig[]} */
export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // Catch common mistakes
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": "warn",
      // Keep code clean
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    files: ["*.mjs"],
    rules: {
      "no-unused-vars": "error",
      "prefer-const": "error",
      "no-var": "error",
    },
  },
  {
    // Ignore built and vendored files
    ignores: ["dist/**", "node_modules/**"],
  },
];
