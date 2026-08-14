/**
 * Rdzeń konfliktu terminu z koszykiem (faza 5, ADR-179) — czyste funkcje.
 *
 * Ten plik pilnuje REGUŁY. Szew (czy powłoka pyta o właściwy termin i czy kasa
 * faktycznie znika) ma własną bramkę w `store-term.test.tsx`, a odpowiedzi bazy
 * — w `packages/db/test/public-availability-calendar.test.ts`.
 */
import { describe, expect, it } from "vitest";

import {
  cartConflicts,
  isCheckoutBlockedByConflict,
  removeConflictingLines,
} from "@/lib/cart/conflicts";
import type { PublicCatalogAvailability } from "@/lib/checkout/contract";

const ROWER = "11111111-1111-4111-8111-111111111111";
const KAJAK = "22222222-2222-4222-8222-222222222222";

function availability(rows: [string, number, number][]): PublicCatalogAvailability {
  return {
    products: rows.map(([product_id, total_units, available_units]) => ({
      product_id,
      total_units,
      available_units,
    })),
  };
}

describe("wykrywanie konfliktu", () => {
  it("pozycja mieszcząca się w dostępności NIE jest konfliktem", () => {
    const verdict = cartConflicts(
      [{ productId: ROWER, quantity: 2 }],
      availability([[ROWER, 5, 2]]),
    );
    expect(verdict).toEqual({ conflicts: [], unknown: false });
    expect(isCheckoutBlockedByConflict(verdict)).toBe(false);
  });

  it("granica jest WŁĄCZNA: dokładnie tyle sztuk, ile w koszyku, wystarcza", () => {
    // Warunek nieostry (`<=` zamiast `<`) zabierałby najemcy ostatnią sztukę
    // z każdego zamówienia — najczęstszy błąd o jeden przy takich bramkach.
    expect(
      cartConflicts([{ productId: ROWER, quantity: 3 }], availability([[ROWER, 3, 3]])).conflicts,
    ).toEqual([]);
  });

  it("mniej sztuk niż w koszyku to konflikt z podaną RÓŻNICĄ, nie samym „nie\"", () => {
    // Klient ma prawo wiedzieć, ile zostało: „wolne: 1" pozwala mu zmniejszyć
    // ilość zamiast rezygnować, a „nie ma" nie pozwala na nic.
    expect(
      cartConflicts([{ productId: ROWER, quantity: 3 }], availability([[ROWER, 5, 1]])).conflicts,
    ).toEqual([{ productId: ROWER, requested: 3, available: 1 }]);
  });

  it("pozycja NIEOBECNA w odpowiedzi katalogu jest konfliktem z zerem", () => {
    // Sprzęt wygaszony przez najemcę znika z katalogu, a wciąż siedzi
    // w koszyku klienta. Przepuszczenie go jako „brak informacji" byłoby tą
    // ścieżką, którą zamówienie wchodzi na serwer po to, żeby tam paść.
    expect(
      cartConflicts([{ productId: KAJAK, quantity: 1 }], availability([[ROWER, 5, 5]])).conflicts,
    ).toEqual([{ productId: KAJAK, requested: 1, available: 0 }]);
  });

  it("konfliktów bywa kilka i każdy wychodzi osobno", () => {
    const verdict = cartConflicts(
      [
        { productId: ROWER, quantity: 2 },
        { productId: KAJAK, quantity: 4 },
      ],
      availability([
        [ROWER, 5, 0],
        [KAJAK, 6, 1],
      ]),
    );
    expect(verdict.conflicts).toHaveLength(2);
    expect(isCheckoutBlockedByConflict(verdict)).toBe(true);
  });
});

describe("stan trzeci: nie wiemy", () => {
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: sprowadzenie „nie udało się odczytać" do jednego
  // z dwóch pozostałych stanów. Jako „wszystko zajęte" — chwilowa awaria
  // zamyka najemcy sprzedaż. Jako „wszystko wolne" bez flagi — wołający nie ma
  // jak odróżnić potwierdzonej wolności od niewiedzy.
  it("brak odpowiedzi daje `unknown`, a nie pusty werdykt", () => {
    const verdict = cartConflicts([{ productId: ROWER, quantity: 2 }], null);
    expect(verdict).toEqual({ conflicts: [], unknown: true });
  });

  it("niewiedza NIE blokuje kasy — wiążąca bramka i tak stoi na serwerze", () => {
    expect(isCheckoutBlockedByConflict({ conflicts: [], unknown: true })).toBe(false);
  });
});

describe("zdejmowanie pozycji w konflikcie", () => {
  it("znikają DOKŁADNIE pozycje z werdyktu, reszta koszyka zostaje nietknięta", () => {
    const state = {
      items: [
        { productId: ROWER, quantity: 2 },
        { productId: KAJAK, quantity: 1 },
      ],
      startDate: "2027-05-10",
      endDate: "2027-05-14",
    };
    const next = removeConflictingLines(state, {
      conflicts: [{ productId: ROWER, requested: 2, available: 0 }],
      unknown: false,
    });
    expect(next.items).toEqual([{ productId: KAJAK, quantity: 1 }]);
    // Termin zostaje: klient zdejmuje sprzęt, żeby ZOSTAĆ przy tym terminie.
    expect(next.startDate).toBe("2027-05-10");
    expect(next.endDate).toBe("2027-05-14");
  });

  it("pusty werdykt niczego nie rusza", () => {
    const state = { items: [{ productId: ROWER, quantity: 2 }], startDate: null, endDate: null };
    expect(removeConflictingLines(state, { conflicts: [], unknown: false }).items).toEqual(
      state.items,
    );
  });
});
