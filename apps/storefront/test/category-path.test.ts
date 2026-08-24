/**
 * ADRES I SORTOWANIE STRONY KATEGORII (faza C, ADR-247).
 *
 * Pilnuje trzech rozstrzygnięć z `lib/catalog/category-path.ts`: strona
 * pierwsza i sort domyślny NIE noszą parametru (kanon czystej strony pokrywa
 * widok domyślny), sort nieznany/tablicowy schodzi do domyślnego (fail-soft),
 * a mapowanie na `p_sort` bazy zamienia domyślną „nazwę" na `catalog`.
 */
import { describe, expect, it } from "vitest";

import {
  categoryBasePath,
  categoryPagePath,
  categorySortToDb,
  CATEGORY_SORT_DEFAULT,
  parseCategorySortParam,
} from "@/lib/catalog/category-path";

describe("adres strony kategorii", () => {
  it("strona 1 + sort domyślny to adres CZYSTY (kanon)", () => {
    expect(categoryPagePath("rowery")).toBe("/kategoria/rowery");
    expect(categoryPagePath("rowery", 1, "name")).toBe("/kategoria/rowery");
    expect(categoryBasePath("rowery")).toBe("/kategoria/rowery");
  });

  it("numer strony > 1 nosi `strona`, sort inny niż domyślny nosi `sort`", () => {
    expect(categoryPagePath("rowery", 3)).toBe("/kategoria/rowery?strona=3");
    expect(categoryPagePath("rowery", 1, "price_asc")).toBe("/kategoria/rowery?sort=price_asc");
  });

  it("sort i numer strony w JEDNYM adresie: sort przed strona (kolejność stała)", () => {
    expect(categoryPagePath("rowery", 2, "newest")).toBe("/kategoria/rowery?sort=newest&strona=2");
  });
});

describe("parsowanie sortu z adresu", () => {
  it("znane wartości przechodzą", () => {
    expect(parseCategorySortParam("price_asc")).toBe("price_asc");
    expect(parseCategorySortParam("price_desc")).toBe("price_desc");
    expect(parseCategorySortParam("newest")).toBe("newest");
  });

  it("brak, jawne `name`, literówka i tablica schodzą do domyślnego", () => {
    expect(parseCategorySortParam(undefined)).toBe(CATEGORY_SORT_DEFAULT);
    expect(parseCategorySortParam("name")).toBe(CATEGORY_SORT_DEFAULT);
    expect(parseCategorySortParam("byle-co")).toBe(CATEGORY_SORT_DEFAULT);
    expect(parseCategorySortParam(["price_asc", "newest"])).toBe(CATEGORY_SORT_DEFAULT);
  });
});

describe("mapowanie sortu na p_sort bazy", () => {
  it("domyślna nazwa to `catalog`, reszta 1:1", () => {
    expect(categorySortToDb("name")).toBe("catalog");
    expect(categorySortToDb("price_asc")).toBe("price_asc");
    expect(categorySortToDb("price_desc")).toBe("price_desc");
    expect(categorySortToDb("newest")).toBe("newest");
  });
});
