/**
 * Klucz rate-limitu checkoutu wychodzi z MODELU ZAUFANIA (ADR-106), nie
 * z surowego `x-forwarded-for` (finding audytu rdzenia #1, MEDIUM).
 *
 * PROBLEM: `apps/storefront/lib/actions/checkout.ts` budował klucz throttle'a
 * (`checkout:ip:${ip}`, 10/h) z gołego XFF. Cały ten nagłówek jest sterowalny
 * przez klienta, więc rotacja PREFIKSU dawała świeży kubełek na każde żądanie
 * — limit przestawał istnieć. FIX: `clientIpFromHeaders` (ten sam helper co
 * api/deps.ts i embed/deps.ts) preferuje `x-real-ip`, inaczej bierze OSTATNI
 * hop XFF (adres najbliższego zaufanego proxy), odporny na podrobiony prefiks.
 *
 * Test stoi na SAMEJ AKCJI (nie na helperze — ten ma własne testy w
 * packages/security): mockuje `next/headers` i rdzeń checkoutu, po czym
 * sprawdza, JAKĄ wartość `ip` akcja poda rdzeniowi (z niej rdzeń buduje klucz
 * `checkout:ip:${ip}` — dowód wiązania w checkout-core.test.ts). Gdyby ktoś
 * cofnął fix do surowego XFF, `ip` byłby CAŁYM napisem nagłówka i rotacja
 * prefiksu zmieniałaby kubełek — obie asercje poniżej idą wtedy na czerwono.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CheckoutInput } from "@/lib/checkout/contract";

const headerBag = new Map<string, string>();

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => headerBag.get(name.toLowerCase()) ?? null }),
  // Uchwyt checkoutu zapisuje ciasteczko dopiero w callbacku rdzenia, którego
  // ten test nie uruchamia (rdzeń zamockowany) — atrapa tylko domyka import.
  cookies: async () => ({ set: () => {} }),
}));

// Rdzeń zamockowany: łapiemy DRUGI argument (deps) i zwracamy sukces, nie
// dotykając żadnego z callbacków (RPC, poczta, bilet) — testujemy WYŁĄCZNIE
// wyprowadzenie `ip` w akcji.
const submitCheckoutCore = vi.fn(
  (_input: unknown, _deps: unknown): Promise<unknown> => Promise.resolve({ status: "success" }),
);
vi.mock("@/lib/checkout/core", () => ({
  submitCheckoutCore: (input: unknown, deps: unknown) => submitCheckoutCore(input, deps),
}));

const { submitCheckout } = await import("@/lib/actions/checkout");

const TENANT = "11111111-1111-4111-8111-111111111111";
const INPUT = { items: [] } as unknown as CheckoutInput;

function setHeaders(entries: Record<string, string>): void {
  headerBag.clear();
  // tenant_id z nagłówka middleware'u — bez niego akcja zwraca server_error
  // przed wyprowadzeniem IP (ADR-039).
  headerBag.set("x-tenant-id", TENANT);
  for (const [key, value] of Object.entries(entries)) headerBag.set(key.toLowerCase(), value);
}

function ipPassedToCore(): string {
  const lastCall = submitCheckoutCore.mock.calls.at(-1);
  if (!lastCall) throw new Error("rdzeń checkoutu nie został zawołany");
  const deps = lastCall[1] as { ip: string };
  return deps.ip;
}

beforeEach(() => {
  submitCheckoutCore.mockClear();
});

describe("klucz rate-limitu checkoutu — model zaufania ADR-106 (finding #1)", () => {
  it("rotacja prefiksu XFF NIE zmienia IP przekazanego rdzeniowi (bierzemy ostatni hop)", async () => {
    setHeaders({ "x-forwarded-for": "1.1.1.1, 10.0.0.1, 203.0.113.9" });
    await submitCheckout(INPUT);
    const pierwszy = ipPassedToCore();

    // Ten sam realny klient (ostatni hop 203.0.113.9), ale PODROBIONY prefiks.
    setHeaders({ "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.9" });
    await submitCheckout(INPUT);
    const drugi = ipPassedToCore();

    // Ostatni hop, nie cały napis: gdyby akcja użyła surowego XFF, byłby tu
    // cały „1.1.1.1, 10.0.0.1, 203.0.113.9".
    expect(pierwszy).toBe("203.0.113.9");
    // Sedno fixa: rotacja prefiksu daje TEN SAM kubełek → limit działa.
    expect(drugi).toBe(pierwszy);
  });

  it("x-real-ip wygrywa nad x-forwarded-for", async () => {
    setHeaders({ "x-real-ip": "198.51.100.7", "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    await submitCheckout(INPUT);
    expect(ipPassedToCore()).toBe("198.51.100.7");
  });

  it("brak nagłówków proxy → wspólny kubełek 'unknown' (nie do podrobienia)", async () => {
    setHeaders({});
    await submitCheckout(INPUT);
    expect(ipPassedToCore()).toBe("unknown");
  });
});
