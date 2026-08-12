import { describe, expect, it } from "vitest";

import {
  countDeployedToday,
  DEPLOYED_ORDER_STATUSES,
  deploymentCellProps,
  isDeployedToday,
  type DeployedItemRow,
} from "@/lib/catalog/deployed-today";

/**
 * „DZIŚ W TERENIE" — definicja przypięta z OBU STRON (U8a, ADR-145).
 *
 * Ta liczba jest miejscem, w którym najłatwiej wyprodukować w produkcie drugą,
 * niezgodną wartość: „w terenie" bardzo łatwo pomylić z „niedostępny w
 * terminie". Dlatego każdy test ma parę: co się LICZY i co się NIE LICZY —
 * asercja „liczy 3" sama przeszłaby również w implementacji, która liczy
 * wszystko jak leci.
 */

const TODAY = "2026-08-12";

function item(over: Partial<DeployedItemRow> & { orders?: DeployedItemRow["orders"] }): DeployedItemRow {
  return {
    product_id: "p1",
    unit_id: "u1",
    orders: { start_date: TODAY, end_date: TODAY, order_status: "picked_up" },
    ...over,
  };
}

describe("dziś w terenie — predykat pozycji", () => {
  it("LICZY pozycję wydaną, której zakres obejmuje dziś", () => {
    expect(
      isDeployedToday(
        item({ orders: { start_date: "2026-08-10", end_date: "2026-08-14", order_status: "picked_up" } }),
        TODAY,
      ),
    ).toBe(true);
  });

  it("NIE liczy rezerwacji — rower na jutro FIZYCZNIE stoi w magazynie", () => {
    // Sedno definicji: `reserved` i `ready_for_pickup` blokują DOSTĘPNOŚĆ,
    // ale nie są nieobecnością sprzętu. Gdyby ta asercja padła, kolumna
    // zaczęłaby odpowiadać na inne pytanie niż jej nazwa.
    for (const status of ["reserved", "ready_for_pickup", "pending"]) {
      expect(
        isDeployedToday(
          item({ orders: { start_date: "2026-08-10", end_date: "2026-08-14", order_status: status } }),
          TODAY,
        ),
        `status ${status} policzony jako „w terenie"`,
      ).toBe(false);
    }
  });

  it("NIE liczy najmu zwróconego ani anulowanego, nawet gdy daty obejmują dziś", () => {
    for (const status of ["returned", "cancelled"]) {
      expect(
        isDeployedToday(
          item({ orders: { start_date: "2026-08-10", end_date: "2026-08-14", order_status: status } }),
          TODAY,
        ),
        `status ${status} policzony jako „w terenie"`,
      ).toBe(false);
    }
  });

  it("granice zakresu są INCLUSIVE, a dzień poza zakresem nie liczy się", () => {
    const cases: [string, string, boolean][] = [
      [TODAY, TODAY, true], // najem jednodniowy — dziś
      ["2026-08-12", "2026-08-20", true], // pierwszy dzień
      ["2026-08-01", "2026-08-12", true], // ostatni dzień (zwrot jest dziś)
      ["2026-08-13", "2026-08-20", false], // zaczyna się jutro
      ["2026-08-01", "2026-08-11", false], // skończył się wczoraj
    ];
    for (const [start, end, expected] of cases) {
      expect(
        isDeployedToday(item({ orders: { start_date: start, end_date: end, order_status: "picked_up" } }), TODAY),
        `${start}..${end} vs ${TODAY}`,
      ).toBe(expected);
    }
  });

  it("pozycja BEZ przypisanego egzemplarza LICZY SIĘ (unit_id jest NULLABLE)", () => {
    // Sprzęt wyjechał niezależnie od tego, czy magazyn wskazał sztukę.
    expect(isDeployedToday(item({ unit_id: null }), TODAY)).toBe(true);
  });

  it("pozycja bez zamówienia (brak osadzenia) nie wywraca się i nie liczy", () => {
    expect(isDeployedToday(item({ orders: null }), TODAY)).toBe(false);
  });

  it("lista statusów „w terenie” jest WĘŻSZA niż lista blokująca dostępność", () => {
    // Kontrola świadomości: gdyby ktoś podmienił źródło na
    // AVAILABILITY_BLOCKING_ORDER_STATUSES, ten test pokaże różnicę.
    expect([...DEPLOYED_ORDER_STATUSES]).toEqual(["picked_up"]);
  });
});

describe("dziś w terenie — agregat per produkt", () => {
  const items: DeployedItemRow[] = [
    item({ product_id: "rower", unit_id: "u1" }),
    item({ product_id: "rower", unit_id: null }),
    item({
      product_id: "rower",
      unit_id: "u3",
      orders: { start_date: "2026-08-20", end_date: "2026-08-22", order_status: "picked_up" },
    }),
    item({
      product_id: "kajak",
      unit_id: "u4",
      orders: { start_date: "2026-08-10", end_date: "2026-08-30", order_status: "reserved" },
    }),
    item({ product_id: "namiot", unit_id: "u5" }),
  ];

  it("liczy pozycje per produkt i pomija te spoza definicji", () => {
    const counts = countDeployedToday(items, TODAY);
    expect(counts.get("rower")).toBe(2);
    expect(counts.get("namiot")).toBe(1);
    // Produkt wyłącznie z rezerwacją NIE trafia do mapy — widok czyta go jako 0.
    expect(counts.has("kajak")).toBe(false);
  });

  it("pusta lista pozycji daje pustą mapę (a nie zera z powietrza)", () => {
    expect(countDeployedToday([], TODAY).size).toBe(0);
  });
});

describe("dziś w terenie — oś prezentacji", () => {
  it("rozróżnia brak / część / komplet i nie miesza się z osią publikacji", () => {
    expect(deploymentCellProps(0, 6)).toMatchObject({
      "data-catalog-axis": "deployment",
      "data-catalog-value": "none",
    });
    expect(deploymentCellProps(3, 6)["data-catalog-value"]).toBe("partial");
    expect(deploymentCellProps(6, 6)["data-catalog-value"]).toBe("all");
  });

  it("nadwyżka nad ewidencją sztuk zostaje „all”, a liczby NIE przycinamy", () => {
    // 5 pozycji w terenie przy 3 egzemplarzach = ewidencja nie nadąża.
    // Przycięcie do „3 z 3” ukryłoby ten sygnał przed operatorem.
    expect(deploymentCellProps(5, 3)["data-catalog-value"]).toBe("all");
  });
});
