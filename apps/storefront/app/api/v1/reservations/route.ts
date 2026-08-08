/**
 * POST /api/v1/reservations (M1, ADR-108) — złożenie rezerwacji przez TEN SAM
 * rdzeń co checkout storefrontu (submitCheckoutCore przez porty — zero drugiej
 * ścieżki checkoutu). Autoryzacja: `Bearer <klucz API>`; tenant WYŁĄCZNIE
 * z klucza; zamiast captchy — klucz + podwójny rate-limit (klucz ∧ IP).
 */
import { reservationDeps } from "@/lib/api/deps";
import { handleReservationRequest } from "@/lib/api/handlers";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleReservationRequest(request, reservationDeps(request));
}
