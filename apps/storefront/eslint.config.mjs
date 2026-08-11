import { createRequire } from "node:module";
import tseslint from "typescript-eslint";
import baseConfig from "../../eslint.config.mjs";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// eslint 10 usunął context.getFilename(), a eslint-plugin-react (ciągnięty
// przez eslint-config-next) wciąż woła je w ścieżce `react.version: "detect"`
// — każda reguła react/* wywala się przy ładowaniu (TypeError). Jawna wersja
// omija wykrywanie w całości; czytana z zainstalowanego Reacta, więc nie
// rozjedzie się przy bumpie. Wpis nadpisuje `detect` z eslint-config-next.
const require = createRequire(import.meta.url);
const pinReactVersion = {
  settings: {
    react: { version: require("react/package.json").version },
  },
};

// Konfiguracja "next" z eslint-config-next parsuje WSZYSTKIE pliki parserem
// Babela wkompilowanym w next (next/dist/compiled/babel/eslint-parser), a ten
// nie zna interfejsu ScopeManager z eslint 10 (brak scopeManager.addGlobals →
// TypeError przy każdym pliku). Blok "next/typescript" odbiera parserowi
// Babela tylko *.ts/*.tsx — poniższy wpis odbiera mu resztę (configi *.mjs,
// skrypty *.js), przywracając parser @typescript-eslint, którym i tak linuje
// je konfiguracja bazowa monorepo. Do zdjęcia, gdy next podniesie wkompilowany
// parser do eslint 10.
const restoreTsParserOutsideTs = {
  files: ["**/*.{js,jsx,mjs,cjs,mts,cts}"],
  languageOptions: { parser: tseslint.parser },
};

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
  // UWAGA (ADR-099/ADR-115): app/api/review/** CELOWO nie ma tu wpisu —
  // storefront jest aplikacją publiczną i nie wolno mu ODROSNĄĆ w klienta
  // service-role; trasy przeglądu są relayem do ingest panelu.
  files: ["app/api/webhooks/**/*.{ts,tsx}", "src/jobs/**/*.{ts,tsx}"],
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
  pinReactVersion,
  restoreTsParserOutsideTs,
  restrictDbServiceImport,
  allowDbServiceImport,
];

export default config;
