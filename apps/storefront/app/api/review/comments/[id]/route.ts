/**
 * Zmiana uwagi przeglądu — droga storefrontowa (ADR-071, po ADR-099 RELAY).
 * Ta sama bramka co w route.ts obok; zapis wykonuje ingest panelu.
 */
import { relayReviewRequest } from "@/lib/review-relay";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return relayReviewRequest(request, `/comments/${id}`);
}
