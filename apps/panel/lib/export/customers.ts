/**
 * Eksport klientów do CSV (C2, ADR-111) — dane kontaktowe + dane do faktury
 * + liczba zamówień.
 *
 * BRAMKA ROLI ŻYJE TUTAJ, w warstwie serwera: hurtowy zrzut danych osobowych
 * wszystkich klientów to najcięższy z trzech eksportów, więc dostaje go
 * WYŁĄCZNIE owner (ADR-111; zamówienia i katalog — każdy członek, spójnie
 * z dashboardem/ADR-109). Route handler dodatkowo woła requireMember("owner")
 * — dwie warstwy jak w team-actions, ale to TA bramka jest autorytatywna
 * i to ją mierzy dowód mutacyjny M3.
 *
 * `orders_count` liczy baza (agregat osadzony PostgREST `orders(count)`) —
 * zero dociągania wierszy zamówień tylko po to, żeby je policzyć w pamięci.
 */
import { AuthError } from "@/lib/auth";

import { buildCsv, type CsvValue } from "./csv";
import {
  exportFilename,
  fetchAllPages,
  type ExportContext,
  type ExportFile,
} from "./common";

export const CUSTOMERS_CSV_HEADER = [
  "email",
  "full_name",
  "phone",
  "company_name",
  "nip",
  "address_street",
  "address_zip",
  "address_city",
  "locale",
  "orders_count",
  "created_at",
] as const;

interface CustomerExportRow {
  email: string;
  full_name: string | null;
  phone: string | null;
  company_name: string | null;
  nip: string | null;
  address_street: string | null;
  address_zip: string | null;
  address_city: string | null;
  locale: string | null;
  created_at: string;
  orders: { count: number }[] | null;
}

export async function exportCustomersCsv(ctx: ExportContext): Promise<ExportFile> {
  // Odmowa PRZED jakąkolwiek pracą — bramka roli stoi przed pierwszym
  // odczytem, nie po nim.
  if (ctx.role !== "owner") {
    throw new AuthError(403, "Eksport klientów jest dostępny wyłącznie dla właściciela.");
  }

  const rows = await fetchAllPages<CustomerExportRow>(async (from, to) => {
    const { data, error } = await ctx.supabase
      .from("customers")
      .select(
        "email, full_name, phone, company_name, nip, address_street, address_zip, address_city, locale, created_at, orders(count)",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Eksport klientów: odczyt nie powiódł się (${error.code}).`);
    return (data ?? []) as unknown as CustomerExportRow[];
  });

  const csvRows: CsvValue[][] = rows.map((row) => [
    row.email,
    row.full_name,
    row.phone,
    row.company_name,
    row.nip,
    row.address_street,
    row.address_zip,
    row.address_city,
    row.locale,
    row.orders?.[0]?.count ?? 0,
    row.created_at,
  ]);

  return { filename: exportFilename("customers"), csv: buildCsv(CUSTOMERS_CSV_HEADER, csvRows) };
}
