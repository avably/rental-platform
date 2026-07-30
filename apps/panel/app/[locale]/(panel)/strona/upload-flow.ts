import { createBrowserClient } from "@avably/db";

import {
  checkSiteImageMetadata,
  SITE_IMAGE_BUCKET,
  type SiteImageFileProblem,
} from "@/lib/site-image-file";
import type {
  FinalizeSiteImageUploadResult,
  PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";

/**
 * Klient uploadu zdjęcia sekcji (0043) — lustro
 * katalog/[id]/zdjecia/upload-flow.ts. Zwraca ŚCIEŻKĘ Storage po sukcesie, żeby
 * formularz sekcji wpisał ją do pola treści (imagePath). Bajty wgrywa klient
 * przeglądarki wprost do podpisanego URL-a (nie przez Server Actions).
 */
export type SiteImageUploadOutcome =
  | { ok: true; path: string }
  | { ok: false; error: string };

interface SiteImageUploadFlowDependencies {
  prepare: (input: { mime: string; size: number }) => Promise<PrepareSiteImageUploadResult>;
  upload: (input: {
    path: string;
    token: string;
    file: File;
    contentType: string;
  }) => Promise<{ error: string | null }>;
  finalize: (uploadId: string) => Promise<FinalizeSiteImageUploadResult>;
  message: (problem: SiteImageFileProblem | "upload") => string;
}

export async function uploadSiteImageToSignedUrl(input: {
  path: string;
  token: string;
  file: File;
  contentType: string;
}): Promise<{ error: string | null }> {
  const supabase = createBrowserClient();
  const { error } = await supabase.storage
    .from(SITE_IMAGE_BUCKET)
    .uploadToSignedUrl(input.path, input.token, input.file, {
      contentType: input.contentType,
      upsert: false,
    });
  return { error: error ? "upload" : null };
}

export async function runSiteImageUpload(
  file: File | null,
  deps: SiteImageUploadFlowDependencies,
): Promise<SiteImageUploadOutcome> {
  if (!file) return { ok: false, error: deps.message("missing") };

  const problem = checkSiteImageMetadata(file);
  if (problem) return { ok: false, error: deps.message(problem) };

  const prepared = await deps.prepare({ mime: file.type, size: file.size });
  if (!prepared.ok) return { ok: false, error: prepared.error };

  const uploaded = await deps.upload({
    path: prepared.upload.path,
    token: prepared.upload.token,
    file,
    contentType: file.type,
  });
  if (uploaded.error) return { ok: false, error: deps.message("upload") };

  const finalized = await deps.finalize(prepared.upload.uploadId);
  if (!finalized.ok) return { ok: false, error: finalized.error };
  return { ok: true, path: finalized.path };
}
