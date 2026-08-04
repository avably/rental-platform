/**
 * JSON-LD storefrontu (lib/seo/jsonld.ts, Zadanie 2.7, ADR-044).
 *
 * Dwie rzeczy są tu naprawdę istotne i obie są testowane wprost:
 *   1. znaczniki NIE niosą niczego spoza publicznego kontraktu,
 *   2. treść najemcy nie ma jak wyjść z bloku `<script>`.
 */
import { faqPageJsonLd } from "@avably/core/site";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  groszeToDecimal,
  localBusinessJsonLd,
  productJsonLd,
  serializeJsonLd,
} from "@/lib/seo/jsonld";

describe("groszeToDecimal — kwota w formacie schema.org", () => {
  it.each([
    [12000, "120.00"],
    [5, "0.05"],
    [50, "0.50"],
    [0, "0.00"],
    [199999, "1999.99"],
  ])("%i grosze → '%s'", (grosze, expected) => {
    expect(groszeToDecimal(grosze)).toBe(expected);
  });

  it("wartość niepoprawna nie wywraca renderu (fail-safe → 0.00)", () => {
    expect(groszeToDecimal(Number.NaN)).toBe("0.00");
  });
});

describe("serializeJsonLd — bramka wyjścia z kontekstu <script>", () => {
  it("ucieka </script> z treści najemcy, zachowując wartość po sparsowaniu", () => {
    const evil = "Zły</script><script>alert(1)</script>";
    const serialized = serializeJsonLd({ name: evil });

    // Żaden znacznik nie może przetrwać dosłownie…
    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<script>");
    expect(serialized).toContain("\\u003c");
    // …a mimo to JSON parsuje się do ORYGINALNEGO stringa (escape jest
    // odwracalny — nie gubimy danych, tylko wyjście z kontekstu).
    expect(JSON.parse(serialized)).toEqual({ name: evil });
  });

  it("ucieka separatory linii U+2028/U+2029", () => {
    const raw = "x\u2028y\u2029z";
    const serialized = serializeJsonLd({ a: raw });
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(JSON.parse(serialized)).toEqual({ a: raw });
  });

  it("ucieka & (encje nie mogą rozerwać atrybutów ani bloku)", () => {
    expect(serializeJsonLd({ a: "x&y" })).toContain("\\u0026");
  });
});

describe("localBusinessJsonLd — katalog sklepu", () => {
  it("niesie nazwę, adres punktu odbioru i opis z hero", () => {
    const node = localBusinessJsonLd({
      name: "Wypożyczalnia Kwiatowa",
      url: "https://acme.avably.io/store",
      description: "Sprzęt budowlany na dobę",
      address: { street: "Kwiatowa 5", zip: "00-001", city: "Warszawa" },
    });

    expect(node).toMatchObject({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Wypożyczalnia Kwiatowa",
      url: "https://acme.avably.io/store",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Kwiatowa 5",
        postalCode: "00-001",
        addressLocality: "Warszawa",
      },
    });
  });

  it("bez punktu odbioru NIE zmyśla adresu", () => {
    const node = localBusinessJsonLd({ name: "Sklep", url: "https://a.avably.io/store" });
    expect(node).not.toHaveProperty("address");
    expect(node).not.toHaveProperty("description");
  });

  it("adres z samymi nullami nie tworzy pustego PostalAddress", () => {
    const node = localBusinessJsonLd({
      name: "Sklep",
      url: "https://a.avably.io/store",
      address: { street: null, zip: null, city: null },
    });
    expect(node).not.toHaveProperty("address");
  });
});

describe("productJsonLd — Product + Offer", () => {
  const base = {
    name: "Wiertarka udarowa",
    url: "https://acme.avably.io/product/p1",
    currency: "PLN",
    basePriceDayGrosze: 12000,
  };

  it("wyraża cenę jako stawkę ZA DOBĘ (nie cenę sprzedaży)", () => {
    const node = productJsonLd(base) as Record<string, Record<string, unknown>>;
    const offer = node.offers as Record<string, unknown>;

    expect(offer.price).toBe("120.00");
    expect(offer.priceCurrency).toBe("PLN");
    // LeaseOut = wynajem, nie sprzedaż.
    expect(offer.businessFunction).toBe("http://purl.org/goodrelations/v1#LeaseOut");
    expect(offer.priceSpecification).toMatchObject({
      "@type": "UnitPriceSpecification",
      referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
    });
  });

  it("pomija opis i zdjęcia, gdy produkt ich nie ma", () => {
    const node = productJsonLd({ ...base, description: null, images: [] });
    expect(node).not.toHaveProperty("description");
    expect(node).not.toHaveProperty("image");
  });

  it("nie niesie NICZEGO spoza publicznego kontraktu", () => {
    const node = productJsonLd({
      ...base,
      description: "Opis",
      images: ["https://storage/img.jpg"],
    });

    // Zamknięta lista kluczy — nowe pole w znaczniku wymaga świadomej zmiany
    // tego testu, więc nie da się przypadkiem wypuścić danych wewnętrznych.
    expect(Object.keys(node).sort()).toEqual(
      ["@context", "@type", "description", "image", "name", "offers", "url"].sort(),
    );
  });
});

/**
 * FAQPage z sekcji strukturalnych (E1, ADR-094) — blok bez obietnic.
 *
 * Budowniczy siedzi w @avably/core (zna model treści), a serializacja i bramka
 * wyjścia z `<script>` zostają tutaj. Ten opis pilnuje styku: blok trafia na
 * stronę sklepu, przechodzi tę samą bramkę uciekania co reszta znaczników i
 * NIE POWSTAJE, kiedy nie ma czego opisać.
 */
describe("FAQPage — styk modelu treści z blokiem <script>", () => {
  it("strona bez strukturalnego FAQ nie dostaje bloku", () => {
    expect(faqPageJsonLd([])).toBeNull();
    expect(faqPageJsonLd([{ content: { heading: "FAQ", items: [{ q: "P?", a: "O." }] } }])).toBeNull();
  });

  it("pary przechodzą przez bramkę uciekania bez utraty treści", () => {
    const zle = "Czy </script><script>alert(1)</script> działa?";
    const data = faqPageJsonLd([
      {
        content: {
          v: 3,
          type: "faq",
          layout: "accordion",
          background: "default",
          allowMultiple: false,
          items: [{ q: zle, a: "Nie." }],
        },
      },
    ]);
    const serialized = serializeJsonLd(data);
    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toEqual(data);
    expect((JSON.parse(serialized).mainEntity as { name: string }[])[0]!.name).toBe(zle);
  });

  it("strona sklepu wystawia blok FAQ obok LocalBusiness", () => {
    // Kontrakt strukturalny: bez tego zdania builder mógłby działać wyśmienicie
    // i nie być nigdzie zawołany.
    const page = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "app", "(tenant)", "store", "page.tsx"),
      "utf8",
    );
    expect(page).toContain("faqPageJsonLd");
    expect(page).toMatch(/<JsonLd data=\{faqJsonLd\}/);
  });
});
