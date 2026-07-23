import baseConfig from "../../eslint.config.mjs";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Klient service-role (@avably/db/service) omija RLS — dozwolony wyłącznie
// w webhookach i jobach uruchamianych server-side (patrz
// docs/konwencje-migracji.md). Import poza tymi ścieżkami jest błędem lint.
// `paths` łapie kanoniczną nazwę pakietu, `patterns` domyka obejście przez
// import ścieżką względną lub do `dist` (np. ../../packages/db/src/service).
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
        patterns: [
          {
            group: ["**/db/*/service", "**/db/src/service", "**/db/dist/service"],
            message:
              "Klient service-role omija RLS — nie importuj go ścieżką względną/dist (obejście kwarantanny). Dozwolony tylko jako @avably/db/service w app/api/webhooks/** i src/jobs/**.",
          },
        ],
      },
    ],
  },
};

const allowDbServiceImport = {
  // app/api/review/**: narzędzie przeglądu (ADR-071) — wyjątek uzasadniony
  // w nagłówku route'u i w scripts/audit-service-role.sh.
  files: ["app/api/webhooks/**/*.{ts,tsx}", "app/api/review/**/*.{ts,tsx}", "src/jobs/**/*.{ts,tsx}"],
  rules: {
    "no-restricted-imports": "off",
  },
};

/**
 * Zasoby przeniesionego szablonu (ADR-068) są cudzym, wyeksportowanym kodem —
 * nie podlegają naszym regułom stylu i nie mają być „poprawiane”. To samo
 * dotyczy HTML-a stron marketingowych, który jest DANYMI, nie źródłem.
 */
const ignoreVendoredTemplate = {
  ignores: ["public/forerunner/**", "marketing/**"],
};

const config = [
  ignoreVendoredTemplate,
  ...baseConfig,
  ...nextCoreWebVitals,
  restrictDbServiceImport,
  allowDbServiceImport,
];

export default config;
