import { describe, expect, it } from "vitest";

import {
  ORDER_COLUMN_KEYS,
  ORDER_COLUMN_LABEL_KEY,
  hiddenColumnsFrom,
  serializeHiddenColumns,
  visibleColumnCount,
  withColumnVisible,
} from "@/lib/orders/order-columns";
import plMessages from "../messages/pl.json";

/**
 * Wybór widocznych kolumn listy (U5) — warstwa trwałości.
 *
 * Preferencja mieszka w `localStorage`, więc jej wartość jest NIEZAUFANA:
 * może pochodzić od użytkownika, ze starszej wersji aplikacji albo z wpisu
 * ręcznego. Test pilnuje, żeby żaden taki wsad nie wywrócił ekranu ani nie
 * ukrył kolumny, której nie ma na liście.
 */

describe("kolumny listy zamówień: trwałość wyboru", () => {
  it("brak zapisu znaczy KOMPLET kolumn (zestaw domyślny = dzisiejszy widok)", () => {
    expect(hiddenColumnsFrom(null).size).toBe(0);
    expect(hiddenColumnsFrom(undefined).size).toBe(0);
    expect(hiddenColumnsFrom("").size).toBe(0);
    expect(visibleColumnCount(hiddenColumnsFrom(null))).toBe(ORDER_COLUMN_KEYS.length);
  });

  it("zapis i odczyt są odwracalne", () => {
    const hidden = new Set<(typeof ORDER_COLUMN_KEYS)[number]>(["customer", "payment-status"]);
    const raw = serializeHiddenColumns(hidden);
    expect(hiddenColumnsFrom(raw)).toEqual(hidden);
    // Kolejność zapisu jest kolejnością kolumn — wartość jest stabilna, więc
    // dwa przełączenia tam i z powrotem nie produkują innego stringa.
    expect(raw).toBe("customer,payment-status");
  });

  it("nieznane i śmieciowe klucze są pomijane, a nie wywracają ekranu", () => {
    expect(hiddenColumnsFrom("customer,,  ,kolumna-ktorej-nie-ma,{}").size).toBe(1);
    expect([...hiddenColumnsFrom("kolumna-ktorej-nie-ma")]).toEqual([]);
    expect([...hiddenColumnsFrom(" date , amount ")]).toEqual(["date", "amount"]);
  });

  it("przełącznik nie mutuje poprzedniego zbioru", () => {
    const before = hiddenColumnsFrom("customer");
    const after = withColumnVisible(before, "amount", false);
    expect([...before]).toEqual(["customer"]);
    expect([...after].sort()).toEqual(["amount", "customer"]);
    expect([...withColumnVisible(after, "customer", true)]).toEqual(["amount"]);
  });

  it("kolumny stałe (ID, Akcje) nie są przełączalne", () => {
    // Bez nich wiersz traci kotwicę z etykietą (#117) i wejście do menu —
    // dlatego nie ma ich w zbiorze przełączników, a nie tylko w komentarzu.
    expect(ORDER_COLUMN_KEYS).not.toContain("id");
    expect(ORDER_COLUMN_KEYS).not.toContain("actions");
    expect(ORDER_COLUMN_KEYS).not.toContain("select");
  });

  it("każda kolumna ma etykietę w komunikatach — menu bez surowych kluczy", () => {
    const list = plMessages.orders.list as Record<string, string>;
    for (const key of ORDER_COLUMN_KEYS) {
      const labelKey = ORDER_COLUMN_LABEL_KEY[key];
      expect(labelKey, `brak etykiety kolumny ${key}`).toBeDefined();
      expect(list[labelKey!], `brak tłumaczenia ${labelKey}`).toBeTruthy();
    }
  });
});
