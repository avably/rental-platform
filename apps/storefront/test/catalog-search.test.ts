/**
 * NORMALIZACJA ZAPYTANIA I ADRES WYNIKÓW (ADR-263).
 *
 * Parser i builder ścieżki są JEDNYM źródłem prawdy o tym, czym jest „aktywne
 * wyszukiwanie" i jak wygląda jego adres — pole formularza, licznik i nawigacja
 * stron biorą z nich ten sam napis. Ten plik pilnuje granic: co jest brakiem
 * filtra, jak parametry układają się w adresie i że stan wyszukiwania przeżywa
 * przejście między stronami.
 */
import { describe, expect, it } from "vitest";

import {
  CATALOG_SEARCH_MAX_LENGTH,
  catalogSearchPath,
  parseCatalogSearchQuery,
} from "@/lib/catalog/catalog-search";

describe("parseCatalogSearchQuery", () => {
  it("brak parametru i pusty łańcuch to BRAK wyszukiwania (pusty wynik)", () => {
    expect(parseCatalogSearchQuery(undefined)).toBe("");
    expect(parseCatalogSearchQuery("")).toBe("");
    expect(parseCatalogSearchQuery("    ")).toBe("");
  });

  it("przycina brzegi i skleja białe znaki do pojedynczej spacji", () => {
    expect(parseCatalogSearchQuery("  wiertarka  ")).toBe("wiertarka");
    expect(parseCatalogSearchQuery("wiertarka   udarowa")).toBe("wiertarka udarowa");
    expect(parseCatalogSearchQuery("\twiertarka\nudarowa ")).toBe("wiertarka udarowa");
  });

  it("parametr powtórzony (tablica) schodzi do braku filtra, nie zgaduje wpisu", () => {
    expect(parseCatalogSearchQuery(["a", "b"])).toBe("");
  });

  it("zacisk długości chroni pole i zapytanie przed absurdalnym wejściem", () => {
    const dlugie = "x".repeat(CATALOG_SEARCH_MAX_LENGTH + 50);
    expect(parseCatalogSearchQuery(dlugie)).toHaveLength(CATALOG_SEARCH_MAX_LENGTH);
  });
});

describe("catalogSearchPath", () => {
  it("puste zapytanie na stronie pierwszej to czysty adres katalogu", () => {
    expect(catalogSearchPath(1, "")).toBe("/katalog");
    expect(catalogSearchPath(1, "   ")).toBe("/katalog");
  });

  it("puste zapytanie z numerem strony niesie tylko `strona` (jak katalog bez filtra)", () => {
    expect(catalogSearchPath(3, "")).toBe("/katalog?strona=3");
  });

  it("zapytanie na stronie pierwszej niesie tylko `q`", () => {
    expect(catalogSearchPath(1, "wiertarka")).toBe("/katalog?q=wiertarka");
  });

  it("zapytanie ZOSTAJE przy przejściu na dalszą stronę — `q` przed `strona`", () => {
    expect(catalogSearchPath(2, "wiertarka")).toBe("/katalog?q=wiertarka&strona=2");
  });

  it("koduje znaki specjalne frazy w adresie (spacja, znaki URL)", () => {
    expect(catalogSearchPath(1, "wiertarka udarowa")).toBe("/katalog?q=wiertarka%20udarowa");
    expect(catalogSearchPath(2, "kabel & wtyk")).toBe("/katalog?q=kabel%20%26%20wtyk&strona=2");
  });
});
