/**
 * Zmiana uwagi przeglądu (status/priorytet/treść) — droga panelowa (ADR-071).
 * Ta sama bramka co w route.ts obok: REVIEW_MODE=1 + sesja superadmina,
 * egzekucja w RLS 0033.
 */
import { handlePatchRequest } from "@avably/review";

import { reviewGuard } from "@/lib/review-guard";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const ctx = await reviewGuard();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  return handlePatchRequest(ctx.supabase, request, id);
}
