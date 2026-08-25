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
  logo: null,
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

  /**
   * ELEMENT ZWIĄZANY Z KATALOGIEM (faza 3, ADR-163) niesie w treści napis
   * PROJEKTOWY — ten, do którego render wraca po zdjęciu wiązania i którego
   * odwiedzający nigdy nie widzi. Metadane czytają treść, więc bez odsiewu opis
   * w wynikach wyszukiwania byłby zdaniem, którego na stronie NIE MA.
   */
  it("napis związany z katalogiem NIE staje się opisem strony", () => {
    const canvasSite: PublishedSite = {
      ...site,
      sections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          position: 0,
          type: "hero",
          content: {
            version: 2,
            rows: 20,
            background: "default",
            elements: [
              {
                id: "naglowek",
                kind: "heading",
                text: "Nagłówek strony",
                level: 1,
                align: "left",
                layout: { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } },
              },
              {
                id: "podtytul",
                kind: "text",
                text: "TEKST PROJEKTOWY, NIGDY NIEWIDOCZNY",
                variant: "lead",
                align: "left",
                layout: { desktop: { x: 0, y: 8, w: 48, h: 6, z: 0 } },
                bindings: {
                  text: {
                    record: { kind: "product", productId: "33333333-3333-4333-8333-333333333333" },
                    field: "description",
                    whenEmpty: "hide",
                  },
                },
              },
            ],
          },
        } as unknown as PublishedSite["sections"][number],
      ],
    };

    expect(heroText(canvasSite)).toEqual({ heading: "Nagłówek strony" });
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

  /*
    ZMIANA ŚWIADOMA (S-31 audytu 2026-08-25): separator to kropka środkowa, nie
    dywiz — ten sam znak, którym ścieżka sklepu rozdziela człony wszędzie indziej
    po F5. Tożsamość w tytule była i jest brana z `tenants.name` (patrz docblock
    `pageTitle`), więc ta asercja pilnuje wyłącznie zapisu.
  */
  it("podstrona = '{strona} · {sklep}'", () => {
    expect(pageTitle("Wypożyczalnia Kwiatowa", "Wiertarka")).toBe(
      "Wiertarka · Wypożyczalnia Kwiatowa",
    );
  });

  it("separator nie jest dywizem — nazwa własna z dywizem zostaje czytelna", () => {
    const title = pageTitle("Sprzęt Bud-Mar", "Wiertarka");
    expect(title).toBe("Wiertarka · Sprzęt Bud-Mar");
    expect(title.split(" - "), "dywiz wrócił jako separator członów").toHaveLength(1);
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
