/**
 * Pola własne na wejściu zamawiania (C6-A3, ADR-121) — warstwa rdzenia
 * sklepu, wspólna dla formularza i publicznego API v1.
 *
 * Co tu dowodzimy: że mapa z NIEZAUFANEGO wejścia zamienia się w dwie mapy
 * do kolumn bazy, że klucz spoza zbioru pól zamawiania dostaje NAZWANĄ odmowę
 * (a nie ciche pominięcie) i że wartości przychodzące stringiem oraz typowane
 * kończą tą samą walidacją.
 */
import { describe, expect, it } from "vitest";

import { customFieldsFromPublicRows, readCheckoutCustomFields } from "@/lib/checkout/custom-fields";
import type { PublicCustomField } from "@/lib/checkout/contract";

const ID = {
  text: "11111111-1111-4111-8111-111111111111",
  number: "22222222-2222-4222-8222-222222222222",
  checkbox: "33333333-3333-4333-8333-333333333333",
  select: "44444444-4444-4444-8444-444444444444",
  customer: "55555555-5555-4555-8555-555555555555",
  product: "66666666-6666-4666-8666-666666666666",
} as const;

function row(overrides: Partial<PublicCustomField> & { id: string }): PublicCustomField {
  return {
    entity: "order",
    field_type: "text",
    label: "Pole",
    help_text: null,
    required: false,
    options: [],
    ...overrides,
  };
}

const DEFINITIONS = customFieldsFromPublicRows([
  row({ id: ID.text }),
  row({ id: ID.number, field_type: "number" }),
  row({ id: ID.checkbox, field_type: "checkbox" }),
  row({ id: ID.select, field_type: "select", options: ["Alfa", "Beta"] }),
  row({ id: ID.customer, entity: "customer", field_type: "phone" }),
  row({ id: ID.product, entity: "product" }),
]);

describe("kształt publiczny definicji", () => {
  it("kolejność niesie TABLICA, nie znacznik czasu konfiguracji", () => {
    // Publiczny wiersz nie ma `created_at` ani `position` — pozycję odtwarza
    // indeks, bo baza oddaje wiersze już posortowane.
    expect(DEFINITIONS.map((definition) => definition.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(DEFINITIONS.every((definition) => definition.createdAt === null)).toBe(true);
  });

  it("flagi panelu i umowy są FAŁSZEM, nie zgadywane", () => {
    // Publiczna odpowiedź ich nie niesie i nieść nie powinna. Fail-closed:
    // każde użycie flagi panelu w kodzie publicznym ma być widocznym błędem.
    expect(DEFINITIONS.every((definition) => !definition.showInPanel)).toBe(true);
    expect(DEFINITIONS.every((definition) => !definition.showInContract)).toBe(true);
    expect(DEFINITIONS.every((definition) => definition.showInCheckout)).toBe(true);
  });
});

describe("odczyt wartości z wejścia zamawiania", () => {
  it("rozdziela płaską mapę na kolumny zamówienia i klienta", () => {
    const result = readCheckoutCustomFields(DEFINITIONS, {
      [ID.text]: "ABC-123",
      [ID.customer]: "123456789",
    });

    expect(result.fields).toEqual({});
    // Checkbox bez wpisu jest `false`, nie brakiem klucza — patrz przypadek niżej.
    expect(result.order).toEqual({ [ID.text]: "ABC-123", [ID.checkbox]: false });
    expect(result.customer).toEqual({ [ID.customer]: "123456789" });
  });

  it("przyjmuje wartości TYPOWANE (konsument JSON-owy) i STRINGOWE (formularz)", () => {
    const typed = readCheckoutCustomFields(DEFINITIONS, {
      [ID.number]: 12.5,
      [ID.checkbox]: true,
    });
    const stringy = readCheckoutCustomFields(DEFINITIONS, {
      // Przecinek dziesiętny — tak pisze polski klient w polu tekstowym.
      [ID.number]: "12,5",
      [ID.checkbox]: "on",
    });

    expect(typed.fields).toEqual({});
    expect(stringy.fields).toEqual({});
    expect(typed.order[ID.number]).toBe(12.5);
    expect(stringy.order[ID.number]).toBe(12.5);
    expect(typed.order[ID.checkbox]).toBe(true);
    expect(stringy.order[ID.checkbox]).toBe(true);
  });

  it("brak checkboksa w wejściu znaczy `false`, a nie „pole pominięte”", () => {
    const result = readCheckoutCustomFields(DEFINITIONS, {});
    expect(result.order[ID.checkbox]).toBe(false);
  });

  it("pole WYMAGANE liczy się z definicji, nie z tego, co przyszło", () => {
    const required = customFieldsFromPublicRows([row({ id: ID.text, required: true })]);
    const result = readCheckoutCustomFields(required, undefined);
    expect(result.fields[`cf_${ID.text}`]).toBe("required");
  });

  it("wartość spoza listy opcji dostaje odmowę przy polu", () => {
    const result = readCheckoutCustomFields(DEFINITIONS, { [ID.select]: "Gamma" });
    expect(result.fields[`cf_${ID.select}`]).toBe("invalid");
    expect(result.order[ID.select]).toBeUndefined();
  });

  it("klucz spoza zbioru pól zamawiania dostaje NAZWANĄ odmowę, nie ciche pominięcie", () => {
    // Ciche pominięcie byłoby bezpieczne (wartość i tak nie trafi do bazy),
    // ale kłamliwe: konsument dostałby 201 na żądanie, którego części nie
    // wykonaliśmy.
    const unknown = "99999999-9999-4999-8999-999999999999";
    const result = readCheckoutCustomFields(DEFINITIONS, { [unknown]: "wartość" });
    expect(result.fields[`cf_${unknown}`]).toBe("not_allowed");
  });

  it("definicja PRODUKTU jest do czytania w katalogu, nie do pisania z formularza", () => {
    const result = readCheckoutCustomFields(DEFINITIONS, { [ID.product]: "numer seryjny" });
    expect(result.fields[`cf_${ID.product}`]).toBe("not_allowed");
    // Wynik nie ma nawet POLA na encję produktu — kontrakt niesie dwie mapy,
    // bo w bazie są dwie kolumny do zapisania z zamawiania.
    expect(result.order[ID.product]).toBeUndefined();
    expect(result.customer[ID.product]).toBeUndefined();
  });

  it("obiekt pod kluczem pola nie jest wartością żadnego z typów", () => {
    const result = readCheckoutCustomFields(DEFINITIONS, {
      [ID.text]: { zagnieżdżony: true } as unknown as string,
    });
    expect(result.fields[`cf_${ID.text}`]).toBe("invalid");
  });

  it("przekroczony rozmiar CAŁEJ mapy trafia pod klucz zbiorczy, nie pod pole", () => {
    const many = customFieldsFromPublicRows(
      Array.from({ length: 6 }, (_, index) =>
        row({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`, field_type: "textarea" }),
      ),
    );
    const values = Object.fromEntries(many.map((d) => [d.id, "ą".repeat(2000)]));
    const result = readCheckoutCustomFields(many, values);
    expect(result.fields.customFields).toBe("too_long");
  });
});
