/**
 * POST /{locale}/eksport-danych/zamowienia — CSV zamówień (C2, ADR-111).
 * Zakres dat (start_date) idzie w ciele formularza, nie w URL.
 */
import { handleExportRequest } from "@/lib/export/route-handler";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  return handleExportRequest(request, locale, "orders");
}
