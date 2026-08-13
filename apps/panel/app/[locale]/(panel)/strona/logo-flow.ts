/**
 * Klient uploadu LOGO najemcy (ADR-160) — lustro `./upload-flow.ts`.
 *
 * Różnica jest jedna i jest nią KONTROLA WSTĘPNA: znak ma własny sufit
 * (512 KiB), więc plik za duży ma paść w przeglądarce, zanim pojedzie
 * na serwer. Bajty wgrywa przeglądarka wprost do podpisanego URL-a — tym samym
 * wywołaniem, co przy zdjęciu sekcji (ten sam bucket, ta sama funkcja).
 */
import type {
  FinalizeSiteImageUploadResult,
  PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";
import { checkTenantLogoMetadata, type TenantLogoFileProblem } from "@/lib/tenant-logo";

import { uploadSiteImageToSignedUrl } from "./upload-flow";

export type TenantLogoUploadOutcome = { ok: true; path: string } | { ok: false; error: string };

interface TenantLogoUploadFlowDependencies {
  prepare: (input: { mime: string; size: number }) => Promise<PrepareSiteImageUploadResult>;
  upload: (input: {
    path: string;
    token: string;
    file: File;
    contentType: string;
  }) => Promise<{ error: string | null }>;
  finalize: (uploadId: string) => Promise<FinalizeSiteImageUploadResult>;
  message: (problem: TenantLogoFileProblem | "upload") => string;
}

export { uploadSiteImageToSignedUrl };

export async function runTenantLogoUpload(
  file: File | null,
  deps: TenantLogoUploadFlowDependencies,
): Promise<TenantLogoUploadOutcome> {
  if (!file) return { ok: false, error: deps.message("missing") };

  const problem = checkTenantLogoMetadata(file);
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
