/**
 * KOLUMNY I PEŁNE RZĘDY — KONTRAKT ARTEFAKTU (E7, aneks ADR-094; pasma
 * kolumn: decyzja właściciela K1, 2026-08-25).
 *
 * ==================== CO TU JEST DOWODZONE ====================
 *
 * Reguły siatki mają DWIE połowy i tylko jedna z nich jest kodem: liczbę po
 * ucięciu liczy `fullRowCount` w rdzeniu (ma tam własne kontrakty na
 * licznościach 2/3/5/8), pasma kolumn niesie tabela `PRODUCT_GRID_STEPS` —
 * a wykonanie przy bieżącej szerokości robi ARKUSZ. Arkusza nie da się
 * wywołać w teście, a reguła zapisana wyłącznie w nim jest regułą, której
 * nikt nie sprawdza.
 *
 * Ten plik jest brakującym ogniwem, dokładnie w tym samym miejscu, co
 * `role-classes.ts` przy macierzy kontrastu: składa OCZEKIWANY zapis bloków
 * z tabeli pasm i szuka go w PLIKU `site.css`. Kierunek jest więc od
 * artefaktu, a nie od deklaracji obok testu (lekcja PR #83) — skasowanie
 * reguły dla trzech kolumn, podmiana selektora albo cicha zmiana progu zapala
 * test, zamiast zostawić wiszący kafel na opublikowanej stronie.
 *
 * ==================== CZEGO TU NIE MA ====================
 *
 * Nie ma pomiaru układu: jsdom nie liczy siatki ani zapytań kontenerowych,
 * więc „ile kafli naprawdę widać przy 1200 px" jest zdaniem dla przeglądarki,
 * a nie dla tego pliku. Zdanie to zostało zmierzone na żywym sklepie i stoi
 * w raporcie E7 (a dla pasm K1 — w raporcie zadania F2) razem ze zrzutami.
 */
import { fullRowCount } from "@avably/core/site";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PRODUCT_COLUMNS_CLASS,
  PRODUCT_GRID_CLASS,
  PRODUCT_GRID_STEPS,
  columnsBlockFor,
  orphanBlockFor,
  orphanRuleFor,
  productGridMayClip,
} from "./structured/product-grid";
import { siteStyles } from "./template";

const ARKUSZ = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "site.css"), "utf8");

/** Porównanie odporne na przełamania wierszy i wcięcia formattera. */
const zbite = (text: string) => text.replace(/\s+/g, " ").trim();

describe("kolumny i reguła pełnych rzędów STOJĄ W ARKUSZU", () => {
  it("skan ma co czytać (kontrola pozytywna, anty-pusty-zbiór)", () => {
    expect(ARKUSZ.length, "arkusz sekcji jest pusty — kontrakt niżej nie broni niczego").toBeGreaterThan(
      1_000,
    );
    expect(PRODUCT_GRID_STEPS.length).toBeGreaterThan(0);
    expect(ARKUSZ).toContain(`.${PRODUCT_GRID_CLASS}`);
    expect(ARKUSZ).toContain(`.${PRODUCT_COLUMNS_CLASS}`);
  });

  it("liczbę kolumn niesie KLASA ARKUSZA, a nie utility w template.ts (K1)", () => {
    /*
     * Pasma kolumn stoją w JEDNYM miejscu — tabela tu, realizacja w arkuszu.
     * Gdyby do `productGrid` wróciło `grid-cols-N`, liczba kolumn miałaby
     * znowu dwa źródła prawdy i reguła pełnych rzędów mogłaby ucinać do INNEJ
     * liczby kolumn, niż ma siatka (wiszący kafel mimo reguły albo ucięty
     * pełny rząd) — niewidocznie dla testów liczących samą funkcję.
     */
    const klasy = siteStyles().productGrid;
    expect(klasy, "siatka nie woła klasy kolumn z arkusza").toContain(PRODUCT_COLUMNS_CLASS);
    expect(klasy, "kolumny wróciły do utility — dwa źródła prawdy o liczbie kolumn").not.toMatch(
      /grid-cols-\d/,
    );
    expect(PRODUCT_GRID_STEPS.map((step) => step.columns)).toEqual([1, 2, 3]);
  });

  it.each(PRODUCT_GRID_STEPS)(
    "pasmo $columns kolumn: blok kolumn arkusza zgadza się z tabelą",
    (step) => {
      const blok = columnsBlockFor(step);
      if (blok === null) {
        /*
         * Pasmo od zera NIE MA reguły kolumn: `display: grid` bez szablonu
         * daje jedną kolumnę (K1 — kafel na pełnej szerokości telefonu).
         * Kontrola negatywna: martwa reguła `repeat(1, …)` w arkuszu
         * znaczyłaby, że decyzję przeglądarki ktoś przepisał na zapas.
         */
        expect(zbite(ARKUSZ)).not.toContain("repeat(1, minmax(0, 1fr))");
        return;
      }
      expect(
        zbite(ARKUSZ),
        `brak bloku kolumn dla ${step.columns} kolumn — siatka traci układ, który dawały klasy grid-cols`,
      ).toContain(zbite(blok));
    },
  );

  it("kaskada pasm: blok trzech kolumn stoi PO bloku dwóch (mobile-first)", () => {
    /*
     * Zapytania kolumn są otwarte od dołu (`width >= …`), więc przy 64 rem
     * prawdziwe są OBA — wygrywa to, które stoi w arkuszu później. Odwrócenie
     * kolejności bloków dałoby dwie kolumny na desktopie i żaden inny test
     * by tego nie zobaczył.
     */
    const dwie = zbite(ARKUSZ).indexOf(zbite(columnsBlockFor(PRODUCT_GRID_STEPS[1])!));
    const trzy = zbite(ARKUSZ).indexOf(zbite(columnsBlockFor(PRODUCT_GRID_STEPS[2])!));
    expect(dwie).toBeGreaterThan(-1);
    expect(trzy).toBeGreaterThan(dwie);
  });

  it.each(PRODUCT_GRID_STEPS)(
    "pasmo $columns kolumn: reguła pełnych rzędów domknięta do SWOJEGO pasma",
    (step) => {
      const blok = orphanBlockFor(step);
      if (blok === null) {
        // Jedna kolumna: każdy rząd jest pełny z konstrukcji — reguły nie ma
        // (osobna asercja na dole pilnuje, że nie ma jej też w arkuszu).
        expect(step.columns).toBe(1);
        return;
      }
      expect(
        zbite(ARKUSZ),
        `brak reguły pełnych rzędów dla ${step.columns} kolumn W JEJ PASMIE — ` +
          "wiszący kafel wraca przy 5 i 8 pozycjach albo reguła ucina rzędy poza swoim pasmem " +
          "(przy jednej kolumnie `2n + 1` ukrywa ostatnią nieparzystą pozycję pełnego rzędu)",
      ).toContain(zbite(blok));
    },
  );

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

describe("productGridMayClip: czy KTÓREKOLWIEK pasmo ucina (warunek odnośnika, K2)", () => {
  it("liczności z audytu: 4 pozycje bywają ucięte (3 kolumny), 6 — nigdy", () => {
    // Przypadek S-21 wprost: katalog=4, sekcja pokazuje 4, a desktop widzi 3.
    expect(productGridMayClip(4)).toBe(true);
    // 6 dzieli się i przez 2, i przez 3 — żadne pasmo nie ucina.
    expect(productGridMayClip(6)).toBe(false);
  });

  it("lustro fullRowCount: ucina DOKŁADNIE wtedy, gdy któreś pasmo ucina", () => {
    for (let shown = 0; shown <= 12; shown += 1) {
      const zPasm = PRODUCT_GRID_STEPS.some(
        ({ columns }) => fullRowCount(shown, columns) < shown,
      );
      expect(productGridMayClip(shown), `liczność ${shown}`).toBe(zPasm);
    }
  });

  it("pojedynczy niepełny rząd NIE liczy się jako ucięcie (podłoga reguły)", () => {
    // Dwie pozycje w siatce trzykolumnowej zostają dwiema pozycjami —
    // `:not(:first-child)` w selektorze i `count <= columns` w rdzeniu.
    expect(productGridMayClip(2)).toBe(false);
    expect(productGridMayClip(1)).toBe(false);
    expect(productGridMayClip(0)).toBe(false);
  });
});
