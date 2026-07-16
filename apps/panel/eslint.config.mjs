import baseConfig from "../../eslint.config.mjs";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// Klient service-role (@avably/db/service) omija RLS — dozwolony wyłącznie
// w webhookach i jobach uruchamianych server-side (patrz
// docs/konwencje-migracji.md). Import poza tymi ścieżkami jest błędem lint.
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

const config = [
  ...baseConfig,
  ...nextCoreWebVitals,
  restrictDbServiceImport,
  allowDbServiceImport,
];

export default config;
