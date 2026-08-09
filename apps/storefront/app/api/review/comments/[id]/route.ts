/**
 * Zmiana uwagi przeglądu — droga storefrontowa (ADR-071, po ADR-099 RELAY).
 * Ta sama bramka co w route.ts obok; zapis wykonuje ingest panelu.
 *
 * `id` przychodzi z segmentu dynamicznego, czyli OD WOŁAJĄCEGO — zanim
 * cokolwiek wyjdzie na zewnątrz, musi mieć kształt UUID-a (takie
 * identyfikatory mają uwagi w tabelach 0033). Odrzucenie jest 404, czyli
 * DOKŁADNIE tą samą odpowiedzią co przy wyłączonym trybie przeglądu:
 * identyfikator spoza kontraktu nie jest zasobem, a jednolita odmowa nie
 * zdradza, czy narzędzie w ogóle żyje. Relay nie zostaje zawołany, więc
 * sekret relaya nie rusza się z miejsca.
 */
import { relayReviewRequest } from "@/lib/review-relay";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response("Not Found", { status: 404 });
  return relayReviewRequest(request, { resource: "comment", id });
}
