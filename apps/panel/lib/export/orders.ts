/**
 * Eksport zamówień do CSV (C2, ADR-111).
 *
 * KOLUMNY SĄ KONTRAKTEM (stabilne, angielskie — nazwy kolumn bazy): kwoty
 * jako surowe grosze (int) + `currency` Z WIERSZA zamówienia (ADR-103 —
 * zmiana ustawienia najemcy nie ma prawa przepisać znaczenia wyeksportowanych
 * kwot; dlatego NIE formatujemy kwot do stringów z symbolem waluty).
 *
 * Filtr zakresu dat działa na `start_date` (oś „kiedy najem się zaczyna"),
 * obustronnie INCLUSIVE — spójnie z dobową semantyką zakresów w ADR-022.
 */
import { buildCsv, type CsvValue } from "./csv";
import {
  exportFilename,
  fetchAllPages,
  type ExportContext,
  type ExportFile,
} from "./common";

export const ORDERS_CSV_HEADER = [
  "order_number",
  "order_status",
  "payment_status",
  "start_date",
  "end_date",
  "customer_name",
  "customer_email",
  "total_rental_grosze",
  "total_deposit_grosze",
  "delivery_grosze",
  "currency",
  "delivery_method",
  "payment_method",
  "payment_provider",
  "created_at",
] as const;

export interface OrdersExportRange {
  /** ISO `RRRR-MM-DD`, filtr `start_date >= from` (inclusive). */
  from?: string;
  /** ISO `RRRR-MM-DD`, filtr `start_date <= to` (inclusive). */
  to?: string;
}

interface OrderExportRow {
  order_number: string;
  order_status: string;
  payment_status: string;
  start_date: string;
  end_date: string;
  delivery_method: string;
  payment_method: string | null;
  payment_provider: string | null;
  total_rental_grosze: number;
  total_deposit_grosze: number;
  delivery_grosze: number;
  currency: string;
  created_at: string;
  customers: { full_name: string | null; email: string | null } | null;
}

/** PostgREST oddaje relację 1:1 raz obiektem, raz tablicą — jak superadmin.ts. */
function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function exportOrdersCsv(
  ctx: ExportContext,
  range: OrdersExportRange = {},
): Promise<ExportFile> {
  const rows = await fetchAllPages<OrderExportRow>(async (from, to) => {
    let query = ctx.supabase
      .from("orders")
      .select(
        "order_number, order_status, payment_status, start_date, end_date, delivery_method, payment_method, payment_provider, total_rental_grosze, total_deposit_grosze, delivery_grosze, currency, created_at, customers(full_name, email)",
      )
      // Filtr tenanta jest tu ŚWIADOMIE mimo RLS: rdzeń ma nie zależeć od
      // mocy klienta, którym go zawołano (dowód mutacyjny M1 w ADR-111).
      .eq("tenant_id", ctx.tenantId)
      .order("start_date", { ascending: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (range.from) query = query.gte("start_date", range.from);
    if (range.to) query = query.lte("start_date", range.to);
    const { data, error } = await query;
    if (error) throw new Error(`Eksport zamówień: odczyt nie powiódł się (${error.code}).`);
    return (data ?? []) as unknown as OrderExportRow[];
  });

  const csvRows: CsvValue[][] = rows.map((row) => {
    const customer = singleRelation(row.customers);
    return [
      row.order_number,
      row.order_status,
      row.payment_status,
      row.start_date,
      row.end_date,
      customer?.full_name ?? null,
      customer?.email ?? null,
      row.total_rental_grosze,
      row.total_deposit_grosze,
      row.delivery_grosze,
      row.currency,
      row.delivery_method,
      row.payment_method,
      row.payment_provider,
      row.created_at,
    ];
  });

  return { filename: exportFilename("orders"), csv: buildCsv(ORDERS_CSV_HEADER, csvRows) };
}
