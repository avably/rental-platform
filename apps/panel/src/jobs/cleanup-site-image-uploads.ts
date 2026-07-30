import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@avably/db/service";

import { SITE_IMAGE_BUCKET } from "@/lib/site-image-file";

/**
 * Cron sierot zdjęć sekcji (0043) — BLIŹNIACZY do cleanup-product-image-uploads,
 * z jedną różnicą: referencje zdjęć sekcji nie mają tabeli-katalogu, siedzą
 * w content jsonb sekcji. Zamiast czytać product_images, cron pyta
 * app.site_image_paths_in_use, które z kandydujących ścieżek są jeszcze w
 * użyciu (draft LUB published) — i kasuje wyłącznie resztę.
 *
 * Kandydaci: bilety pending/processing/rejected starsze niż doba ORAZ completed
 * domknięte ponad 7 dni temu. Obiekt kasujemy tylko dla NIE-completed biletów,
 * których ścieżka nie jest w użyciu; wiersz biletu kasujemy, gdy ścieżka jest
 * w użyciu (completed po grace) albo obiekt właśnie usunęliśmy.
 */
export interface SiteImageCleanupResult {
  scanned: number;
  removedObjects: number;
  removedIntents: number;
}

interface UploadIntent {
  id: string;
  storage_path: string;
  status: "pending" | "processing" | "rejected" | "completed";
  created_at: string;
  finished_at: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isCandidate(row: UploadIntent, now: Date): boolean {
  if (row.status === "completed") {
    return (
      row.finished_at !== null &&
      new Date(row.finished_at).getTime() <= now.getTime() - 7 * DAY_MS
    );
  }
  return new Date(row.created_at).getTime() <= now.getTime() - DAY_MS;
}

/**
 * Ścieżki jeszcze w użyciu wśród podanych kandydatów — przez app.
 * site_image_paths_in_use (SECURITY DEFINER, service_role). Normalizuje kształt
 * odpowiedzi PostgREST (setof text bywa tablicą skalarów albo obiektów).
 */
async function pathsInUse(db: SupabaseClient, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const { data, error } = await db.schema("app").rpc("site_image_paths_in_use", { p_paths: paths });
  if (error) throw error;
  const rows = (data ?? []) as unknown[];
  const used = rows.map((row) =>
    typeof row === "string"
      ? row
      : String((row as { site_image_paths_in_use?: string }).site_image_paths_in_use ?? ""),
  );
  return new Set(used.filter(Boolean));
}

export async function cleanupSiteImageUploads(input: {
  now?: Date;
  batchSize?: number;
  db?: SupabaseClient;
} = {}): Promise<SiteImageCleanupResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? 100;
  const db = input.db ?? createServiceClient();
  const staleAt = new Date(now.getTime() - DAY_MS).toISOString();
  const completedAt = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const { data, error } = await db
    .from("site_image_uploads")
    .select("id, storage_path, status, created_at, finished_at")
    .or(
      `and(status.in.(pending,processing,rejected),created_at.lte.${staleAt}),` +
        `and(status.eq.completed,finished_at.lte.${completedAt})`,
    )
    .order("created_at", { ascending: true })
    .limit(batchSize);
  if (error) throw error;

  const candidates = ((data ?? []) as UploadIntent[])
    .filter((row) => isCandidate(row, now))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .slice(0, batchSize);
  if (candidates.length === 0) {
    return { scanned: 0, removedObjects: 0, removedIntents: 0 };
  }

  const referencedPaths = await pathsInUse(
    db,
    candidates.map((row) => row.storage_path),
  );

  const unreferenced = candidates.filter(
    (row) => row.status !== "completed" && !referencedPaths.has(row.storage_path),
  );
  const unreferencedPaths = unreferenced.map((row) => row.storage_path);

  if (unreferencedPaths.length > 0) {
    const { error: removeError } = await db.storage.from(SITE_IMAGE_BUCKET).remove(unreferencedPaths);
    if (removeError) throw removeError;
  }

  const removedPaths = new Set(unreferencedPaths);
  const deletableIds = candidates
    .filter(
      (row) =>
        referencedPaths.has(row.storage_path) ||
        (row.status !== "completed" && removedPaths.has(row.storage_path)),
    )
    .map((row) => row.id);

  if (deletableIds.length > 0) {
    const { error: deleteError } = await db
      .from("site_image_uploads")
      .delete()
      .in("id", deletableIds);
    if (deleteError) throw deleteError;
  }

  return {
    scanned: candidates.length,
    removedObjects: unreferencedPaths.length,
    removedIntents: deletableIds.length,
  };
}
