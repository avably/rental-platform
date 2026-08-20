/**
 * INCYDENT PRODUKCYJNY (ADR-221): powrót po opłaceniu abonamentu wracał na
 * `avably.io/pl/organizacja` (kanon MARKETINGOWY) i kończył się 404 — panel
 * żyje na `app.avably.io`. Adresy powrotu billingu MUSZĄ celować w ORIGIN
 * PANELU, nie w stronę marketingową.
 *
 * Ten plik pilnuje trzech powierzchni, każda z DOWODEM MUTACYJNYM (przywrócenie
 * `siteUrl()` albo domyślnego `siteUrl()` → test RED):
 *
 *   1. Checkout abonamentu — `successUrl`/`cancelUrl` z origin panelu,
 *   2. Portal klienta — `returnUrl` z origin panelu,
 *   3. mail dunningowy — link „opłać" z origin panelu.
 *
 * Testujemy PRAWDZIWE `panelBaseUrlFromRequest()` / `PANEL_URL` (nie atrapę
 * hosta), wstrzykując wyłącznie granice: nagłówek żądania (`next/headers`),
 * rdzeń rozliczeń (`billing-checkout`/`billing-portal`) i transport poczty.
 * `siteUrl()` jest przypięty do kanonu MARKETINGOWEGO przez
 * `NEXT_PUBLIC_SITE_URL=https://www.avably.io`, więc gdyby powrót go używał,
 * host byłby `www.avably.io` — dokładnie awaria z produkcji.
 */
import { PANEL_URL, SAAS_PLAN_PRICING, STRIPE_SECRET_KEY_ENV } from "@avably/core";
import type { EmailTransport } from "@avably/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MARKETING_ORIGIN = "https://www.avably.io";
const PANEL_HOST = "app.avably.io"; // host spoza pętli zwrotnej → PANEL_URL

/** Wstrzyknięte wejścia rdzeni rozliczeń — łapią to, co zbudowała akcja. */
const captured = vi.hoisted(() => ({
  checkout: undefined as { successUrl: string; cancelUrl: string } | undefined,
  portal: undefined as { returnUrl: string } | undefined,
}));

class FakeAuthError extends Error {}

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Map([["host", PANEL_HOST]])),
}));
vi.mock("next-intl/server", () => ({ getLocale: async () => "pl" }));
vi.mock("@/lib/navigation", () => ({ localePath: async (path: string) => `/pl${path}` }));
vi.mock("@/lib/auth", () => ({ AuthError: FakeAuthError }));
vi.mock("@/lib/billing-guard", () => ({
  requireBillingOwner: async () => ({
    supabase: {} as SupabaseClient,
    tenantId: "11111111-1111-4111-8111-111111111111",
    role: "owner",
    user: { id: "user-1", email: "wlasciciel@example.invalid" },
  }),
}));
vi.mock("@/lib/billing-checkout", () => ({
  startSaasCheckout: async (
    _deps: unknown,
    input: { successUrl: string; cancelUrl: string },
  ) => {
    captured.checkout = { successUrl: input.successUrl, cancelUrl: input.cancelUrl };
    return { url: "https://checkout.stripe.test/c/session" };
  },
}));
vi.mock("@/lib/billing-portal", () => ({
  openBillingPortal: async (_deps: unknown, input: { returnUrl: string }) => {
    captured.portal = { returnUrl: input.returnUrl };
    return { url: "https://billing.stripe.test/p/session" };
  },
}));

beforeEach(() => {
  vi.resetModules();
  captured.checkout = undefined;
  captured.portal = undefined;
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", MARKETING_ORIGIN);
  process.env[STRIPE_SECRET_KEY_ENV] = "sk_test_klucz_platformy_atrapa";
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete process.env[STRIPE_SECRET_KEY_ENV];
});

async function runCheckout() {
  const { startSaasCheckoutAction } = await import(
    "@/app/[locale]/(panel)/organizacja/billing-actions"
  );
  return startSaasCheckoutAction({ planId: SAAS_PLAN_PRICING[0]!.id, interval: "monthly" });
}

async function runPortal() {
  const { openBillingPortalAction } = await import("@/lib/actions/billing-management");
  return openBillingPortalAction();
}

describe("powroty billingu celują w origin PANELU, nie w marketing (ADR-221)", () => {
  it("Checkout: successUrl i cancelUrl budują się z app.avably.io", async () => {
    const result = await runCheckout();

    expect(result.error, result.error).toBeUndefined();
    expect(captured.checkout, "rdzeń checkoutu nie dostał adresów").toBeDefined();
    // SEDNO: host panelu, nie marketingowy — mutacja `siteUrl()` dałaby
    // `https://www.avably.io/...` i wywróciłaby obie asercje.
    expect(captured.checkout!.successUrl).toBe(`${PANEL_URL}/pl/organizacja?checkout=sukces`);
    expect(captured.checkout!.cancelUrl).toBe(`${PANEL_URL}/pl/organizacja?checkout=anulowano`);
    expect(captured.checkout!.successUrl).not.toContain("www.avably.io");
    expect(captured.checkout!.cancelUrl).not.toContain("www.avably.io");
  });

  it("Portal: returnUrl buduje się z app.avably.io", async () => {
    const result = await runPortal();

    expect(result.error, result.error).toBeUndefined();
    expect(captured.portal, "rdzeń portalu nie dostał adresu powrotu").toBeDefined();
    expect(captured.portal!.returnUrl).toBe(`${PANEL_URL}/pl/organizacja?portal=powrot`);
    expect(captured.portal!.returnUrl).not.toContain("www.avably.io");
  });

  it("PANEL_URL to origin panelu, a siteUrl() marketingowy — różne hosty (kotwica dowodu)", async () => {
    const { siteUrl } = await import("@avably/core");
    // Gdyby oba wskazywały ten sam host, dowód mutacyjny byłby pusty.
    expect(PANEL_URL).toContain("app.avably.io");
    expect(siteUrl()).toBe(MARKETING_ORIGIN);
    expect(PANEL_URL).not.toBe(siteUrl());
  });
});

describe("mail dunningowy prowadzi do panelu, nie na marketing (ADR-221)", () => {
  function fakeDb(): SupabaseClient {
    return {
      from(table: string) {
        if (table === "tenants") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { name: "Wypożyczalnia Testowa", locale: "pl" },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "members") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({ data: [{ user_id: "owner-1" }], error: null }),
              }),
            }),
          };
        }
        throw new Error(`nieoczekiwana tabela ${table}`);
      },
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: "wlasciciel@example.invalid" } },
            error: null,
          }),
        },
      },
    } as unknown as SupabaseClient;
  }

  it("domyślny link (bez override) idzie na app.avably.io/organizacja", async () => {
    const { sendSaasPaymentFailedEmail } = await import("@/lib/billing-email");
    const sent: { html: string; text: string }[] = [];
    const transport: EmailTransport = {
      send: async (email) => {
        sent.push({ html: email.html, text: email.text });
        return { id: "msg_1" };
      },
    };

    // Kluczowe: NIE przekazujemy `panelBaseUrl` — dokładnie tak woła webhook
    // billingu. Domyślną bazą MUSI być PANEL_URL, nie `siteUrl()`.
    const problem = await sendSaasPaymentFailedEmail(
      { db: fakeDb(), availability: { available: true }, transport },
      { tenantId: "11111111-1111-4111-8111-111111111111" },
    );

    expect(problem, problem).toBeUndefined();
    expect(sent).toHaveLength(1);
    // Link „przejdź do rozliczeń" celuje w PANEL. Asercja jest wąska celowo:
    // szablon osadza logo z hosta MARKETINGOWEGO (`www.avably.io/marketing/…`),
    // więc szeroki zakaz `www.avably.io` łapałby logo, nie defekt. Mutacja
    // domyślnego `siteUrl()` dałaby `href="https://www.avably.io/organizacja"`.
    expect(sent[0]!.html).toContain(`href="${PANEL_URL}/organizacja"`);
    expect(sent[0]!.html).not.toContain(`${MARKETING_ORIGIN}/organizacja`);
  });
});
