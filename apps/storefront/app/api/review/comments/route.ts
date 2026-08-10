/**
 * Endpoint uwag przeglądu — DROGA STOREFRONTOWA (ADR-071, po ADR-099 RELAY).
 *
 * Storefront nie ma sesji użytkownika i po ADR-099 nie ma też ŻADNEGO sekretu
 * bazy: trasa nie dotyka Supabase, tylko przekazuje żądanie server-side do
 * ingest panelu za wspólnym sekretem (lib/review-relay.ts). Bramka
 * `isReviewSurfaceEnabled()` zamknięta → 404, jakby endpointu nigdy nie było
 * — i tak samo odpowiada druga strona relaya. Po zdjęciu Basic Auth (ADR-128)
 * bramka domyka też produkcję niezależnie od flagi REVIEW_MODE.
 */
import { relayReviewRequest } from "@/lib/review-relay";

export async function GET(request: Request): Promise<Response> {
  return relayReviewRequest(request, { resource: "comments" });
}

export async function POST(request: Request): Promise<Response> {
  return relayReviewRequest(request, { resource: "comments" });
}
