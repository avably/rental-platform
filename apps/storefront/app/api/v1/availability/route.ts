/**
 * GET /api/v1/availability?product_id&start_date&end_date (M1, ADR-108) —
 * kalendarz dostępności produktu. Autoryzacja: `Bearer <klucz API>`;
 * tenant WYŁĄCZNIE z klucza. Rdzeń: lib/api/handlers.ts.
 */
import { availabilityDeps } from "@/lib/api/deps";
import { handleAvailabilityRequest } from "@/lib/api/handlers";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  return handleAvailabilityRequest(request, availabilityDeps(request));
}
