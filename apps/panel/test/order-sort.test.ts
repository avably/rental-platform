/**
 * Sortowanie listy zamówień (uwaga przeglądu U2): whitelist kolumn, kierunek
 * przy kliknięciu, dostępny stan nagłówka i — najważniejsze — dowód, że „#"
 * sortuje CHRONOLOGICZNIE (created_at), a nie leksykalnie po numerze.
 */
import { describe, expect, it } from "vitest";

import {
  ORDER_SORT_COLUMNS,
  DEFAULT_SORT_KEY,
  ariaSortFor,
  nextSortForKey,
  orderSortHref,
  resolveOrderSort,
} from "@/lib/orders/order-sort";
import { ORDER_SORT_KEYS } from "@/lib/order-validation";

describe("order-sort — mapa kolumn", () => {
  it("każdy klucz whitelisty ma niepustą kolumnę", () => {
    // Podłoga po pustym zbiorze: pętla musi realnie coś sprawdzić.
    expect(ORDER_SORT_KEYS.length).toBe(6);
    for (const key of ORDER_SORT_KEYS) {
      expect(ORDER_SORT_COLUMNS[key].column, key).toBeTruthy();
    }
  });

  it("kolumna # mapuje na created_at, nie na order_number (chronologia, nie tekst)", () => {
    expect(ORDER_SORT_COLUMNS.numer.column).toBe("created_at");
    expect(ORDER_SORT_COLUMNS.numer.column).not.toBe("order_number");
  });

  it("Klient sortuje po polu dołączonego zasobu customers", () => {
    expect(ORDER_SORT_COLUMNS.klient.foreignTable).toBe("customers");
    expect(ORDER_SORT_COLUMNS.klient.column).toBe("full_name");
  });
});

describe("order-sort — dowód chronologii SK-2026-9 vs SK-2026-100", () => {
  // Numer rośnie w czasie: „100" powstał PÓŹNIEJ niż „9".
  const orders = [
    { orderNumber: "SK-2026-9", createdAt: "2026-03-01T10:00:00Z" },
    { orderNumber: "SK-2026-100", createdAt: "2026-11-01T10:00:00Z" },
  ];

  it("sort po TEKŚCIE numeru stawia 9 przed 100 — błąd, którego unikamy", () => {
    const desc = [...orders].sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));
    expect(desc.map((o) => o.orderNumber)).toEqual(["SK-2026-9", "SK-2026-100"]);
  });

  it("sort po created_at (kolumna #) stawia 100 przed 9 — poprawnie", () => {
    const desc = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    expect(desc.map((o) => o.orderNumber)).toEqual(["SK-2026-100", "SK-2026-9"]);
  });
});

describe("order-sort — sort efektywny i domyślny", () => {
  it("bez parametrów: najnowsze po # (created_at malejąco)", () => {
    expect(DEFAULT_SORT_KEY).toBe("numer");
    expect(resolveOrderSort(undefined, undefined)).toEqual({ key: "numer", dir: "desc" });
  });

  it("brak kierunku → naturalny dla kolumny (kwota malejąco, klient rosnąco)", () => {
    expect(resolveOrderSort("kwota", undefined).dir).toBe("desc");
    expect(resolveOrderSort("klient", undefined).dir).toBe("asc");
  });

  it("jawny kierunek wygrywa nad naturalnym", () => {
    expect(resolveOrderSort("kwota", "asc").dir).toBe("asc");
  });
});

describe("order-sort — kliknięcie w nagłówek", () => {
  it("ta sama kolumna odwraca kierunek", () => {
    expect(nextSortForKey("numer", { key: "numer", dir: "desc" })).toEqual({
      key: "numer",
      dir: "asc",
    });
  });

  it("inna kolumna wchodzi ze swoim naturalnym kierunkiem", () => {
    expect(nextSortForKey("klient", { key: "numer", dir: "desc" })).toEqual({
      key: "klient",
      dir: "asc",
    });
  });
});

describe("order-sort — aria-sort nagłówka", () => {
  it("aktywna kolumna niesie kierunek, pozostałe bez sortu", () => {
    const current = { key: "kwota", dir: "asc" } as const;
    expect(ariaSortFor("kwota", current)).toBe("ascending");
    expect(ariaSortFor("numer", current)).toBe("none");
  });
});

describe("order-sort — href nagłówka", () => {
  it("zachowuje pozostałe parametry, podmienia sort/dir", () => {
    const href = orderSortHref(
      { q: "abc", status: "reserved", sort: "numer", dir: "desc" },
      "kwota",
      { key: "numer", dir: "desc" },
    );
    const params = new URLSearchParams(href.replace(/^\?/, ""));
    expect(params.get("q")).toBe("abc");
    expect(params.get("status")).toBe("reserved");
    expect(params.get("sort")).toBe("kwota");
    expect(params.get("dir")).toBe("desc"); // kwota: naturalny malejąco
  });

  it("pomija puste parametry, nie dubluje starego sortu", () => {
    const href = orderSortHref({ q: "", status: undefined }, "klient", { key: "numer", dir: "desc" });
    const params = new URLSearchParams(href.replace(/^\?/, ""));
    expect(params.has("q")).toBe(false);
    expect(params.has("status")).toBe(false);
    expect(params.get("sort")).toBe("klient");
    expect(params.get("dir")).toBe("asc");
  });
});
