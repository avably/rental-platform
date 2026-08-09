import { createHash, timingSafeEqual } from "node:crypto";

import {
  customFieldDisplayRows,
  customFieldValuesFromColumn,
  platformFromAddress,
  rentalDaysInclusive,
  type CustomFieldDefinition,
  type Locale,
  type OutgoingEmail,
} from "@avably/core";
import { emailMessages, renderRentalContractEmail } from "@avably/emails";
import type { ContractCustomField, ContractPdfProps } from "@avably/pdf";

import type { ContractDocumentSettings } from "@/lib/contract-settings";

export interface ContractOrderRow {
  order_number: string;
  start_date: string;
  end_date: string;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  delivery_grosze: number;
  /** Waluta UTRWALONA na zamówieniu (orders.currency, 0049/ADR-103). */
  currency: string;
  /** Pola własne zamówienia (0057) — na umowę wchodzą te z flagą „umowa". */
  custom_fields?: unknown;
  customers: {
    full_name: string | null;
    email: string;
    locale?: Locale | null;
    address_street: string | null;
    address_zip: string | null;
    address_city: string | null;
    custom_fields?: unknown;
  } | null;
  order_items: Array<{
    rental_grosze: number;
    deposit_grosze: number;
    products: { name: string; custom_fields?: unknown } | null;
    product_units: { serial_number: string | null } | null;
  }>;
}

export interface BuildContractPdfPropsInput {
  tenant: { name: string };
  tenantLocale: Locale;
  currency: string;
  settings: ContractDocumentSettings;
  order: ContractOrderRow;
  /**
   * Definicje pól własnych najemcy — WSZYSTKICH encji, także tych bez flagi
   * „umowa" i zarchiwizowanych. Filtruje `customFieldDisplayRows`, czyli ta
   * sama funkcja co na ekranie; podanie tu listy już przefiltrowanej
   * przeniosłoby kontrakt widoczności do wołającego, gdzie łatwiej go zgubić.
   */
  customFieldDefinitions?: readonly CustomFieldDefinition[];
}

function formatDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "pl" ? "pl-PL" : "en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function customerAddress(customer: NonNullable<ContractOrderRow["customers"]>): string | null {
  const street = customer.address_street?.trim();
  const zip = customer.address_zip?.trim();
  const city = customer.address_city?.trim();
  return street && zip && city ? `${street}, ${zip} ${city}` : null;
}

/**
 * Pola własne jednej encji, gotowe do wydruku.
 *
 * Rdzeń oddaje pary etykieta→wartość WYŁĄCZNIE dla pól z flagą „umowa",
 * niezarchiwizowanych i z niepustą wartością — pakiet PDF nie zna definicji
 * i nie ma jak przywrócić pola, którego tu nie ma.
 */
function contractFields(
  definitions: readonly CustomFieldDefinition[],
  column: unknown,
  entity: "customer" | "order" | "product",
  locale: Locale,
): ContractCustomField[] {
  return customFieldDisplayRows(definitions, customFieldValuesFromColumn(column), {
    surface: "contract",
    entity,
    locale,
  }).map((row) => ({ label: row.label, value: row.value }));
}

/** Czyste mapowanie utrwalonych danych zamówienia na zamrożony kontrakt PDF. */
export function buildContractPdfProps(input: BuildContractPdfPropsInput): ContractPdfProps {
  const customer = input.order.customers;
  if (!customer) throw new Error("Zamówienie nie ma klienta.");
  const locale = customer.locale ?? input.tenantLocale;
  const definitions = input.customFieldDefinitions ?? [];

  const customerFields = contractFields(definitions, customer.custom_fields, "customer", locale);
  const orderFields = contractFields(definitions, input.order.custom_fields, "order", locale);

  return {
    locale,
    tenant: {
      name: input.tenant.name,
      address: input.settings.address,
      nip: input.settings.nip,
      email: input.settings.email,
    },
    customer: {
      fullName: customer.full_name?.trim() || customer.email,
      address: customerAddress(customer),
      email: customer.email,
    },
    order: {
      number: input.order.order_number,
      startDate: formatDate(input.order.start_date, locale),
      endDate: formatDate(input.order.end_date, locale),
      days: rentalDaysInclusive(input.order.start_date, input.order.end_date),
    },
    items: input.order.order_items.map((item) => {
      const productFields = contractFields(
        definitions,
        item.products?.custom_fields,
        "product",
        locale,
      );
      return {
        name: item.products?.name ?? "—",
        serialNumber: item.product_units?.serial_number ?? null,
        rentalGrosze: item.rental_grosze,
        depositGrosze: item.deposit_grosze,
        // Klucz pojawia się TYLKO wtedy, gdy jest co pokazać — pusta tablica
        // pod pozycją bez pól byłaby zaproszeniem do pustego wiersza.
        ...(productFields.length > 0 ? { customFields: productFields } : {}),
      };
    }),
    totals: {
      rentalGrosze: input.order.total_rental_grosze,
      depositGrosze: input.order.total_deposit_grosze,
      deliveryGrosze: input.order.delivery_grosze,
      currency: input.currency,
    },
    // Brak pól = brak klucza = brak sekcji w dokumencie. Umowa najemcy, który
    // pól własnych nie założył, jest co do znaku taka sama jak przed C6-A2.
    ...(customerFields.length > 0 || orderFields.length > 0
      ? {
          customFields: {
            ...(customerFields.length > 0 ? { customer: customerFields } : {}),
            ...(orderFields.length > 0 ? { order: orderFields } : {}),
          },
        }
      : {}),
    terms: { version: input.settings.terms_version, body: input.settings.terms_body },
  };
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class ContractIntegrityError extends Error {
  constructor() {
    super("Plik umowy nie zgadza się z zapisanym hashem SHA-256.");
    this.name = "ContractIntegrityError";
  }
}

export function verifySha256(bytes: Uint8Array, expected: string): void {
  const actual = Buffer.from(sha256Hex(bytes), "hex");
  const expectedBytes = /^[0-9a-f]{64}$/.test(expected) ? Buffer.from(expected, "hex") : Buffer.alloc(0);
  if (actual.length !== expectedBytes.length || !timingSafeEqual(actual, expectedBytes)) {
    throw new ContractIntegrityError();
  }
}

export interface BuildContractEmailInput {
  locale: Locale;
  tenantName: string;
  customerName: string;
  customerEmail: string;
  orderNumber: string;
  bytes: Uint8Array;
  filename: string;
  idempotencyKey: string;
  replyTo?: string;
  fromEmail?: string;
}

export async function buildContractEmail(input: BuildContractEmailInput): Promise<OutgoingEmail> {
  const rendered = await renderRentalContractEmail({
    locale: input.locale,
    tenantName: input.tenantName,
    customerName: input.customerName,
    orderNumber: input.orderNumber,
  });
  return {
    from: platformFromAddress(
      input.tenantName,
      input.fromEmail ? { fromEmail: input.fromEmail } : {},
    ),
    to: input.customerEmail,
    subject: emailMessages(input.locale).rentalContract.heading,
    html: rendered.html,
    text: rendered.text,
    attachments: [{ filename: input.filename, content: input.bytes }],
    idempotencyKey: input.idempotencyKey,
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
  };
}
