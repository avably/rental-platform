/**
 * Endpoint uwag przeglądu — DROGA PANELOWA (ADR-071).
 *
 * Zapis idzie klientem Z SESJĄ SUPERADMINA — bramką jest RLS migracji 0033
 * (app.is_superadmin() na tabelach i buckecie), nie kod tego pliku. Endpoint
 * istnieje wyłącznie przy REVIEW_MODE=1; każdy inny przypadek (tryb wyłączony,
 * brak sesji, nie-superadmin) kończy się 404 — narzędzie wewnętrzne nie
 * zdradza swojego istnienia (wzorzec /admin: 404, nie 403).
 */
import { handleCreateRequest, handleListRequest } from "@avably/review";

import { reviewGuard } from "@/lib/review-guard";

export async function GET(request: Request): Promise<Response> {
  const ctx = await reviewGuard();
  if (ctx instanceof Response) return ctx;
  return handleListRequest(ctx.supabase, request);
}

export async function POST(request: Request): Promise<Response> {
  const ctx = await reviewGuard();
  if (ctx instanceof Response) return ctx;
  return handleCreateRequest(ctx.supabase, request, ctx.user.id);
}
