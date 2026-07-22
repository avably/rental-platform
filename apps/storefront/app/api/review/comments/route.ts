/**
 * Endpoint uwag przeglądu — DROGA STOREFRONTOWA (ADR-071).
 *
 * Storefront nie ma sesji (całość siedzi za hasłem site'u — proxy.ts, #106),
 * więc zapis idzie klientem SERVICE_ROLE. To ŚWIADOMY, wąski wyjątek od
 * reguły „service_role tylko webhooki/joby" (scripts/audit-service-role.sh
 * dopuszcza apps/*\/app/api/review/**): endpoint jest podwójnie bramkowany
 * (REVIEW_MODE=1 w env deploymentu + Basic Auth w proxy ZANIM żądanie tu
 * dotrze), nie dotyka ŻADNYCH danych najemcy (tabele 0033 są platformowe,
 * bez tenant_id) i znika z produkcji razem z REVIEW_MODE na go-live.
 * REVIEW_MODE wyłączony → 404, jakby endpointu nigdy nie było.
 */
import { handleCreateRequest, handleListRequest } from "@avably/review";
import { createServiceClient } from "@avably/db/service";

function reviewDisabled(): Response | null {
  return process.env.REVIEW_MODE === "1" ? null : new Response("Not Found", { status: 404 });
}

export async function GET(request: Request): Promise<Response> {
  const disabled = reviewDisabled();
  if (disabled) return disabled;
  return handleListRequest(createServiceClient(), request);
}

export async function POST(request: Request): Promise<Response> {
  const disabled = reviewDisabled();
  if (disabled) return disabled;
  // Brak sesji na storefroncie → brak aktora; wiersz nosi created_by = null.
  return handleCreateRequest(createServiceClient(), request, null);
}
