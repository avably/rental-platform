/**
 * Bramka konfiguracji portu płatności (Z2, ADR-065).
 *
 * Trzy rzeczy, których nie widać w typach i które kosztowały projekt czas
 * (ADR-046/049), a na osi pieniędzy kosztowałyby więcej:
 *   1. brak klucza = JAWNA niedostępność, nigdy dev-skip,
 *   2. brak klucza nie „naprawia się" wartością z przestrzeni DOSTAWCY,
 *   3. sekret podpisu webhooka jest nullowalny w konfiguracji, ale ścieżka,
 *      która go potrzebuje, dostaje twardą odmowę.
 */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  PROVIDER_NAMESPACE_ENVS,
  STRIPE_PUBLISHABLE_KEY_ENV,
  STRIPE_SECRET_KEY_ENV,
  STRIPE_WEBHOOK_SECRET_ENV,
  STRIPE_WEBHOOK_SECRET_THIN_ENV,
  StripeConfigError,
  requireStripeWebhookSecret,
  resolveStripeConfig,
  stripeAvailability,
  stripeWebhookSecretThin,
} from "./config";

const SECRET_TEST = "sk_test_klucz_sekretny_atrapa";
const PUBLISHABLE_TEST = "pk_test_klucz_publiczny_atrapa";

const TOUCHED_ENVS = [
  STRIPE_SECRET_KEY_ENV,
  STRIPE_PUBLISHABLE_KEY_ENV,
  STRIPE_WEBHOOK_SECRET_ENV,
  STRIPE_WEBHOOK_SECRET_THIN_ENV,
  ...PROVIDER_NAMESPACE_ENVS,
  "NODE_ENV",
];

const snapshot = new Map(TOUCHED_ENVS.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of snapshot) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("resolveStripeConfig — komplet konfiguracji", () => {
  it("zwraca klucze podane jawnie i null-owy sekret webhooka", () => {
    const config = resolveStripeConfig({
      config: { secretKey: SECRET_TEST, publishableKey: PUBLISHABLE_TEST },
    });
    expect(config.secretKey).toBe(SECRET_TEST);
    expect(config.publishableKey).toBe(PUBLISHABLE_TEST);
    // Z4 jeszcze nie istnieje — brak sekretu podpisu NIE ma prawa niczego
    // wywrócić na ścieżkach Connect.
    expect(config.webhookSecret).toBeNull();
  });

  it("czyta env procesu, gdy wołający nie podał konfiguracji", () => {
    process.env[STRIPE_SECRET_KEY_ENV] = SECRET_TEST;
    process.env[STRIPE_PUBLISHABLE_KEY_ENV] = PUBLISHABLE_TEST;
    process.env[STRIPE_WEBHOOK_SECRET_ENV] = "whsec_atrapa";

    const config = resolveStripeConfig();
    expect(config.secretKey).toBe(SECRET_TEST);
    expect(config.webhookSecret).toBe("whsec_atrapa");
  });

  it("pusty string w env to BRAK konfiguracji, nie wartość", () => {
    process.env[STRIPE_SECRET_KEY_ENV] = "";
    process.env[STRIPE_PUBLISHABLE_KEY_ENV] = PUBLISHABLE_TEST;

    expect(() => resolveStripeConfig()).toThrow(StripeConfigError);
  });
});

describe("brak AVABLY_STRIPE_SECRET_KEY = jawna niedostępność", () => {
  it("stripeAvailability gasi ścieżkę i podaje NAZWĘ brakującej zmiennej", () => {
    const availability = stripeAvailability({ config: { publishableKey: PUBLISHABLE_TEST } });

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(STRIPE_SECRET_KEY_ENV);
  });

  it("wywołanie mimo wszystko kończy się StripeConfigError z listą braków", () => {
    try {
      resolveStripeConfig({ config: {} });
      throw new Error("konfiguracja przeszła bez kluczy");
    } catch (error) {
      expect(error).toBeInstanceOf(StripeConfigError);
      // Wszystkie braki naraz (wzorzec ADR-031): operator uzupełnia
      // konfigurację po jednym komunikacie, nie po serii prób.
      expect((error as StripeConfigError).problems).toEqual([
        `brak ${STRIPE_SECRET_KEY_ENV}`,
        `brak ${STRIPE_PUBLISHABLE_KEY_ENV}`,
      ]);
    }
  });

  it("powód niedostępności NIE niesie wartości kluczy", () => {
    process.env[STRIPE_PUBLISHABLE_KEY_ENV] = PUBLISHABLE_TEST;
    const availability = stripeAvailability();
    expect(availability.reason).not.toContain(PUBLISHABLE_TEST);
  });

  it("konfiguracja nie naprawia się wartością z przestrzeni DOSTAWCY", () => {
    // Dokładny kształt awarii 2.6c (ADR-049): zmienna dostawcy obecna
    // w środowisku, nasza pusta. Fallback oznaczałby tu pobieranie pieniędzy
    // przez konto platformy, którego nie skonfigurowaliśmy.
    for (const name of PROVIDER_NAMESPACE_ENVS) process.env[name] = "sk_live_wartosc_dostawcy";
    delete process.env[STRIPE_SECRET_KEY_ENV];
    delete process.env[STRIPE_PUBLISHABLE_KEY_ENV];

    const availability = stripeAvailability();
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(STRIPE_SECRET_KEY_ENV);
  });

  it("moduł konfiguracji czyta WYŁĄCZNIE zmienne z naszej przestrzeni", () => {
    // Druga strona bramki, na wypadek fallbacku wstawionego ścieżką, której
    // test env-owy nie dotyka (inne miejsce odczytu, inna kolejność).
    // Patrzymy na REALNE odczyty `process.env`, a nie na wystąpienia nazw:
    // `PROVIDER_NAMESPACE_ENVS` wymienia nazwy dostawcy jawnie i ma prawo.
    const source = readFileSync(new URL("./config.ts", import.meta.url), "utf8");
    const reads = [
      ...source.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*(?:"([^"]+)"|([A-Z_][A-Z0-9_]*))\s*\])/g),
    ].map((match) => match[1] ?? match[2] ?? match[3]);

    // Kontrola po pustym zbiorze: gdyby wzorzec przestał cokolwiek łapać,
    // asercja niżej byłaby zielona na pustej liście.
    expect(reads.length).toBeGreaterThan(0);
    expect(reads.sort()).toEqual([
      "STRIPE_PUBLISHABLE_KEY_ENV",
      "STRIPE_SECRET_KEY_ENV",
      "STRIPE_WEBHOOK_SECRET_ENV",
      // ADR-222: sekret Thin też z NASZEJ przestrzeni (wartość
      // AVABLY_STRIPE_WEBHOOK_SECRET_THIN), odczyt przez własną stałą.
      "STRIPE_WEBHOOK_SECRET_THIN_ENV",
    ]);
  });
});

describe("brak klucza NIGDY nie przepuszcza (semantyka ADR-033)", () => {
  it.each(["development", "test", "production"])(
    "NODE_ENV=%s nie zmienia werdyktu",
    (nodeEnv) => {
      process.env.NODE_ENV = nodeEnv;
      delete process.env[STRIPE_SECRET_KEY_ENV];
      delete process.env[STRIPE_PUBLISHABLE_KEY_ENV];

      // Tu nie ma miejsca na dev-skip Turnstile'a (ADR-032): brak CAPTCHY
      // w dev jest nieszkodliwy, a „konto gotowe" bez konta u dostawcy to
      // cichy sukces na osi pieniędzy.
      expect(stripeAvailability().available).toBe(false);
      expect(() => resolveStripeConfig()).toThrow(StripeConfigError);
    },
  );
});

describe("bramki kształtu kluczy", () => {
  it("klucz sekretny w zmiennej publicznej jest odmową, nie ostrzeżeniem", () => {
    const availability = stripeAvailability({
      config: { secretKey: SECRET_TEST, publishableKey: "sk_test_pomylka" },
    });

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(STRIPE_PUBLISHABLE_KEY_ENV);
    expect(availability.reason).toContain("przeglądarki");
  });

  it("klucz publiczny w zmiennej sekretnej też nie przechodzi", () => {
    const availability = stripeAvailability({
      config: { secretKey: "pk_test_pomylka", publishableKey: PUBLISHABLE_TEST },
    });

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain(STRIPE_SECRET_KEY_ENV);
  });

  it("rozjazd trybów test/live jest odmową (awaria NIEMA)", () => {
    const availability = stripeAvailability({
      config: { secretKey: SECRET_TEST, publishableKey: "pk_live_klucz_produkcyjny" },
    });

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain("różnych trybów");
  });

  it("nierozpoznany kształt klucza NIE gasi integracji", () => {
    // Konwencja prefiksów należy do dostawcy. Bramka, która zapala się przy
    // nieznanym kształcie, wyłączyłaby płatności przy pierwszej jego zmianie.
    const availability = stripeAvailability({
      config: { secretKey: "klucz-z-przyszlosci", publishableKey: "inny-klucz" },
    });

    expect(availability.available).toBe(true);
    expect(availability.reason).toBeNull();
  });

  it("komplet spójnych kluczy przechodzi", () => {
    expect(
      stripeAvailability({ config: { secretKey: SECRET_TEST, publishableKey: PUBLISHABLE_TEST } }),
    ).toEqual({ available: true, reason: null });
  });
});

describe("sekret podpisu webhooka — bramka dla Z4", () => {
  it("jego brak NIE gasi ścieżek Connect", () => {
    const availability = stripeAvailability({
      config: { secretKey: SECRET_TEST, publishableKey: PUBLISHABLE_TEST, webhookSecret: null },
    });
    expect(availability.available).toBe(true);
  });

  it("ale ścieżka weryfikacji podpisu dostaje twardą odmowę", () => {
    expect(() =>
      requireStripeWebhookSecret({
        config: { secretKey: SECRET_TEST, publishableKey: PUBLISHABLE_TEST, webhookSecret: null },
      }),
    ).toThrow(new RegExp(STRIPE_WEBHOOK_SECRET_ENV));
  });

  it("z sekretem zwraca jego wartość", () => {
    expect(
      requireStripeWebhookSecret({
        config: {
          secretKey: SECRET_TEST,
          publishableKey: PUBLISHABLE_TEST,
          webhookSecret: "whsec_atrapa",
        },
      }),
    ).toBe("whsec_atrapa");
  });
});

describe("sekret DRUGIEJ destynacji (Thin) — OPCJONALNY, nie rzuca (ADR-222)", () => {
  it("brak env → undefined, NIE rzuca (lustro odwrotne do requireStripeWebhookSecret)", () => {
    delete process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV];
    expect(stripeWebhookSecretThin()).toBeUndefined();
  });

  it("pusty string w env = brak (wzorzec present) → undefined", () => {
    process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV] = "";
    expect(stripeWebhookSecretThin()).toBeUndefined();
  });

  it("env z wartością → zwraca sekret Thin", () => {
    process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV] = "whsec_thin_atrapa";
    expect(stripeWebhookSecretThin()).toBe("whsec_thin_atrapa");
  });

  it("jawne value: undefined to DECYZJA wołającego — nie spada na env", () => {
    process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV] = "whsec_thin_z_env";
    expect(stripeWebhookSecretThin({ value: undefined })).toBeUndefined();
  });

  it("jawna wartość ma pierwszeństwo nad env", () => {
    process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV] = "whsec_thin_z_env";
    expect(stripeWebhookSecretThin({ value: "whsec_thin_jawny" })).toBe("whsec_thin_jawny");
  });

  it("NIEZALEŻNY od bramek kluczy: brak secret/publishable NIE wywraca odczytu Thin", () => {
    delete process.env[STRIPE_SECRET_KEY_ENV];
    delete process.env[STRIPE_PUBLISHABLE_KEY_ENV];
    process.env[STRIPE_WEBHOOK_SECRET_THIN_ENV] = "whsec_thin_atrapa";
    // resolveStripeConfig rzuciłby (brak pary kluczy); ten accessor NIE rzuca.
    expect(() => stripeWebhookSecretThin()).not.toThrow();
    expect(stripeWebhookSecretThin()).toBe("whsec_thin_atrapa");
  });
});
