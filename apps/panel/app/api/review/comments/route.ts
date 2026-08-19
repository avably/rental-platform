/**
 * Endpoint uwag przeglądu — DROGA PANELOWA (ADR-071, rozdział ADR-206).
 *
 * ZAPIS (POST) i PRZEGLĄD (GET) mają od ADR-206 RÓŻNE bramki:
 *  - POST — bramka zapisu (lib/review-write-guard.ts): REVIEW_MODE=1 +
 *    rate limit po IP, BEZ superadmina — właściciel komentuje także na
 *    rejestracji i onboardingu, gdzie sesji superadmina nie ma. Zapis idzie
 *    service_rolem (szew app/api/review/client.ts); RLS 0033 zostaje
 *    superadminowe jako obrona w głąb. POST zwraca WYŁĄCZNIE utworzoną
 *    uwagę (201) — nigdy listy cudzych uwag.
 *  - GET — bramka przeglądu (lib/review-guard.ts): REVIEW_MODE=1 + sesja
 *    superadmina z żywym odczytem (ADR-127), egzekucja w RLS 0033.
 *    Wszyscy zostawiają uwagi, TYLKO właściciel je czyta — zdjęcie
 *    superadmina z tej gałęzi jest regresją.
 *
 * Poza trybem przeglądu (REVIEW_MODE≠1) obie gałęzie odpowiadają 404 —
 * narzędzie wewnętrzne nie zdradza swojego istnienia (wzorzec /admin).
 */
import { handleCreateRequest, handleListRequest } from "@avably/review";

import { reviewServiceClient } from "@/app/api/review/client";
import { reviewGuard } from "@/lib/review-guard";
import { reviewWriteGuard } from "@/lib/review-write-guard";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const ctx = await reviewGuard();
  if (ctx instanceof Response) return ctx;
  return handleListRequest(ctx.supabase, request);
}

export async function POST(request: Request): Promise<Response> {
  const gate = await reviewWriteGuard(request);
  if (gate instanceof Response) return gate;
  return handleCreateRequest(reviewServiceClient(), request, gate.createdBy);
}
