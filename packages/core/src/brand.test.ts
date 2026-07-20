import { afterEach, describe, expect, it } from "vitest";

import {
  CANONICAL_SITE_URL,
  DEFAULT_FROM_EMAIL,
  RESERVED_SUBDOMAINS,
  ROOT_DOMAIN,
  SENDING_DOMAIN,
  SENDING_SUBDOMAIN,
  TENANT_WILDCARD_HOST,
  normalizeSiteUrl,
  siteUrl,
  tenantStorefrontUrl,
} from "./brand";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("kanon domeny", () => {
  it("kanonem jest www.avably.io, nie .pl", () => {
    expect(CANONICAL_SITE_URL).toBe("https://www.avably.io");
  });

  it("storefront tenanta to subdomena kanonu", () => {
    expect(tenantStorefrontUrl("acme")).toBe("https://acme.avably.io");
    expect(TENANT_WILDCARD_HOST).toBe("*.avably.io");
  });

  it("apex normalizuje się do www (bez dubletu apex/www)", () => {
    expect(normalizeSiteUrl("https://avably.io")).toBe("https://www.avably.io");
    expect(normalizeSiteUrl("https://avably.io/")).toBe("https://www.avably.io");
  });

  it("host spoza kanonu zostaje nietknięty (podgląd Vercela musi działać)", () => {
    expect(normalizeSiteUrl("https://preview.vercel.app")).toBe("https://preview.vercel.app");
  });
});

/**
 * Domyślny nadawca celował w APEX (`noreply@avably.io`), a w Resend
 * zweryfikowana jest wyłącznie subdomena wysyłkowa `send.avably.io`. Na
 * produkcji pierwsza realna wiadomość padła błędem 403 („domain is not
 * verified") i ratunkiem było ręczne ustawienie `RESEND_FROM_EMAIL` — czyli
 * domyślna wartość GWARANTOWAŁA odmowę dostawcy przy każdym świeżym wdrożeniu.
 * Te testy nie pozwalają jej tam wrócić (ADR-047).
 */
describe("domyślny nadawca transakcyjny", () => {
  /** `Marka <adres>` → `adres` (ta sama sztuczka co w platformFromAddress). */
  function addressOf(from: string): string {
    return (from.match(/<([^>]+)>/)?.[1] ?? from).trim();
  }

  it("nie stoi na niezweryfikowanym apeksie", () => {
    expect(addressOf(DEFAULT_FROM_EMAIL).endsWith(`@${ROOT_DOMAIN}`)).toBe(false);
  });

  it("stoi na domenie wysyłkowej", () => {
    expect(SENDING_DOMAIN).toBe(`${SENDING_SUBDOMAIN}.${ROOT_DOMAIN}`);
    expect(addressOf(DEFAULT_FROM_EMAIL)).toBe(`noreply@${SENDING_DOMAIN}`);
  });

  it("subdomena wysyłkowa jest zarezerwowana — żaden najemca nie weźmie jej slugiem", () => {
    // Bez tego tenant o slugu `send` dostałby storefront pod hostem, który
    // trzyma rekordy DKIM/SPF poczty platformy.
    expect(RESERVED_SUBDOMAINS).toContain(SENDING_SUBDOMAIN);
  });
});

describe("siteUrl()", () => {
  it("jawny NEXT_PUBLIC_SITE_URL wygrywa i jest normalizowany", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://avably.io/";
    expect(siteUrl()).toBe("https://www.avably.io");
  });

  it("bez env: produkcja dostaje kanon", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NODE_ENV = "production";
    expect(siteUrl()).toBe(CANONICAL_SITE_URL);
  });

  it("bez env: dev dostaje localhost, nie produkcję", () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.NODE_ENV = "development";
    expect(siteUrl()).toBe("http://127.0.0.1:3000");
  });
});
