/**
 * POST /{locale}/eksport-danych/katalog — CSV katalogu (C2, ADR-111).
 * Format wymiany pod re-import (C3): produkt × próg, kolumny stabilne.
 */
import { handleExportRequest } from "@/lib/export/route-handler";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  return handleExportRequest(request, locale, "catalog");
}
