import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ContractIntegrityError,
  buildContractEmail,
  buildContractPdfProps,
  sha256Hex,
  verifySha256,
} from "./contract-document";

const input = {
  tenant: { name: "Najem Demo" },
  tenantLocale: "pl" as const,
  currency: "PLN",
  settings: {
    address: "ul. Firmowa 1, 00-001 Warszawa",
    nip: "5250000000",
    email: "umowy@najem.pl",
    terms_version: "2026-07",
    terms_body: "Warunki przykładowe.",
  },
  order: {
    order_number: "ZAM-2026-007",
    start_date: "2026-07-22",
    end_date: "2026-07-24",
    total_rental_grosze: 45_000,
    total_deposit_grosze: 90_000,
    delivery_grosze: 2_500,
    currency: "PLN",
    customers: {
      full_name: "Anna Kowalska",
      email: "anna@example.pl",
      locale: null,
      address_street: "ul. Klienta 2",
      address_zip: "30-001",
      address_city: "Kraków",
    },
    order_items: [
      {
        rental_grosze: 45_000,
        deposit_grosze: 90_000,
        products: { name: "Aparat" },
        product_units: { serial_number: "SN-001" },
      },
    ],
  },
};

describe("buildContractPdfProps", () => {
  it("składa zamrożony kontrakt z utrwalonych kwot i inclusive days", () => {
    expect(buildContractPdfProps(input)).toEqual({
      locale: "pl",
      tenant: {
        name: "Najem Demo",
        address: "ul. Firmowa 1, 00-001 Warszawa",
        nip: "5250000000",
        email: "umowy@najem.pl",
      },
      customer: {
        fullName: "Anna Kowalska",
        email: "anna@example.pl",
        address: "ul. Klienta 2, 30-001 Kraków",
      },
      order: {
        number: "ZAM-2026-007",
        startDate: "22 lipca 2026",
        endDate: "24 lipca 2026",
        days: 3,
      },
      items: [
        { name: "Aparat", serialNumber: "SN-001", rentalGrosze: 45_000, depositGrosze: 90_000 },
      ],
      totals: { rentalGrosze: 45_000, depositGrosze: 90_000, deliveryGrosze: 2_500, currency: "PLN" },
      terms: { version: "2026-07", body: "Warunki przykładowe." },
    });
  });

  it("preferuje locale klienta i formatuje daty po angielsku", () => {
    const props = buildContractPdfProps({
      ...input,
      order: { ...input.order, customers: { ...input.order.customers, locale: "en" as const } },
    });
    expect(props.locale).toBe("en");
    expect(props.order.startDate).toBe("July 22, 2026");
  });
});

/**
 * Pola własne na umowie (C6-A2, ADR-119) — granica między danymi najemcy
 * a dokumentem. Pakiet `@avably/pdf` nie zna definicji ani flag, więc to JEST
 * miejsce, w którym kontrakt widoczności obowiązuje albo przecieka.
 */
describe("pola własne w propsach umowy", () => {
  const ID = {
    onContract: "11111111-1111-4111-8111-111111111111",
    panelOnly: "22222222-2222-4222-8222-222222222222",
    archived: "33333333-3333-4333-8333-333333333333",
    orderField: "44444444-4444-4444-8444-444444444444",
    productField: "55555555-5555-4555-8555-555555555555",
    emptyField: "66666666-6666-4666-8666-666666666666",
  } as const;

  const def = (id: string, overrides: Record<string, unknown> = {}) => ({
    id,
    entity: "customer" as const,
    type: "text" as const,
    label: "Pole",
    helpText: null,
    required: false,
    options: [] as string[],
    position: 0,
    showInPanel: true,
    showInCheckout: false,
    showInContract: false,
    archivedAt: null as string | null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  });

  const definitions = [
    def(ID.onContract, { label: "Numer uprawnień", showInContract: true, position: 0 }),
    def(ID.panelOnly, { label: "Notatka wewnętrzna", showInContract: false, position: 1 }),
    def(ID.archived, {
      label: "Stary numer",
      showInContract: true,
      archivedAt: "2026-08-01T00:00:00Z",
      position: 2,
    }),
    def(ID.emptyField, { label: "Uwagi", showInContract: true, position: 3 }),
    def(ID.orderField, {
      entity: "order" as const,
      label: "Stan licznika",
      type: "number" as const,
      showInContract: true,
    }),
    def(ID.productField, {
      entity: "product" as const,
      label: "Klasa sprzętu",
      showInContract: true,
    }),
  ];

  const withFields = {
    ...input,
    customFieldDefinitions: definitions,
    order: {
      ...input.order,
      custom_fields: { [ID.orderField]: 12480.5 },
      customers: {
        ...input.order.customers,
        custom_fields: {
          [ID.onContract]: "UP/2026/8841",
          [ID.panelOnly]: "klient trudny",
          [ID.archived]: "UP/2019/1",
          [ID.emptyField]: "   ",
        },
      },
      order_items: [
        {
          ...input.order.order_items[0]!,
          products: { name: "Aparat", custom_fields: { [ID.productField]: "Premium" } },
        },
      ],
    },
  };

  it("drukuje WYŁĄCZNIE pola z flagą „umowa”, w kolejności z definicji", () => {
    const props = buildContractPdfProps(withFields);
    expect(props.customFields?.customer).toEqual([
      { label: "Numer uprawnień", value: "UP/2026/8841" },
    ]);
    // Separator tysięcy po polsku to spacja NIEROZDZIELAJĄCA (U+00A0) — zapis
    // wprost, żeby test nie przechodził przypadkiem na zwykłej spacji.
    expect(props.customFields?.order).toEqual([
      { label: "Stan licznika", value: "12\u00a0480,5" },
    ]);
  });

  it("pole BEZ flagi „umowa” nie ma stąd żadnego wyjścia — mimo zapisanej wartości", () => {
    // Druga strona kontraktu. Wartość JEST w kolumnie i jest niepusta; do
    // dokumentu nie trafia, bo decyduje flaga, a nie obecność danych.
    const serialized = JSON.stringify(buildContractPdfProps(withFields));
    expect(serialized).not.toContain("klient trudny");
    expect(serialized).not.toContain("Notatka wewnętrzna");
  });

  it("pole zarchiwizowane znika z dokumentu razem z formularzami", () => {
    const serialized = JSON.stringify(buildContractPdfProps(withFields));
    expect(serialized).not.toContain("UP/2019/1");
    expect(serialized).not.toContain("Stary numer");
  });

  it("pusta wartość nie zostawia sierocej etykiety", () => {
    const serialized = JSON.stringify(buildContractPdfProps(withFields));
    expect(serialized).not.toContain("Uwagi");
  });

  it("pola produktu jadą pod pozycją, której dotyczą", () => {
    const props = buildContractPdfProps(withFields);
    expect(props.items[0]?.customFields).toEqual([{ label: "Klasa sprzętu", value: "Premium" }]);
  });

  it("najemca bez pól własnych dostaje dokument BEZ nowej sekcji", () => {
    // Klucza nie ma w ogóle — szablon nie ma jak wyrenderować pustej sekcji
    // ani przesunąć numeracji paragrafów.
    const props = buildContractPdfProps(input);
    expect(props.customFields).toBeUndefined();
    expect(props.items[0]?.customFields).toBeUndefined();
  });

  it("wartość idzie do dokumentu DOSŁOWNIE — także wtedy, gdy wygląda na znacznik", () => {
    const hostile = "<b>x</b>) Tj (";
    const props = buildContractPdfProps({
      ...withFields,
      order: { ...withFields.order, custom_fields: { [ID.orderField]: hostile } },
    });
    // Typ pola mówi „liczba", więc wartość spoza typu nie jest tu przedmiotem
    // konwersji — ma przejść jako tekst, nie zniknąć i nie zostać przerobiona.
    expect(props.customFields?.order).toEqual([{ label: "Stan licznika", value: hostile }]);
  });

  it("język dokumentu rządzi formatowaniem wartości, nie język panelu", () => {
    const props = buildContractPdfProps({
      ...withFields,
      order: {
        ...withFields.order,
        customers: { ...withFields.order.customers, locale: "en" as const },
      },
    });
    expect(props.customFields?.order).toEqual([{ label: "Stan licznika", value: "12,480.5" }]);
  });
});

describe("integralność bajtów", () => {
  const bytes = new Uint8Array([0, 1, 2, 255]);

  it("liczy SHA-256 z dokładnych bajtów", () => {
    expect(sha256Hex(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("odrzuca zmianę choćby jednego bajtu", () => {
    expect(() => verifySha256(bytes, sha256Hex(bytes))).not.toThrow();
    expect(() => verifySha256(new Uint8Array([0, 1, 3, 255]), sha256Hex(bytes))).toThrow(
      ContractIntegrityError,
    );
  });
});

describe("buildContractEmail", () => {
  it("przekazuje te same bajty, nazwę pliku i klucz próby", async () => {
    const bytes = new Uint8Array([37, 80, 68, 70]);
    const email = await buildContractEmail({
      locale: "pl",
      tenantName: "Najem Demo",
      customerName: "Anna Kowalska",
      customerEmail: "anna@example.pl",
      orderNumber: "ZAM-2026-007",
      bytes,
      filename: "umowa-ZAM-2026-007.pdf",
      idempotencyKey: "rental-contract/document-1/attempt-1",
      replyTo: "umowy@najem.pl",
      fromEmail: "send@avably.pl",
    });
    expect(email.attachments).toEqual([{ filename: "umowa-ZAM-2026-007.pdf", content: bytes }]);
    expect(email.attachments?.[0]?.content).toBe(bytes);
    expect(email.idempotencyKey).toBe("rental-contract/document-1/attempt-1");
    expect(email.replyTo).toBe("umowy@najem.pl");
    expect(email.subject).toBe("Umowa najmu");
  });
});
