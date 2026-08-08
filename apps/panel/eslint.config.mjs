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
  // app/api/review/ingest/**: przyjmuje uwagi przeglądu od relaya storefrontu
  // (ADR-099/ADR-115) — zapis service_rolem wykonuje się w panelu, jedynym
  // runtime z kluczem; bramka w lib/review-ingest-guard.ts.
  files: [
    "app/api/webhooks/**/*.{ts,tsx}",
    "app/api/review/ingest/**/*.{ts,tsx}",
    "src/jobs/**/*.{ts,tsx}",
  ],
  rules: {
    "no-restricted-imports": "off",
  },
};

const config = [
  ...baseConfig,
  ...nextCoreWebVitals,
  restrictDbServiceImport,
  allowDbServiceImport,
];

export default config;
