/**
 * Zmiana uwagi przeglądu — droga relaya storefrontu (ADR-099/ADR-115).
 * Ta sama bramka co w route.ts obok: REVIEW_MODE po stronie panelu +
 * wspólny sekret stałoczasowo; uzasadnienie — nagłówek tamtego pliku.
 */
import { handlePatchRequest } from "@avably/review";

import { reviewIngestClient } from "@/app/api/review/ingest/client";
import { reviewIngestGuard } from "@/lib/review-ingest-guard";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const denied = reviewIngestGuard(request);
  if (denied) return denied;
  const { id } = await params;
  return handlePatchRequest(reviewIngestClient(), request, id);
}
