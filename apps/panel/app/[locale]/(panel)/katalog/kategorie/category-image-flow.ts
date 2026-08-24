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
 * Klient uploadu BANERA KATEGORII (ADR-260) — lustro strona/logo-flow.ts.
 *
 * Kontrola wstępna (typ/rozmiar) jest ta sama co dla zdjęcia sekcji (bucket
 * `site-images`, sufit 5 MiB): baner należy do tej samej klasy pliku co
 * fotografia sekcji, nie do klasy znaku. Bajty wgrywa przeglądarka wprost do
 * podpisanego URL-a — tym samym wywołaniem, co przy logo i sekcji. `prepare`
 * dostaje `categoryId`, bo bilet banera odmawia się dla kategorii spoza najemcy.
 */
export type CategoryImageUploadOutcome =
  | { ok: true; path: string }
  | { ok: false; error: string };

interface CategoryImageUploadFlowDependencies {
  prepare: (input: {
    categoryId: string;
    mime: string;
    size: number;
  }) => Promise<PrepareSiteImageUploadResult>;
  upload: (input: {
    path: string;
    token: string;
    file: File;
    contentType: string;
  }) => Promise<{ error: string | null }>;
  finalize: (uploadId: string) => Promise<FinalizeSiteImageUploadResult>;
  message: (problem: SiteImageFileProblem | "upload") => string;
}

export async function uploadCategoryBannerToSignedUrl(input: {
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

export async function runCategoryImageUpload(
  categoryId: string,
  file: File | null,
  deps: CategoryImageUploadFlowDependencies,
): Promise<CategoryImageUploadOutcome> {
  if (!file) return { ok: false, error: deps.message("missing") };

  const problem = checkSiteImageMetadata(file);
  if (problem) return { ok: false, error: deps.message(problem) };

  const prepared = await deps.prepare({ categoryId, mime: file.type, size: file.size });
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
