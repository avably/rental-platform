/**
 * Ingest uwag przeglądu — DROGA RELAYA STOREFRONTU (ADR-099/ADR-115).
 *
 * Po ADR-099 storefront (aplikacja PUBLICZNA) nie trzyma żadnego sekretu
 * bazy: jego trasy /api/review/** są cienkim relayem do tego endpointu,
 * a zapis service_rolem wykonuje się TUTAJ — w panelu, gdzie klucz już
 * prawowicie mieszka (webhooki ADR-054/ADR-067, joby). Bramka wejścia:
 * REVIEW_MODE=1 po stronie panelu + wspólny sekret porównywany
 * stałoczasowo (lib/review-ingest-guard.ts).
 *
 * Tabele 0033 są platformowe (bez tenant_id), payload przechodzi przez
 * schemat @avably/review (zamknięta lista powierzchni, obce pola wycięte)
 * — token relaya nie daje drogi do żadnych danych najemców.
 * created_by = null jak na dawnej drodze storefrontowej (brak sesji = brak
 * aktora).
 */
import { handleCreateRequest, handleListRequest } from "@avably/review";

import { reviewIngestClient } from "@/app/api/review/ingest/client";
import { reviewIngestGuard } from "@/lib/review-ingest-guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const denied = reviewIngestGuard(request);
  if (denied) return denied;
  return handleListRequest(reviewIngestClient(), request);
}

export async function POST(request: Request): Promise<Response> {
  const denied = reviewIngestGuard(request);
  if (denied) return denied;
  return handleCreateRequest(reviewIngestClient(), request, null);
}
