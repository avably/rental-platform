/**
 * Metadane osi tenanckiej (lib/seo/tenant-metadata.ts, Zadanie 2.7, ADR-044).
 * Pilnują trzech decyzji: canonical na hoście tenanta, noindex dla sklepu bez
 * opublikowanej strony, noindex dla stron transakcyjnych.
 */
import { describe, expect, it } from "vitest";

import type { PublishedSite } from "@/lib/site/published";
import {
  clampDescription,
  heroText,
  OG_IMAGE_PATH,
  pageTitle,
  tenantMetadata,
} from "@/lib/seo/tenant-metadata";

const site: PublishedSite = {
  template: "classic",
  publishedAt: "2026-07-18T17:00:12+00:00",
  // Styl pusty (K5, ADR-090) — metadane opisują TREŚĆ, a nie wygląd, więc ten
  // fixture ma zostać stanem „operator nigdy nie dotknął panelu stylu".
  style: {},
  sections: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      position: 0,
      type: "hero",
      content: { heading: "Sprzęt na dobę", subheading: "Rezerwacja online" },
    },
  ],
};

describe("heroText — opis bierze się z tego, co najemca OPUBLIKOWAŁ", () => {
  it("czyta nagłówek i podtytuł sekcji hero", () => {
    expect(heroText(site)).toEqual({ heading: "Sprzęt na dobę", subheading: "Rezerwacja online" });
  });

  it("brak strony / brak hero → pusto (wołający użyje zapasowego copy)", () => {
    expect(heroText(null)).toEqual({});
    expect(heroText({ ...site, sections: [] })).toEqual({});
  });
});

describe("clampDescription", () => {
  it("skleja białe znaki i nie tnie w połowie słowa", () => {
    const long = `${"słowo ".repeat(40)}koniec`;
    const out = clampDescription(long);
    expect(out.length).toBeLessThanOrEqual(161);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });

  it("krótki opis zostaje nietknięty (bez wielokropka)", () => {
    expect(clampDescription("Krótki opis")).toBe("Krótki opis");
  });
});

describe("pageTitle", () => {
  it("strona główna sklepu = sama nazwa sklepu", () => {
    expect(pageTitle("Wypożyczalnia Kwiatowa")).toBe("Wypożyczalnia Kwiatowa");
  });

  it("podstrona = '{strona} — {sklep}'", () => {
    expect(pageTitle("Wypożyczalnia Kwiatowa", "Wiertarka")).toBe(
      "Wiertarka — Wypożyczalnia Kwiatowa",
    );
  });
});

describe("tenantMetadata", () => {
  const base = {
    title: "Wypożyczalnia Kwiatowa",
    description: "Sprzęt na dobę",
    storeName: "Wypożyczalnia Kwiatowa",
    published: true,
    origin: "https://acme.avably.io",
    pathname: "/store",
    locale: "pl",
  };

  it("canonical i og:url wskazują HOST TENANTA, nie kanon marketingowy", () => {
    const meta = tenantMetadata(base);
    expect(meta.alternates?.canonical).toBe("https://acme.avably.io/store");
    expect(meta.openGraph).toMatchObject({
      url: "https://acme.avably.io/store",
      siteName: "Wypożyczalnia Kwiatowa",
      locale: "pl",
      type: "website",
    });
  });

  it("miniatura OG leży na origin tenanta (stabilny adres, bez hasza)", () => {
    const images = tenantMetadata(base).openGraph?.images as { url: string }[];
    expect(images[0]?.url).toBe(`https://acme.avably.io${OG_IMAGE_PATH}`);
  });

  it("sklep OPUBLIKOWANY jest indeksowalny", () => {
    expect(tenantMetadata(base).robots).toBeUndefined();
  });

  it("sklep BEZ opublikowanej strony → noindex (decyzja ADR-044)", () => {
    expect(tenantMetadata({ ...base, published: false }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("strona transakcyjna → noindex nawet przy opublikowanym sklepie", () => {
    expect(tenantMetadata({ ...base, transactional: true, pathname: "/cart" }).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("bez znanego origin nie zmyśla canonicala ani miniatury", () => {
    const meta = tenantMetadata({ ...base, origin: null });
    expect(meta.alternates).toBeUndefined();
    expect(meta.openGraph).not.toHaveProperty("url");
    expect(meta.openGraph).not.toHaveProperty("images");
  });
});
