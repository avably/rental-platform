import { afterEach, describe, expect, it } from "vitest";

import {
  CANONICAL_SITE_URL,
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
