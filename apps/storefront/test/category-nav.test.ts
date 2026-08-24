/**
 * MENU KATEGORII (ADR-247) — derywacja pozycji z taksonomii katalogu. Czysta
 * funkcja: kolejność najemcy, licznik z `category_ids` i GUARD pustej kategorii,
 * bez dotykania sieci ani bazy.
 */
import { describe, expect, it } from "vitest";

import type { PublicCategory } from "@/lib/checkout/contract";
import { categoryNavItems, categoryPagePath } from "@/lib/catalog/category-nav";

function category(id: string, slug: string, position: number): PublicCategory {
  return { id, name: slug.toUpperCase(), slug, description: null, position };
}

describe("categoryPagePath", () => {
  it("buduje adres strony kategorii z segmentu /kategoria", () => {
    expect(categoryPagePath("namioty")).toBe("/kategoria/namioty");
  });
});

describe("categoryNavItems — pozycje menu z katalogu", () => {
  it("zachowuje kolejność najemcy i liczy pozycje z category_ids", () => {
    const catalog = {
      categories: [category("a", "namioty", 0), category("b", "kajaki", 1)],
      products: [
        { category_ids: ["a"] },
        { category_ids: ["a", "b"] },
        { category_ids: ["b"] },
      ],
    };

    const items = categoryNavItems(catalog);

    expect(items.map((item) => item.slug)).toEqual(["namioty", "kajaki"]);
    expect(items.map((item) => item.count)).toEqual([2, 2]);
    expect(items[0]!.href).toBe("/kategoria/namioty");
  });

  it("GUARD: kategoria bez ani jednej pozycji NIE wchodzi do menu", () => {
    const catalog = {
      categories: [
        category("a", "namioty", 0),
        category("pusta", "rowery", 1),
        category("b", "kajaki", 2),
      ],
      products: [{ category_ids: ["a"] }, { category_ids: ["b"] }],
    };

    const items = categoryNavItems(catalog);

    expect(items.map((item) => item.slug)).toEqual(["namioty", "kajaki"]);
    expect(items.some((item) => item.slug === "rowery")).toBe(false);
  });

  it("identyfikator produktu spoza taksonomii nie tworzy fantomowej pozycji", () => {
    const catalog = {
      categories: [category("a", "namioty", 0)],
      // Produkt wskazuje kategorię, której nie ma na liście (np. zarchiwizowaną):
      // nie ma jej jak pokazać, więc nie wchodzi do menu.
      products: [{ category_ids: ["a", "widmo"] }],
    };

    const items = categoryNavItems(catalog);

    expect(items.map((item) => item.slug)).toEqual(["namioty"]);
    expect(items[0]!.count).toBe(1);
  });

  it("katalog bez kategorii albo bez pozycji daje puste menu", () => {
    expect(categoryNavItems({ categories: [], products: [{ category_ids: [] }] })).toEqual([]);
    expect(
      categoryNavItems({ categories: [category("a", "namioty", 0)], products: [] }),
    ).toEqual([]);
  });
});
