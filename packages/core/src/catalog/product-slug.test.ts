/**
 * Adres sprzętu — reguły rdzenia (ADR-182).
 *
 * Test mierzy SKUTEK, nie obecność: nie „funkcja istnieje", tylko „ten adres
 * jest zapisywalny, tamten nie, a rozstrzygnięcie rejestru oddaje 308 dokładnie
 * tam, gdzie trzeba". Zgodność z bazą (CHECK, app.slugify) pilnuje osobno
 * packages/db/test/product-slug.test.ts — dwa różne rozjazdy, dwie bramki.
 */
import { describe, expect, it } from "vitest";

import { RESERVED_CATEGORY_SLUGS } from "./categories";
import {
  PRODUCT_PATH_SEGMENT,
  isValidProductSlug,
  legacyProductPath,
  productPathFromSlug,
  productSlugById,
  resolveProductSlug,
  suggestProductSlug,
  type ProductSlugRegistry,
} from "./product-slug";

describe("segment `produkt` jest zarezerwowany", () => {
  it("strona treściowa nie może wziąć adresu `produkt`", () => {
    // To jest cicha awaria, której nikt nie zobaczy bez tej bramki: statyczna
    // trasa Next wygrywa z dynamiczną, więc strona najemcy o tym adresie
    // zapisałaby się bez błędu i NIGDY się nie wyświetliła.
    expect(RESERVED_CATEGORY_SLUGS).toContain(PRODUCT_PATH_SEGMENT);
  });

  it("angielskie `product` ZOSTAJE — stare adresy dalej mają trasę", () => {
    expect(RESERVED_CATEGORY_SLUGS).toContain("product");
  });
});

describe("kształt adresu", () => {
  it.each(["rower-gorski", "rower26", "a", "a".repeat(60)])("`%s` jest zapisywalny", (slug) => {
    expect(isValidProductSlug(slug)).toBe(true);
  });

  it.each([
    "",
    "Rower",
    "rower gorski",
    "-rower",
    "rower-",
    "rower--gorski",
    "rower/gorski",
    "rower.html",
    "rower_2",
    "rowerą",
    "a".repeat(61),
  ])("`%s` NIE jest zapisywalny", (slug) => {
    expect(isValidProductSlug(slug)).toBe(false);
  });

  it("pusty adres nie przechodzi — sprzęt nie ma odpowiednika strony głównej", () => {
    // Kontrola nazwana wprost, bo dla stron pusty slug JEST wartością
    // (HOME_PAGE_SLUG) i przeniesienie tamtej gałęzi tutaj dałoby pozycję,
    // do której nie da się dojść.
    expect(isValidProductSlug("")).toBe(false);
  });
});

describe("propozycja adresu z nazwy", () => {
  it.each([
    ["Rower górski", "rower-gorski"],
    ["ŁÓDŹ Motorowa", "lodz-motorowa"],
    ['Rower górski 26"', "rower-gorski-26"],
    ["  Namiot   4-osobowy  ", "namiot-4-osobowy"],
    ["Café & Bar", "cafe-bar"],
  ])("nazwa %s daje adres %s", (name, expected) => {
    expect(suggestProductSlug(name)).toBe(expected);
  });

  it("nazwa bez ani jednego znaku adresowalnego daje PUSTY wynik, nie śmieć", () => {
    // Wołający ma to sprawdzić: pusty wynik znaczy „brak propozycji", a baza
    // podstawi wtedy własną (app.product_slug_candidate → `sprzet`).
    expect(suggestProductSlug("???")).toBe("");
  });

  it("propozycja mieści się w limicie i nie kończy myślnikiem", () => {
    const proposal = suggestProductSlug(`${"a".repeat(58)} bbb`);
    expect(proposal.length).toBeLessThanOrEqual(60);
    expect(proposal.endsWith("-")).toBe(false);
    expect(isValidProductSlug(proposal)).toBe(true);
  });
});

describe("ścieżki", () => {
  it("adres publiczny liczy się JEDNĄ funkcją", () => {
    expect(productPathFromSlug("rower-gorski")).toBe("/produkt/rower-gorski");
  });

  it("adres zastany zostaje osiągalny jako cel 308", () => {
    expect(legacyProductPath("de3ed002-0000-4000-8000-000000000002")).toBe(
      "/product/de3ed002-0000-4000-8000-000000000002",
    );
  });
});

describe("rozstrzygnięcie adresu wobec rejestru", () => {
  const registry: ProductSlugRegistry = {
    products: [
      { id: "id-rower", slug: "rower-gorski" },
      { id: "id-namiot", slug: "namiot" },
    ],
    redirects: [{ from: "rower", to: "rower-gorski" }],
  };

  it("adres bieżący oddaje POZYCJĘ", () => {
    expect(resolveProductSlug(registry, "rower-gorski")).toEqual({
      kind: "product",
      productId: "id-rower",
      slug: "rower-gorski",
    });
  });

  it("adres stary oddaje PRZEKIEROWANIE pod adres bieżący", () => {
    expect(resolveProductSlug(registry, "rower")).toEqual({ kind: "redirect", slug: "rower-gorski" });
  });

  it("adres nieznany oddaje `null` — 404, nie zgadywanie", () => {
    expect(resolveProductSlug(registry, "czego-tu-nie-ma")).toBeNull();
  });

  it("brak rejestru oddaje `null` — fail-closed", () => {
    expect(resolveProductSlug(null, "rower-gorski")).toBeNull();
  });

  it("adres obecny PO OBU STRONACH rozstrzyga się jako pozycja, nie jako pętla 308", () => {
    // Stan, którego trigger 0083 nie dopuszcza (wpis historii dla adresu
    // właśnie zajętego jest kasowany), ale kolejność sprawdzeń ma go zamykać
    // z konstrukcji — pętla „308 sam do siebie" byłaby awarią widoczną dopiero
    // u klienta najemcy.
    const petla: ProductSlugRegistry = {
      products: [{ id: "id-rower", slug: "rower" }],
      redirects: [{ from: "rower", to: "rower" }],
    };
    expect(resolveProductSlug(petla, "rower")).toEqual({
      kind: "product",
      productId: "id-rower",
      slug: "rower",
    });
  });

  it("adres pozycji po identyfikatorze — i `null`, gdy rejestr jej nie zna", () => {
    expect(productSlugById(registry, "id-namiot")).toBe("namiot");
    expect(productSlugById(registry, "id-czego-nie-ma")).toBeNull();
    expect(productSlugById(null, "id-namiot")).toBeNull();
  });
});
