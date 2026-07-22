/**
 * Rdzeń serwerowy narzędzia przeglądu — WSPÓLNY dla obu dróg zapisu:
 * panel podaje klienta z sesją superadmina (bramką jest RLS 0033),
 * storefront podaje klienta service_role (bramką jest REVIEW_MODE + hasło
 * site'u w proxy). Rdzeń nie wie, którym klientem jedzie — i nie musi:
 * to samo zapytanie przechodzi lub odbija się na bazie.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type CreateCommentInput,
  type PatchCommentInput,
  type ReviewCommentDto,
  type ReviewSurface,
} from "./schema";

export const REVIEW_BUCKET = "review-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

interface CommentRow {
  id: string;
  surface: ReviewSurface;
  screen: string;
  route: string;
  kind: "point" | "area";
  pos_x: number;
  pos_y: number;
  area_w: number | null;
  area_h: number | null;
  scroll_y: number;
  body: string;
  priority: number;
  status: "open" | "done";
  created_at: string;
  review_comment_attachments: { id: string; image_path: string; sort: number }[];
}

const COMMENT_SELECT =
  "id, surface, screen, route, kind, pos_x, pos_y, area_w, area_h, scroll_y, body, priority, status, created_at, review_comment_attachments(id, image_path, sort)";

async function toDto(client: SupabaseClient, row: CommentRow): Promise<ReviewCommentDto> {
  const attachments = [...(row.review_comment_attachments ?? [])].sort((x, y) => x.sort - y.sort);
  const signed = await Promise.all(
    attachments.map(async (attachment) => {
      const { data } = await client.storage
        .from(REVIEW_BUCKET)
        .createSignedUrl(attachment.image_path, SIGNED_URL_TTL_SECONDS);
      return { id: attachment.id, url: data?.signedUrl ?? "" };
    }),
  );
  const { review_comment_attachments: _attachments, ...comment } = row;
  return {
    ...comment,
    pos_x: Number(comment.pos_x),
    pos_y: Number(comment.pos_y),
    area_w: comment.area_w == null ? null : Number(comment.area_w),
    area_h: comment.area_h == null ? null : Number(comment.area_h),
    attachments: signed.filter((attachment) => attachment.url !== ""),
  };
}

export async function listComments(
  client: SupabaseClient,
  filter: { surface?: ReviewSurface; route?: string } = {},
): Promise<ReviewCommentDto[]> {
  let query = client.from("review_comments").select(COMMENT_SELECT).order("created_at");
  if (filter.surface) query = query.eq("surface", filter.surface);
  if (filter.route) query = query.eq("route", filter.route);
  const { data, error } = await query;
  if (error) throw new Error(`Odczyt uwag przeglądu: ${error.message}`);
  return Promise.all((data as unknown as CommentRow[]).map((row) => toDto(client, row)));
}

export interface AttachmentFile {
  bytes: Uint8Array;
  contentType: string;
}

export async function createComment(
  client: SupabaseClient,
  input: CreateCommentInput,
  files: AttachmentFile[],
  createdBy: string | null,
): Promise<ReviewCommentDto> {
  if (files.length > MAX_ATTACHMENTS) throw new Error(`Maksymalnie ${MAX_ATTACHMENTS} obrazki`);
  for (const file of files) {
    if (!file.contentType.startsWith("image/")) throw new Error("Załącznik nie jest obrazkiem");
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("Obrazek za duży (limit 8 MB)");
  }

  const { data: comment, error } = await client
    .from("review_comments")
    .insert({ ...input, created_by: createdBy })
    .select("id")
    .single();
  if (error || !comment) throw new Error(`Zapis uwagi: ${error?.message ?? "brak wiersza"}`);

  for (const [index, file] of files.entries()) {
    const extension = file.contentType.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "png";
    const path = `${comment.id}/${crypto.randomUUID()}.${extension}`;
    const { error: uploadError } = await client.storage
      .from(REVIEW_BUCKET)
      .upload(path, file.bytes, { contentType: file.contentType, upsert: false });
    if (uploadError) throw new Error(`Upload obrazka: ${uploadError.message}`);
    const { error: rowError } = await client
      .from("review_comment_attachments")
      .insert({ comment_id: comment.id, image_path: path, sort: index });
    if (rowError) throw new Error(`Zapis załącznika: ${rowError.message}`);
  }

  const { data: full, error: readError } = await client
    .from("review_comments")
    .select(COMMENT_SELECT)
    .eq("id", comment.id)
    .single();
  if (readError || !full) throw new Error(`Odczyt zapisanej uwagi: ${readError?.message}`);
  return toDto(client, full as unknown as CommentRow);
}

export async function patchComment(
  client: SupabaseClient,
  id: string,
  patch: PatchCommentInput,
): Promise<ReviewCommentDto> {
  const { data, error } = await client
    .from("review_comments")
    .update(patch)
    .eq("id", id)
    .select(COMMENT_SELECT)
    .single();
  if (error || !data) throw new Error(`Zmiana uwagi: ${error?.message ?? "brak wiersza"}`);
  return toDto(client, data as unknown as CommentRow);
}
