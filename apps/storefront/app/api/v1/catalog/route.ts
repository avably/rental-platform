/**
 * GET /api/v1/catalog (M1, ADR-108) — katalog najemcy dla konsumenta
 * maszynowego. Autoryzacja: `Bearer <klucz API>`; tenant WYŁĄCZNIE z klucza.
 * Rdzeń i porty: lib/api/handlers.ts + lib/api/deps.ts (plik trasy może
 * eksportować wyłącznie handlery HTTP — wzorzec tras jobów panelu).
 */
import { catalogDeps } from "@/lib/api/deps";
import { handleCatalogRequest } from "@/lib/api/handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleCatalogRequest(request, catalogDeps(request));
}
