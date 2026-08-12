/**
 * PUBLICZNE POLA WŁASNE SPRZĘTU — GRANICA I FORMAT (faza 1a/1b, ADR-154).
 *
 * ==================== CO TU JEST BRONIONE ====================
 *
 * Dwa ekrany pokazują odtąd pola własne sprzętu: tabela specyfikacji na stronie
 * produktu i kafel w sekcji sprzętu. Oba czytają ten sam moduł, więc ten plik
 * jest jedynym miejscem, w którym da się zapytać, CO wolno pokazać — i pyta
 * o to z obu stron: co MA wyjść i co NIE MA prawa wyjść.
 *
 * Granica publiczna jest liczona PO DEFINICJACH, nigdy po kluczach kolumny —
 * to jest lustro zawężenia z migracji 0058. Zdjęcie tej reguły (pętla po
 * `Object.keys(product.custom_fields)`) wypuściłoby na stronę klienta każdą
 * wartość, która kiedykolwiek znalazłaby się w kolumnie z pominięciem bazy.
 */
import { describe, expect, it } from "vitest";

import type { PublicCatalogProduct, PublicCustomField } from "@/lib/checkout/contract";
import { toProductDetail, toStorefrontProducts } from "@/lib/catalog/present";
import { productFieldRows } from "@/lib/catalog/product-fields";

const WORDS = { from: "od", perDay: "doba" };

/** Definicja w kształcie, w jakim wychodzi z `app.get_public_custom_fields`. */
function definicja(overrides: Partial<PublicCustomField> = {}): PublicCustomField {
  return {
    id: "def-rodzaj",
    entity: "product",
    field_type: "text",
    label: "Rodzaj",
    help_text: null,
    required: false,
    options: [],
    ...overrides,
  };
}

function produkt(overrides: Partial<PublicCatalogProduct> = {}): PublicCatalogProduct {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Terminal satelitarny",
    description: null,
    base_price_day_grosze: 12_000,
    deposit_grosze: 30_000,
    custom_fields: {},
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    pricing_tiers: [],
    images: [],
    ...overrides,
  };
}

describe("granica publiczna: wiersze liczone PO DEFINICJACH", () => {
  it("wartość z definicją wychodzi jako para etykieta→wartość", () => {
    const rows = productFieldRows(
      produkt({ custom_fields: { "def-rodzaj": "Internet satelitarny" } }),
      [definicja()],
      "pl",
    );
    expect(rows).toEqual([{ id: "def-rodzaj", label: "Rodzaj", value: "Internet satelitarny" }]);
  });

  it("wartość BEZ definicji w kopercie sklepu NIE wychodzi", () => {
    /*
     * Klucz osierocony = pole, którego katalog publiczny nie opisał. W praktyce
     * znaczy to pole widoczne WYŁĄCZNIE w panelu (koszt zakupu, numer
     * w ewidencji): baza takich wartości nie wypuszcza, a gdyby kiedykolwiek
     * wypuściła — albo gdyby kolumnę zapisano z pominięciem bazy — ta warstwa
     * ma być drugim zamkiem, a nie sitem.
     */
    const rows = productFieldRows(
      produkt({
        custom_fields: {
          "def-rodzaj": "Internet satelitarny",
          "def-koszt-zakupu": "8400 zł",
        },
      }),
      [definicja()],
      "pl",
    );
    // Najpierw dowód, że funkcja W OGÓLE coś zwróciła — inaczej asercja niżej
    // byłaby prawdziwa po pustym zbiorze.
    expect(rows).toHaveLength(1);
    expect(rows.map((row) => row.id)).not.toContain("def-koszt-zakupu");
    expect(JSON.stringify(rows)).not.toContain("8400");
  });

  it("definicja INNEJ ENCJI nie opisuje wartości sprzętu", () => {
    /*
     * Koperta sklepu niesie definicje wszystkich trzech encji (formularz kasy
     * rysuje z nich pola klienta i zamówienia). Bez zawężenia do `product`
     * etykieta z zamówienia opisałaby wartość stojącą przy sprzęcie pod tym
     * samym identyfikatorem.
     */
    const rows = productFieldRows(
      produkt({ custom_fields: { "def-zlecenie": "ZL-2026-114" } }),
      [definicja({ id: "def-zlecenie", entity: "order", label: "Numer zlecenia" })],
      "pl",
    );
    expect(rows).toEqual([]);
  });

  it("kolejność wierszy jest kolejnością DEFINICJI, nie kolejnością kluczy", () => {
    const rows = productFieldRows(
      // Klucze celowo w odwrotnej kolejności niż definicje.
      produkt({ custom_fields: { "def-waga": "1,2 kg", "def-rodzaj": "Satelitarny" } }),
      [definicja(), definicja({ id: "def-waga", label: "Waga" })],
      "pl",
    );
    expect(rows.map((row) => row.label)).toEqual(["Rodzaj", "Waga"]);
  });
});

describe("format wartości: jedno miejsce dla sklepu, panelu i umowy", () => {
  it("pole zaznaczane mówi «Tak»/«Nie», a nie «true»", () => {
    const rows = productFieldRows(
      produkt({ custom_fields: { "def-gwarancja": true } }),
      [definicja({ id: "def-gwarancja", field_type: "checkbox", label: "Gwarancja" })],
      "pl",
    );
    expect(rows[0]?.value).toBe("Tak");
  });

  it("język zapisu idzie za sklepem — ten sam wiersz po angielsku", () => {
    const rows = productFieldRows(
      produkt({ custom_fields: { "def-gwarancja": false } }),
      [definicja({ id: "def-gwarancja", field_type: "checkbox", label: "Warranty" })],
      "en",
    );
    expect(rows[0]?.value).toBe("No");
  });

  it("wartość pusta NIE daje sierocego wiersza", () => {
    const rows = productFieldRows(
      produkt({ custom_fields: { "def-rodzaj": "   " } }),
      [definicja()],
      "pl",
    );
    expect(rows).toEqual([]);
  });

  it("definicja bez wartości przy tym sprzęcie NIE daje wiersza", () => {
    const rows = productFieldRows(produkt(), [definicja()], "pl");
    expect(rows).toEqual([]);
  });
});

describe("dwa ekrany, jedno wyjście", () => {
  const definicje = [definicja(), definicja({ id: "def-waga", label: "Waga" })];
  const sprzet = produkt({
    custom_fields: { "def-rodzaj": "Internet satelitarny", "def-waga": "1,2 kg" },
  });

  it("tabela specyfikacji i kafel pokazują DOKŁADNIE te same wiersze", () => {
    const detail = toProductDetail(sprzet, {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
      customFields: definicje,
      fieldLocale: "pl",
    });
    const [card] = toStorefrontProducts([sprzet], {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
      hrefBase: "/product/",
      customFields: definicje,
      fieldLocale: "pl",
    });

    expect(detail.specs.length, "pusty wynik uczyniłby porównanie niżej bezwartościowym").toBe(2);
    expect(card?.fields).toEqual(detail.specs);
  });

  it("bez podanych definicji oba ekrany są PUSTE, a nie wypełnione surowymi kluczami", () => {
    const detail = toProductDetail(sprzet, {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
    });
    const [card] = toStorefrontProducts([sprzet], {
      supabaseUrl: "http://h",
      currency: "PLN",
      locale: "pl",
      words: WORDS,
      hrefBase: "/product/",
    });
    expect(detail.specs).toEqual([]);
    expect(card?.fields).toEqual([]);
  });
});
