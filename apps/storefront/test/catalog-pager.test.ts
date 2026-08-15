/**
 * OKNO NUMERÓW W NAWIGACJI KATALOGU (ADR-186).
 *
 * Funkcja jest czysta, a jej wynik zamienia się wprost na ODNOŚNIKI, więc
 * pomyłka nie jest kosmetyczna: numer, który wypadnie z okna bez przerwy,
 * to strona, do której klient nie ma jak dojść, a przerwa zamiast numeru
 * przy różnicy JEDNEJ strony to zabrane kliknięcie w miejscu, gdzie
 * oszczędność miejsca wynosi zero.
 */
import { describe, expect, it } from "vitest";

import { CATALOG_PAGER_RADIUS, catalogPagerItems } from "@/lib/catalog/catalog-pager";

describe("okno numerów stron katalogu", () => {
  it("krótki katalog wypisuje wszystkie numery, bez ani jednej przerwy", () => {
    expect(catalogPagerItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(catalogPagerItems(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it("długi katalog ZAWSZE niesie pierwszą i ostatnią stronę", () => {
    const items = catalogPagerItems(50, 100);
    expect(items[0], "zniknęła strona pierwsza — nie ma jak wrócić na początek").toBe(1);
    expect(items.at(-1), "zniknęła strona ostatnia").toBe(100);
    expect(items).toContain(50);
  });

  it("wokół bieżącej strony stoi dokładnie zadeklarowany promień", () => {
    const items = catalogPagerItems(50, 100).filter((x): x is number => x !== "gap");
    const sasiedzi = items.filter((n) => Math.abs(n - 50) <= CATALOG_PAGER_RADIUS);
    expect(sasiedzi).toEqual([48, 49, 50, 51, 52]);
  });

  it("przerwa powstaje TYLKO tam, gdzie naprawdę coś wypadło", () => {
    // Dziura o szerokości JEDNEJ strony jest gorsza niż jej numer: „1 … 3"
    // zajmuje tyle samo miejsca co „1 2 3" i odbiera jedno kliknięcie.
    expect(catalogPagerItems(4, 20)).toEqual([1, 2, 3, 4, 5, 6, "gap", 20]);
    expect(catalogPagerItems(10, 20)).toEqual([1, "gap", 8, 9, 10, 11, 12, "gap", 20]);
    expect(catalogPagerItems(18, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
  });

  it("numery są rosnące i bez powtórzeń — inaczej klucze listy się zderzą", () => {
    for (const [page, count] of [[1, 1], [1, 2], [2, 3], [7, 7], [1, 1000], [500, 1000]] as const) {
      const numery = catalogPagerItems(page, count).filter((x): x is number => x !== "gap");
      expect(numery, `strona ${page} z ${count}`).toEqual([...new Set(numery)].sort((a, b) => a - b));
    }
  });

  it("wejście spoza zakresu nie produkuje adresu, którego trasa nie obsłuży", () => {
    // Funkcja jest czysta i ma oddać sensowną listę także dla stanu, którego
    // trasa i tak nie dopuści (404) — byle nie numeru ≤ 0 albo > liczby stron,
    // bo z takiego numeru powstałby odnośnik prowadzący pod adres nieistniejący.
    for (const [page, count] of [[0, 5], [-3, 5], [99, 5], [1, 0], [1, -2]] as const) {
      const numery = catalogPagerItems(page, count).filter((x): x is number => x !== "gap");
      const stron = Math.max(1, count);
      expect(numery.every((n) => n >= 1 && n <= stron), `strona ${page} z ${count}`).toBe(true);
      expect(numery.length, `strona ${page} z ${count}: puste okno`).toBeGreaterThan(0);
    }
  });
});
