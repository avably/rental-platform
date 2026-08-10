/**
 * Wspólna warstwa HTTP endpointów przeglądu (ADR-071). Appki różnią się
 * WYŁĄCZNIE bramką i klientem (panel: sesja superadmina/RLS; storefront:
 * relay do ingest panelu za `isReviewSurfaceEnabled`, ADR-099/128) — kody
 * odpowiedzi są jedną implementacją, więc obie drogi zachowują się
 * identycznie z perspektywy nakładki.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createCommentSchema, patchCommentSchema, REVIEW_SURFACES, type ReviewSurface } from "./schema";
import { createComment, listComments, patchComment, type AttachmentFile } from "./server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleListRequest(
  client: SupabaseClient,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const surface = url.searchParams.get("surface");
  const route = url.searchParams.get("route");
  const comments = await listComments(client, {
    surface: REVIEW_SURFACES.includes(surface as ReviewSurface)
      ? (surface as ReviewSurface)
      : undefined,
    route: route ?? undefined,
  });
  return Response.json({ comments });
}

export async function handleCreateRequest(
  client: SupabaseClient,
  request: Request,
  createdBy: string | null,
): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "Oczekiwano multipart/form-data" }, { status: 400 });
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") {
    return Response.json({ error: "Brak pola payload" }, { status: 400 });
  }
  let json: unknown;
  try {
    json = JSON.parse(rawPayload);
  } catch {
    return Response.json({ error: "payload nie jest JSON-em" }, { status: 400 });
  }
  const parsed = createCommentSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }

  const files: AttachmentFile[] = [];
  for (const entry of form.getAll("images")) {
    if (entry instanceof File) {
      files.push({ bytes: new Uint8Array(await entry.arrayBuffer()), contentType: entry.type });
    }
  }

  try {
    const comment = await createComment(client, parsed.data, files, createdBy);
    return Response.json({ comment }, { status: 201 });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}

export async function handlePatchRequest(
  client: SupabaseClient,
  request: Request,
  id: string,
): Promise<Response> {
  if (!UUID_RE.test(id)) {
    return Response.json({ error: "Niepoprawny identyfikator" }, { status: 400 });
  }
  const parsed = patchCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const comment = await patchComment(client, id, parsed.data);
    return Response.json({ comment });
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 400 });
  }
}
