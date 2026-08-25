/**
 * Testy prezentacji katalogu (apps/storefront/lib/catalog/present.ts +
 * preview.ts). Czyste funkcje — bez bazy i bez przeglądarki.
 */
import { describe, expect, it } from "vitest";

import type { PublicCatalogProduct, PublicDeliveryMethod } from "@/lib/checkout/contract";
import {
  productPriceLabel,
  storagePublicUrl,
  toPriceParams,
  toProductDetail,
  toStorefrontProducts,
} from "@/lib/catalog/present";
import { previewDeliveryGrosze, previewTotals } from "@/lib/catalog/preview";

const WORDS = { from: "od", perDay: "doba" };

function product(overrides: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Wiertarka",
    description: "Solidna",
    base_price_day_grosze: 12_000,
    deposit_grosze: 30_000,
    custom_fields: {},
    category_ids: [],
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    pricing_tiers: [{ tier_days: 7, multiplier: 6, label: null }],
    images: [{ storage_path: "tenant/prod/a.jpg", alt_text: "Zdjęcie", sort_order: 0 }],
    ...overrides,
  };
}

describe("storagePublicUrl", () => {
  it("składa publiczny URL bucketu product-images", () => {
    expect(storagePublicUrl("http://127.0.0.1:54321", "t/p/a.jpg")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/product-images/t/p/a.jpg",
    );
  });
  it("normalizuje ukośniki na styku", () => {
    expect(storagePublicUrl("http://h/", "/t/p/a.jpg")).toBe(
      "http://h/storage/v1/object/public/product-images/t/p/a.jpg",
    );
  });
});

describe("productPriceLabel", () => {
  it("formatuje 'od <cena>/doba' w walucie i locale tenanta", () => {
    const label = productPriceLabel(product(), "PLN", "pl", WORDS);
    expect(label.startsWith("od ")).toBe(true);
    expect(label).toContain("120");
    expect(label).toContain("doba");
  });
});

describe("toStorefrontProducts", () => {
  it("mapuje produkt na kartę z linkiem, ceną i URL-em zdjęcia", () => {
    const [card] = toStorefrontProducts([product()], {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
      productHref: (id) => `/produkt/${id}`,
    });
    expect(card).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Wiertarka",
      // Adres liczy WOŁAJĄCY (ADR-182) — prezenter go już nie skleja z id.
      href: "/produkt/11111111-1111-1111-1111-111111111111",
      imageAlt: "Zdjęcie",
    });
    expect(card!.imageUrl).toContain("/product-images/tenant/prod/a.jpg");
  });

  it("bez zdjęć: imageUrl null, imageAlt = nazwa", () => {
    const [card] = toStorefrontProducts([product({ images: [] })], {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
      productHref: (id) => `/produkt/${id}`,
    });
    expect(card!.imageUrl).toBeNull();
    expect(card!.imageAlt).toBe("Wiertarka");
  });

  // Zadanie 2.7 (a11y): alt_text jest opcjonalne w product_images (0018).
  // Zdjęcie BEZ opisu nie może zostawić pustego alt — czytnik ekranu
  // przeczytałby wtedy nazwę pliku albo nic.
  it("zdjęcie z alt_text = null: imageAlt spada na nazwę produktu", () => {
    const [card] = toStorefrontProducts(
      [product({ images: [{ storage_path: "tenant/prod/a.jpg", alt_text: null, sort_order: 0 }] })],
      { supabaseUrl: "http://h", currency: "PLN", locale: "pl", words: WORDS, productHref: (id) => `/produkt/${id}` },
    );
    expect(card!.imageUrl).toContain("/product-images/tenant/prod/a.jpg");
    expect(card!.imageAlt).toBe("Wiertarka");
  });
});

describe("toProductDetail — alt galerii na podstronie produktu (Zadanie 2.7)", () => {
  it("używa alt_text, a przy jego braku nazwy produktu — per zdjęcie", () => {
    const detail = toProductDetail(
      product({
        images: [
          { storage_path: "t/p/a.jpg", alt_text: "Widok z przodu", sort_order: 0 },
          { storage_path: "t/p/b.jpg", alt_text: null, sort_order: 1 },
        ],
      }),
      { supabaseUrl: "http://h", currency: "PLN", locale: "pl", words: WORDS },
    );

    expect(detail.images.map((image) => image.alt)).toEqual(["Widok z przodu", "Wiertarka"]);
  });
});

describe("toPriceParams", () => {
  it("mapuje snake_case katalogu na PriceParams core", () => {
    expect(toPriceParams(product())).toEqual({
      basePriceDayGrosze: 12_000,
      depositGrosze: 30_000,
      autoIncrementMultiplier: 1,
      tiers: [{ tierDays: 7, multiplier: 6 }],
    });
  });
});

describe("previewTotals (tylko podgląd — nie kwota wiążąca)", () => {
  const methods: PublicDeliveryMethod[] = [
    { method: "pickup", price_grosze: 0 },
    { method: "courier", price_grosze: 1_500, free_above_grosze: 100_000 },
  ];

  it("sumuje najem i kaucję po ilości, dolicza dostawę", () => {
    // 5 dni, brak progu 7 → cena bazowa × dni: 12000 × 5 = 60000 za sztukę.
    const totals = previewTotals({
      items: [{ productId: product().id, quantity: 2 }],
      products: [product()],
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      deliveryMethod: "courier",
      deliveryMethods: methods,
    });
    expect(totals.rentalGrosze).toBe(120_000);
    expect(totals.depositGrosze).toBe(60_000);
    // rental 120000 >= free_above 100000 → dostawa darmowa.
    expect(totals.deliveryGrosze).toBe(0);
    expect(totals.totalGrosze).toBe(180_000);
  });

  it("dolicza dostawę gdy poniżej progu darmowej", () => {
    expect(previewDeliveryGrosze("courier", methods, 50_000)).toBe(1_500);
    expect(previewDeliveryGrosze("courier", methods, 100_000)).toBe(0);
    expect(previewDeliveryGrosze("pickup", methods, 0)).toBe(0);
  });

  it("raportuje pozycje bez produktu w katalogu", () => {
    const totals = previewTotals({
      items: [{ productId: "missing", quantity: 1 }],
      products: [product()],
      startDate: "2026-10-01",
      endDate: "2026-10-05",
      deliveryMethod: null,
      deliveryMethods: methods,
    });
    expect(totals.missingProductIds).toEqual(["missing"]);
    expect(totals.rentalGrosze).toBe(0);
  });

  it("zwraca zera przy odwróconym/niepełnym terminie", () => {
    const totals = previewTotals({
      items: [{ productId: product().id, quantity: 1 }],
      products: [product()],
      startDate: "2026-10-05",
      endDate: "2026-10-01",
      deliveryMethod: "pickup",
      deliveryMethods: methods,
    });
    expect(totals.totalGrosze).toBe(0);
  });
});

describe("productPriceLabel: atomowość frazy ceny (S-40)", () => {
  // Lustro reguły z pricingPriceLabel (@avably/core): token „kwota / doba”
  // spięty twardymi spacjami, żeby karta na 360 px nie łamała ceny w środku —
  // a po „od” zwykła spacja, żeby cała etykieta nie rozpychała wiersza (S-12).
  it("token „kwota / doba” spięty twardą spacją, przedrostek po zwykłej", () => {
    const label = productPriceLabel(product(), "PLN", "pl", WORDS);
    expect(label).toContain("\u00A0/\u00A0doba");
    expect(label, "zwykła spacja przy ukośniku — cena znowu pęknie w środku").not.toMatch(/ \/|\/ /);
    expect(label.startsWith("od ")).toBe(true);
    expect(label.charAt(2)).toBe(" ");
  });
});
