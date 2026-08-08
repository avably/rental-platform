/**
 * Endpoint uwag przeglądu — DROGA STOREFRONTOWA (ADR-071, po ADR-099 RELAY).
 *
 * Storefront nie ma sesji (całość siedzi za hasłem site'u — proxy.ts, #106)
 * i po ADR-099 nie ma też ŻADNEGO sekretu bazy: trasa nie dotyka Supabase,
 * tylko przekazuje żądanie server-side do ingest panelu za wspólnym
 * sekretem (lib/review-relay.ts). REVIEW_MODE wyłączony → 404, jakby
 * endpointu nigdy nie było — i tak samo odpowiada druga strona relaya.
 */
import { relayReviewRequest } from "@/lib/review-relay";

export async function GET(request: Request): Promise<Response> {
  return relayReviewRequest(request, "/comments");
}

export async function POST(request: Request): Promise<Response> {
  return relayReviewRequest(request, "/comments");
}
