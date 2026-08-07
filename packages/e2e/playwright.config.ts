import { defineConfig, devices } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

import {
  E2E_STRIPE_PUBLISHABLE_KEY,
  E2E_STRIPE_SECRET_KEY,
  E2E_STRIPE_WEBHOOK_SECRET,
  PANEL_PORT,
  STOREFRONT_PORT,
  STOREFRONT_SITE_PASSWORD,
  STRIPE_STUB_PORT,
  requiredEnv,
} from "./lib/env";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Zmienne lokalnego Supabase — te same, których używają suity integracyjne
 * repo (job `rls` w CI eksportuje je z `supabase status -o env`). Brak =
 * twardy błąd już na etapie wczytania konfiguracji, zanim cokolwiek uda,
 * że działa.
 */
const SUPABASE_API_URL = requiredEnv("SUPABASE_LOCAL_API_URL");
const SUPABASE_ANON_KEY = requiredEnv("SUPABASE_LOCAL_ANON_KEY");

/**
 * Preload przekierowujący `api.stripe.com` na lokalny stub. Konieczny,
 * bo baza API dostawcy jest w kodzie produktu STAŁĄ (`STRIPE_API_BASE`
 * w packages/core/src/stripe/api.ts) — celowo nie ma zmiennej env, którą
 * dałoby się podmienić. Preload działa na proces serwera Next, kod produktu
 * pozostaje nietknięty; aktywuje się wyłącznie przy ustawionym
 * E2E_STRIPE_STUB_PORT.
 */
const STRIPE_PRELOAD = pathToFileURL(join(HERE, "stub", "preload-stripe.mjs")).href;

/** Env wspólny dla obu serwerów Next (produkcyjny `next start`). */
const nextEnv = {
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_API_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: SUPABASE_ANON_KEY,
  AVABLY_STRIPE_SECRET_KEY: E2E_STRIPE_SECRET_KEY,
  AVABLY_STRIPE_PUBLISHABLE_KEY: E2E_STRIPE_PUBLISHABLE_KEY,
  AVABLY_STRIPE_WEBHOOK_SECRET: E2E_STRIPE_WEBHOOK_SECRET,
  E2E_STRIPE_STUB_PORT: String(STRIPE_STUB_PORT),
  NODE_OPTIONS: `--import ${STRIPE_PRELOAD}`,
};

export default defineConfig({
  testDir: "./tests",
  /* Jeden łańcuch scenariuszy na współdzielonej bazie — sekwencyjnie.
   * Determinizm i czytelność diagnozy ważniejsze niż minuty przebiegu. */
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: ".artefakty/raport" }]],
  outputDir: ".artefakty/wyniki",
  globalSetup: "./global-setup",

  use: {
    /* Basic Auth storefrontu; panel nie wysyła challenge'u, więc poświadczenia
     * nie wchodzą mu w drogę. */
    httpCredentials: { username: "e2e", password: STOREFRONT_SITE_PASSWORD },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "pl-PL",
    timezoneId: "Europe/Warsaw",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        /* Deterministyczne rozwiązanie `{slug}.localhost` niezależnie od
         * resolvera systemu — subdomeny localhost bywały miną w in-app
         * przeglądarkach. */
        launchOptions: {
          args: ["--host-resolver-rules=MAP *.localhost 127.0.0.1"],
        },
      },
    },
  ],

  webServer: [
    {
      command: `node stub/stripe-stub.mjs`,
      port: STRIPE_STUB_PORT,
      reuseExistingServer: false,
      timeout: 15_000,
      env: { E2E_STRIPE_STUB_PORT: String(STRIPE_STUB_PORT) },
    },
    {
      command: `bash scripts/start-storefront.sh`,
      port: STOREFRONT_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
      env: { ...nextEnv, PORT: String(STOREFRONT_PORT) },
    },
    {
      command: `bash scripts/start-panel.sh`,
      port: PANEL_PORT,
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        ...nextEnv,
        PORT: String(PANEL_PORT),
        // Webhook panelu pisze stan zamówień poza sesją — wymaga produkcyjnej
        // nazwy zmiennej; wartością jest klucz LOKALNEGO Supabase (harness
        // testowy, nie istnieje na produkcji — jawny wyjątek bramki
        // audit-service-role dla SUPABASE_LOCAL_SERVICE_ROLE_KEY).
        SUPABASE_SERVICE_ROLE_KEY: requiredEnv("SUPABASE_LOCAL_SERVICE_ROLE_KEY"),
      },
    },
  ],
});
