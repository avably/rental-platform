import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Klient service-role (@avably/db/service) omija RLS — dozwolony wyłącznie
// w webhookach i jobach uruchamianych server-side (patrz
// docs/konwencje-migracji.md). Zduplikowane tu (poza apps/*/eslint.config.mjs)
// tak, by reguła obejmowała też packages/* — import poza dozwolonymi
// ścieżkami jest błędem lint niezależnie od tego, w którym miejscu
// monorepo się pojawi.
const restrictDbServiceImport = {
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@avably/db/service",
            message:
              "Klient service-role omija RLS — dozwolony tylko w app/api/webhooks/** i src/jobs/**.",
          },
        ],
      },
    ],
  },
};

const allowDbServiceImport = {
  files: ["app/api/webhooks/**/*.{ts,tsx}", "src/jobs/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": "off",
  },
};

export default tseslint.config(
  {
    ignores: [
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/next-env.d.ts",
      "**/*.tsbuildinfo",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Konwencja repo: parametr prefiksowany `_` to celowo nieużywany
      // (np. sygnatury zgodne z React useActionState/server actions, gdzie
      // kolejny parametr jest wymagany przez typy, ale ciało go nie czyta).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  restrictDbServiceImport,
  allowDbServiceImport,
);
