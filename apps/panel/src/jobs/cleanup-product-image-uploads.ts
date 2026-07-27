import type { SupabaseClient } from "@supabase/supabase-js";

import { createServiceClient } from "@avably/db/service";

import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-image-file";

export interface ProductImageCleanupResult {
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

export async function cleanupProductImageUploads(input: {
  now?: Date;
  batchSize?: number;
  db?: SupabaseClient;
} = {}): Promise<ProductImageCleanupResult> {
  const now = input.now ?? new Date();
  const batchSize = input.batchSize ?? 100;
  const db = input.db ?? createServiceClient();
  const staleAt = new Date(now.getTime() - DAY_MS).toISOString();
  const completedAt = new Date(now.getTime() - 7 * DAY_MS).toISOString();

  const { data, error } = await db
    .from("product_image_uploads")
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

  const paths = candidates.map((row) => row.storage_path);
  const { data: refs, error: refsError } = await db
    .from("product_images")
    .select("storage_path")
    .in("storage_path", paths);
  if (refsError) throw refsError;

  const referencedPaths = new Set(
    (refs ?? []).map((row) => String((row as { storage_path: string }).storage_path)),
  );
  const unreferenced = candidates.filter(
    (row) => row.status !== "completed" && !referencedPaths.has(row.storage_path),
  );
  const unreferencedPaths = unreferenced.map((row) => row.storage_path);

  if (unreferencedPaths.length > 0) {
    const { error: removeError } = await db.storage
      .from(PRODUCT_IMAGE_BUCKET)
      .remove(unreferencedPaths);
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
      .from("product_image_uploads")
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
