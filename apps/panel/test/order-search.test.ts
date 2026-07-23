/**
 * Wyszukiwarka listy (uwaga przeglądu U1): dopasowanie po numerze, kliencie
 * (nazwa + e-mail) i ETYKIECIE statusu — z dokumentowanym wyborem realizacji
 * (filtr nad odczytaną stroną, patrz komentarz w order-search.ts).
 */
import { describe, expect, it } from "vitest";

import { type OrderSearchable, filterBySearch, orderMatchesSearch } from "@/lib/orders/order-search";

function searchable(over: Partial<OrderSearchable>): OrderSearchable {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    orderNumber: "SK-2026-068",
    customerName: "Jan Kowalski",
    customerEmail: "jan@example.com",
    orderStatusLabel: "Wydane",
    paymentStatusLabel: "Opłacone",
    ...over,
  };
}

describe("orderMatchesSearch", () => {
  const row = searchable({});

  it("puste zapytanie pasuje do wszystkiego", () => {
    expect(orderMatchesSearch(row, "")).toBe(true);
    expect(orderMatchesSearch(row, "   ")).toBe(true);
  });

  it("dopasowuje po numerze zamówienia (częściowo, bez wielkości liter)", () => {
    expect(orderMatchesSearch(row, "2026-068")).toBe(true);
    expect(orderMatchesSearch(row, "sk-2026")).toBe(true);
  });

  it("dopasowuje po nazwie i e-mailu klienta", () => {
    expect(orderMatchesSearch(row, "kowalski")).toBe(true);
    expect(orderMatchesSearch(row, "jan@example")).toBe(true);
  });

  it("dopasowuje po ETYKIECIE statusu (zamówienia i płatności)", () => {
    expect(orderMatchesSearch(row, "wydane")).toBe(true);
    expect(orderMatchesSearch(row, "opłac")).toBe(true);
  });

  it("nie dopasowuje, gdy nic nie pasuje", () => {
    expect(orderMatchesSearch(row, "nagrzewnica")).toBe(false);
  });

  it("nie wywraca się na braku nazwy/e-maila klienta", () => {
    const anon = searchable({ customerName: null, customerEmail: null });
    expect(orderMatchesSearch(anon, "SK-2026")).toBe(true);
    expect(orderMatchesSearch(anon, "kowalski")).toBe(false);
  });
});

describe("filterBySearch", () => {
  const rows = [
    searchable({ id: "a", orderNumber: "SK-2026-001", customerName: "Anna Nowak" }),
    searchable({ id: "b", orderNumber: "SK-2026-002", customerName: "Piotr Zieliński" }),
  ];

  it("puste zapytanie zwraca całą listę w tej samej kolejności", () => {
    expect(filterBySearch(rows, "").map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("zawęża do pasujących i zachowuje kolejność", () => {
    expect(filterBySearch(rows, "nowak").map((r) => r.id)).toEqual(["a"]);
    expect(filterBySearch(rows, "zieliński").map((r) => r.id)).toEqual(["b"]);
  });
});
