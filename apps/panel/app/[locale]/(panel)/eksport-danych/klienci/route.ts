/**
 * POST /{locale}/eksport-danych/klienci — CSV klientów (C2, ADR-111).
 * Wyłącznie owner: hurtowy zrzut danych osobowych (bramka w rdzeniu
 * eksportu + requireMember("owner") w handlerze).
 */
import { handleExportRequest } from "@/lib/export/route-handler";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ locale: string }> },
): Promise<Response> {
  const { locale } = await params;
  return handleExportRequest(request, locale, "customers");
}
