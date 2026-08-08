/**
 * Rdzeń limitu eksportu (C2, ADR-111) — recenzja PM #211, wektor 3.
 *
 * export-routes.test.ts MOCKUJE rdzeń (`mockRejectedValue(new
 * ExportLimitError())`) — przypina tłumaczenie błędu na 303, ale NIE broni
 * tego, że rdzeń faktycznie RZUCA przy przekroczeniu. Mutant „cichy obcinek"
 * (`rows.length = rowLimit; break;` zamiast throw) przechodził całą suitę
 * na zielono. Ten plik mierzy sam kontrakt stronicowania w common.ts:
 * przekroczenie limitu = ExportLimitError, nigdy przycięty wynik.
 *
 * Mały `rowLimit` (parametr fetchAllPages) zamiast budowania 10k wierszy.
 */
import { describe, expect, it } from "vitest";

import { ExportLimitError, EXPORT_PAGE_SIZE, fetchAllPages } from "@/lib/export/common";

/** Fake stronicowania: oddaje kolejne liczby aż do wyczerpania puli. */
function fakePages(total: number) {
  const calls: [number, number][] = [];
  const fetchPage = async (from: number, to: number): Promise<number[]> => {
    calls.push([from, to]);
    const page: number[] = [];
    for (let i = from; i <= to && i < total; i += 1) page.push(i);
    return page;
  };
  return { fetchPage, calls };
}

describe("fetchAllPages — twardy limit wierszy (ADR-111 D6)", () => {
  it("rowLimit+1 wierszy → ExportLimitError, ŻADNEGO cichego obcinka", async () => {
    const { fetchPage } = fakePages(4);
    await expect(fetchAllPages(fetchPage, 3)).rejects.toBeInstanceOf(ExportLimitError);
  });

  it("kontrola pozytywna: dokładnie rowLimit wierszy przechodzi i wynik ma KOMPLET", async () => {
    const { fetchPage } = fakePages(3);
    await expect(fetchAllPages(fetchPage, 3)).resolves.toEqual([0, 1, 2]);
  });

  it("limit działa też na granicy pełnych stron (wielokrotność EXPORT_PAGE_SIZE)", async () => {
    // Zbiór o 1 większy od limitu równego pełnej stronie: pierwsza strona
    // wraca pełna (== limit), dopiero druga (1 wiersz) przelewa — rdzeń musi
    // dociągnąć następną stronę i rzucić, a nie uznać pełnej strony za koniec.
    const { fetchPage, calls } = fakePages(EXPORT_PAGE_SIZE + 1);
    await expect(fetchAllPages(fetchPage, EXPORT_PAGE_SIZE)).rejects.toBeInstanceOf(
      ExportLimitError,
    );
    expect(calls).toEqual([
      [0, EXPORT_PAGE_SIZE - 1],
      [EXPORT_PAGE_SIZE, 2 * EXPORT_PAGE_SIZE - 1],
    ]);

    // ...a zbiór równy dokładnie pełnej stronie przechodzi w całości.
    const exact = fakePages(EXPORT_PAGE_SIZE);
    await expect(fetchAllPages(exact.fetchPage, EXPORT_PAGE_SIZE)).resolves.toHaveLength(
      EXPORT_PAGE_SIZE,
    );
  });
});
