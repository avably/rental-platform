/**
 * Wiersze koszyka kreatora — grupowanie, klamry ilości i kwoty z silnika
 * (R3-1c, uwagi właściciela 3 i 4).
 *
 * Test jest o CZYSTEJ arytmetyce koszyka, bez renderu: to jedyne miejsce,
 * w którym lista sztuk zmienia kształt, więc każde przejście (dodaj, zmień
 * ilość, usuń wiersz) musi dać się sprawdzić bez klikania.
 */
import { describe, expect, it } from "vitest";

import {
  BASKET_MAX_QUANTITY,
  BASKET_MIN_QUANTITY,
  clampQuantity,
  flattenBasketLines,
  groupBasketLines,
  parseBasketQuantity,
  removeLine,
  setLineQuantity,
  sumLineAmounts,
} from "@/app/[locale]/(panel)/zamowienia/nowe/basket-lines";

const HEATER = "00000000-0000-4000-8000-0000000000c1";
const LADDER = "00000000-0000-4000-8000-0000000000c2";

describe("wiersze koszyka — grupowanie po produkcie", () => {
  it("pusty koszyk to zero wierszy", () => {
    expect(groupBasketLines([])).toEqual([]);
  });

  it("duplikaty zwijają się w jeden wiersz z liczbą sztuk", () => {
    expect(groupBasketLines([HEATER, HEATER, LADDER])).toEqual([
      { productId: HEATER, quantity: 2 },
      { productId: LADDER, quantity: 1 },
    ]);
  });

  it("wiersz stoi w miejscu PIERWSZEGO wystąpienia, także gdy sztuki się przeplatają", () => {
    // Lista, która sama się przestawia po zmianie ilości, gubi kontekst
    // kliknięcia — kolejność jest tu kontraktem, nie efektem ubocznym.
    expect(groupBasketLines([LADDER, HEATER, LADDER])).toEqual([
      { productId: LADDER, quantity: 2 },
      { productId: HEATER, quantity: 1 },
    ]);
  });

  it("rozwinięcie wierszy wraca do płaskiej listy sztuk (kontrakt wysyłki)", () => {
    const flat = [HEATER, HEATER, LADDER];
    expect(flattenBasketLines(groupBasketLines(flat))).toEqual(flat);
  });
});

describe("ilość wiersza — klamry i odczyt z pola", () => {
  it("liczba spoza zakresu jest PRZYCINANA do klamry, a nie przyjmowana", () => {
    expect(clampQuantity(0)).toBe(BASKET_MIN_QUANTITY);
    expect(clampQuantity(-7)).toBe(BASKET_MIN_QUANTITY);
    expect(clampQuantity(BASKET_MAX_QUANTITY + 1)).toBe(BASKET_MAX_QUANTITY);
    expect(clampQuantity(1_000_000)).toBe(BASKET_MAX_QUANTITY);
  });

  it("wartość w zakresie przechodzi bez zmiany (kontrola pozytywna klamry)", () => {
    // Bez tej asercji klamra mogłaby zwracać stałą i wciąż być zielona wyżej.
    expect(clampQuantity(1)).toBe(1);
    expect(clampQuantity(7)).toBe(7);
    expect(clampQuantity(BASKET_MAX_QUANTITY)).toBe(BASKET_MAX_QUANTITY);
  });

  it("puste pole to NIE jest ilość zero — wywołujący ma zostawić stan bez zmian", () => {
    expect(parseBasketQuantity("")).toBeNull();
    expect(parseBasketQuantity("   ")).toBeNull();
  });

  it("wpis, który nie jest liczbą całkowitą sztuk, jest odrzucany", () => {
    for (const raw of ["2,5", "2.5", "-3", "abc", "1e3", "٣"]) {
      expect(parseBasketQuantity(raw), `przyjęte: ${raw}`).toBeNull();
    }
  });

  it("wklejona liczba spoza zakresu wchodzi przycięta, nie tysiącem sztuk", () => {
    expect(parseBasketQuantity("1000")).toBe(BASKET_MAX_QUANTITY);
    expect(parseBasketQuantity("0")).toBe(BASKET_MIN_QUANTITY);
    expect(parseBasketQuantity(" 3 ")).toBe(3);
  });
});

describe("zmiana ilości i usuwanie wiersza", () => {
  it("zwiększenie ilości dokłada sztuki TEGO produktu, nie ruszając reszty", () => {
    expect(setLineQuantity([HEATER, LADDER], HEATER, 3)).toEqual([
      HEATER,
      HEATER,
      HEATER,
      LADDER,
    ]);
  });

  it("zmniejszenie ilości zdejmuje sztuki, zostawiając wiersz na miejscu", () => {
    expect(setLineQuantity([HEATER, HEATER, HEATER, LADDER], HEATER, 1)).toEqual([HEATER, LADDER]);
  });

  it("ilość poza klamrą przechodzi przez tę samą klamrę, co pole", () => {
    expect(setLineQuantity([HEATER], HEATER, 0)).toEqual([HEATER]);
    expect(setLineQuantity([HEATER], HEATER, 500)).toHaveLength(BASKET_MAX_QUANTITY);
  });

  it("zmiana ilości produktu SPOZA koszyka nie dokłada nowego wiersza", () => {
    // Spóźnione zdarzenie z wiersza, którego już nie ma, ma być bez skutku.
    expect(setLineQuantity([LADDER], HEATER, 4)).toEqual([LADDER]);
  });

  it("usunięcie wiersza zdejmuje WSZYSTKIE sztuki produktu", () => {
    expect(removeLine([HEATER, LADDER, HEATER], HEATER)).toEqual([LADDER]);
  });
});

describe("kwoty wierszy — wyłącznie sumowanie wyniku silnika", () => {
  it("sztuki tego samego produktu sumują się w kwotę wiersza", () => {
    const amounts = sumLineAmounts([
      { productId: HEATER, rentalGrosze: 10_800, depositGrosze: 30_000 },
      { productId: HEATER, rentalGrosze: 10_800, depositGrosze: 30_000 },
      { productId: LADDER, rentalGrosze: 15_920, depositGrosze: 0 },
    ]);

    expect(amounts.get(HEATER)).toEqual({ rentalGrosze: 21_600, depositGrosze: 60_000 });
    expect(amounts.get(LADDER)).toEqual({ rentalGrosze: 15_920, depositGrosze: 0 });
  });

  it("produkt spoza wyceny nie dostaje kwoty zerowej, tylko żadnej", () => {
    // Zero jest kwotą („gratis"), brak wyceny nie jest — wiersz ma wtedy
    // powiedzieć, że ceny jeszcze nie ma, a nie pokazać 0,00 zł.
    const amounts = sumLineAmounts([
      { productId: HEATER, rentalGrosze: 10_800, depositGrosze: 0 },
    ]);
    expect(amounts.has(LADDER)).toBe(false);
  });

  it("pusta wycena daje pustą mapę (kontrola po pustym zbiorze)", () => {
    expect(sumLineAmounts([]).size).toBe(0);
  });
});
