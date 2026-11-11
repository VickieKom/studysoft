import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "next-env.d.ts", "src/server/db/migrations/**"]),
  {
    rules: {
      // Server actions are forbidden (AGENTS.md, rule 12).
      "no-restricted-syntax": [
        "error",
        {
          selector: "ExpressionStatement > Literal[value='use server']",
          message: "No server actions: go through a router procedure.",
        },
      ],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
]);
