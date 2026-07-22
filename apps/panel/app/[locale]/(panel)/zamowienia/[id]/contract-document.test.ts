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
