/**
 * Wspólna obsługa HTTP eksportów CSV (C2, ADR-111).
 *
 * ROUTE HANDLER POST, nie server action i nie GET:
 *   * akcja serwerowa nie umie odpowiedzieć strumieniem `text/csv`
 *     (ten sam powód co delivery-label/route.ts),
 *   * POST z ciałem formularza zamiast GET z query — zero parametrów
 *     eksportu w URL (historia przeglądarki, logi proxy). Endpoint jest
 *     wolny od skutków ubocznych, a odpowiedzi nie da się odczytać
 *     cross-origin, więc nie potrzebuje tokenu CSRF (ADR-111).
 *
 * Guard PRZED jakąkolwiek pracą: anonim dostaje 401 zanim handler tknie
 * formularz czy bazę. Błędy „miękkie" (zły zakres dat, przekroczony limit
 * wierszy) wracają redirectem 303 na ekran eksportu z kodem błędu w query
 * (kod, nie dane) — jawny komunikat zamiast cichego obcinka.
 */
import type { Role } from "@avably/db";

import { AuthError, type AuthContext } from "@/lib/auth";
import { isoDateSchema } from "@/lib/order-validation";
import { requireMember } from "@/lib/supabase-server";

import { ExportLimitError, type ExportFile } from "./common";
import { exportCatalogCsv } from "./catalog";
import { exportCustomersCsv } from "./customers";
import { exportOrdersCsv, type OrdersExportRange } from "./orders";

export type ExportKind = "orders" | "customers" | "catalog";

/** Kody błędów miękkich — ekran eksportu tłumaczy je przez next-intl. */
export type ExportErrorCode = "limit" | "zakres";

const EXPORT_SCREEN_PATH = "eksport-danych";

/**
 * Rola wymagana per zbiór (ADR-111): klienci — wyłącznie owner (hurtowy
 * zrzut danych osobowych), zamówienia i katalog — każdy członek (spójnie
 * z ekranami list i dashboardem/ADR-109).
 */
export const EXPORT_REQUIRED_ROLE: Record<ExportKind, Role | undefined> = {
  orders: undefined,
  customers: "owner",
  catalog: undefined,
};

function panelLocale(raw: string): "pl" | "en" {
  return raw === "en" ? "en" : "pl";
}

function errorRedirect(locale: string, code: ExportErrorCode): Response {
  return new Response(null, {
    status: 303,
    headers: { location: `/${locale}/${EXPORT_SCREEN_PATH}?blad=${code}` },
  });
}

/** Zakres dat z formularza; `null` = zakres nieprawidłowy (redirect `zakres`). */
async function readOrdersRange(request: Request): Promise<OrdersExportRange | null> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return null;
  }
  const range: OrdersExportRange = {};
  for (const [field, key] of [
    ["date_from", "from"],
    ["date_to", "to"],
  ] as const) {
    const raw = form.get(field);
    if (typeof raw !== "string" || raw.trim() === "") continue;
    const parsed = isoDateSchema.safeParse(raw);
    if (!parsed.success) return null;
    range[key] = parsed.data;
  }
  // Daty ISO porównują się leksykalnie; odwrócony zakres to błąd operatora,
  // nie pusty plik.
  if (range.from && range.to && range.from > range.to) return null;
  return range;
}

export async function handleExportRequest(
  request: Request,
  rawLocale: string,
  kind: ExportKind,
): Promise<Response> {
  const locale = panelLocale(rawLocale);

  // Odmowa przed jakąkolwiek pracą — guard stoi przed odczytem formularza.
  // Opt-in okna domykania (ADR-138): „zabierz swoje dane" MUSI działać w
  // oknie (RODO) — role bez zmian (klienci wyłącznie owner), zero zrzutów
  // z retencją: eksport pozostaje żądaniem uwierzytelnionej sesji.
  let ctx: AuthContext;
  try {
    ctx = await requireMember(EXPORT_REQUIRED_ROLE[kind], { closing: true });
  } catch (err) {
    if (err instanceof AuthError) return new Response(null, { status: err.status });
    throw err;
  }
  if (!ctx.tenantId) return new Response(null, { status: 403 });

  let range: OrdersExportRange = {};
  if (kind === "orders") {
    const parsed = await readOrdersRange(request);
    if (parsed === null) return errorRedirect(locale, "zakres");
    range = parsed;
  }

  const exportCtx = { supabase: ctx.supabase, tenantId: ctx.tenantId, role: ctx.role };
  let file: ExportFile;
  try {
    if (kind === "orders") file = await exportOrdersCsv(exportCtx, range);
    else if (kind === "customers") file = await exportCustomersCsv(exportCtx);
    else file = await exportCatalogCsv(exportCtx);
  } catch (err) {
    if (err instanceof ExportLimitError) return errorRedirect(locale, "limit");
    if (err instanceof AuthError) return new Response(null, { status: err.status });
    throw err;
  }

  return new Response(file.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file.filename}"`,
      "cache-control": "private, no-store",
    },
  });
}
