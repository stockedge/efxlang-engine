import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

const tsFiles = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

/** @type {import("eslint").Linter.RulesRecord} */
const strongRules = {
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
      "node_modules/**",
      "vm_log.txt",
    ],
  },

  // Apply TypeScript rules only to TS files (avoid linting generated JS).
  { ...tseslint.configs.base, files: tsFiles },
  tseslint.configs.eslintRecommended,
  { ...tseslint.configs.strictTypeCheckedOnly[2], files: tsFiles },
  { ...tseslint.configs.stylisticTypeCheckedOnly[2], files: tsFiles },
  prettierConfig,

  {
    files: ["src/**/*.ts", "test/**/*.ts", "vite.browser.config.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    rules: strongRules,
  },
  {
    files: ["web/**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./web/tsconfig.json",
      },
    },
    rules: strongRules,
  },
);
