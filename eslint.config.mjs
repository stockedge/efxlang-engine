import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

/** @type {import("eslint").Linter.FlatConfig["plugins"]} */
const strongPlugins = {
  "simple-import-sort": simpleImportSort,
};

/** @type {import("eslint").Linter.RulesRecord} */
const strongRules = {
  "simple-import-sort/imports": "error",
  "simple-import-sort/exports": "error",
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { prefer: "type-imports", fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/consistent-type-exports": "error",
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "dist-web/**",
      "coverage/**",
      "wasm/**",
      "node_modules/**",
      "vm_log.txt",
    ],
  },
  {
    linterOptions: { reportUnusedDisableDirectives: true },
  },

  // Apply TypeScript rules only to TS files (avoid linting generated JS).
  { ...tseslint.configs.base, files: tsFiles },
  tseslint.configs.eslintRecommended,
  { ...tseslint.configs.strictTypeCheckedOnly[2], files: tsFiles },
  { ...tseslint.configs.stylisticTypeCheckedOnly[2], files: tsFiles },
  prettierConfig,

  {
    files: [
      "src/**/*.ts",
      "test/**/*.ts",
      "e2e/**/*.ts",
      "vite.browser.config.ts",
      "playwright.config.ts",
    ],
    plugins: strongPlugins,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: strongRules,
  },
  {
    files: ["web/**/*.ts"],
    plugins: strongPlugins,
    languageOptions: {
      parserOptions: {
        project: "./web/tsconfig.json",
      },
    },
    rules: strongRules,
  },
);
