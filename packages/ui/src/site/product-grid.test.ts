/**
 * PEŁNE RZĘDY — KONTRAKT ARTEFAKTU (E7, aneks ADR-094).
 *
 * ==================== CO TU JEST DOWODZONE ====================
 *
 * Reguła „utnij ostatni, niepełny rząd" ma DWIE połowy i tylko jedna z nich
 * jest kodem: liczbę liczy `fullRowCount` w rdzeniu (ma tam własne kontrakty na
 * licznościach 2/3/5/8), a ucięcie przy bieżącej szerokości wykonuje ARKUSZ.
 * Arkusza nie da się wywołać w teście — a reguła zapisana wyłącznie w nim jest
 * regułą, której nikt nie sprawdza.
 *
 * Ten plik jest brakującym ogniwem, dokładnie w tym samym miejscu, co
 * `role-classes.ts` przy macierzy kontrastu: składa OCZEKIWANY zapis reguły
 * z tabeli progów i szuka go w PLIKU `site.css`. Kierunek jest więc od
 * artefaktu, a nie od deklaracji obok testu (lekcja PR #83) — skasowanie reguły
 * dla trzech kolumn, podmiana selektora albo cicha zmiana progu zapala test,
 * zamiast zostawić wiszący kafel na opublikowanej stronie.
 *
 * ==================== CZEGO TU NIE MA ====================
 *
 * Nie ma pomiaru układu: jsdom nie liczy siatki ani zapytań kontenerowych, więc
 * „ile kafli naprawdę widać przy 1200 px" jest zdaniem dla przeglądarki,
 * a nie dla tego pliku. Zdanie to zostało zmierzone na żywym sklepie i stoi
 * w raporcie E7 razem ze zrzutami.
 */
import { fullRowCount } from "@avably/core/site";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PRODUCT_GRID_CLASS, PRODUCT_GRID_STEPS, orphanRuleFor } from "./structured/product-grid";
import { siteStyles } from "./template";

const ARKUSZ = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "site.css"), "utf8");

/** Porównanie odporne na przełamania wierszy i wcięcia formattera. */
const zbite = (text: string) => text.replace(/\s+/g, " ").trim();

describe("reguła pełnych rzędów STOI W ARKUSZU", () => {
  it("skan ma co czytać (kontrola pozytywna, anty-pusty-zbiór)", () => {
    expect(ARKUSZ.length, "arkusz sekcji jest pusty — kontrakt niżej nie broni niczego").toBeGreaterThan(
      1_000,
    );
    expect(PRODUCT_GRID_STEPS.length).toBeGreaterThan(0);
    expect(ARKUSZ).toContain(`.${PRODUCT_GRID_CLASS}`);
  });

  it.each(PRODUCT_GRID_STEPS)(
    "próg $query: arkusz ucina niepełny rząd przy $columns kolumnach",
    ({ query, columns }) => {
      expect(
        zbite(ARKUSZ),
        `brak reguły pełnych rzędów dla ${columns} kolumn — wiszący kafel wraca przy 5 i 8 pozycjach`,
      ).toContain(zbite(orphanRuleFor(columns)));
      expect(
        zbite(ARKUSZ),
        `reguła dla ${columns} kolumn stoi poza swoim zapytaniem kontenerowym`,
      ).toContain(zbite(`@container site ${query}`));
    },
  );

  it("progi arkusza są LUSTREM klas siatki, a nie osobną decyzją", () => {
    /*
     * Siatka przełamuje się z dwóch kolumn na trzy przy 64 rem (`productGrid`
     * w template.ts). Gdyby reguła ucinała do INNEJ liczby kolumn, niż ma
     * siatka, skutek byłby albo wiszącym kaflem mimo reguły, albo uciętym
     * rzędem, który był pełny — w obu przypadkach niewidocznym dla testów
     * liczących samą funkcję.
     */
    const klasy = siteStyles().productGrid;
    expect(klasy, "siatka produktów przestała być dwukolumnowa u podstawy").toContain("grid-cols-2");
    expect(klasy, "próg trzeciej kolumny zmienił się bez zmiany reguły w arkuszu").toContain(
      "@min-[64rem]/site:grid-cols-3",
    );
    expect(PRODUCT_GRID_STEPS.map((step) => step.columns)).toEqual([2, 3]);
  });

  it("reguła ARKUSZA i funkcja RDZENIA mówią to samo o licznościach z briefu", () => {
    /*
     * Zestawienie obu połów reguły. Selektor `:nth-child(Nn + 1)` ukrywa
     * PIERWSZY kafel niepełnego rzędu i wszystko po nim — czyli tyle kafli, ile
     * `count % columns`, chyba że niepełny rząd jest jedyny (podłoga
     * `:not(:first-child)`). Liczymy to tu wprost z SELEKTORA i porównujemy
     * z `fullRowCount`: rozjazd znaczy, że arkusz i rdzeń realizują dwie różne
     * reguły o tej samej nazwie.
     */
    for (const { columns } of PRODUCT_GRID_STEPS) {
      for (const count of [1, 2, 3, 4, 5, 8, 9]) {
        const reszta = count % columns;
        const jedynyRzad = count <= columns;
        const zArkusza = jedynyRzad ? count : count - reszta;
        expect(
          zArkusza,
          `rozjazd arkusza z rdzeniem: ${count} kafli w ${columns} kolumnach`,
        ).toBe(fullRowCount(count, columns));
      }
    }
  });

  it("jedna kolumna nie dostaje reguły — każdy rząd jest wtedy pełny", () => {
    expect(
      zbite(ARKUSZ),
      "martwa reguła dla jednej kolumny: `-n + 0` nie trafia w nic i myli czytającego",
    ).not.toContain(zbite(orphanRuleFor(1)));
  });
});
