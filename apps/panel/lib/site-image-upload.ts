/**
 * Orkiestracja podpisanego uploadu zdjęcia SEKCJI (0043) — czysta, testowalna
 * z wstrzykiwanymi zależnościami (bez klienta Supabase). LUSTRO
 * product-image-upload.ts z JEDNĄ różnicą modelową: zdjęcie sekcji NIE ma
 * tabeli-katalogu. Finalize domyka bilet i ZWRACA ścieżkę Storage — referencję
 * do content_draft dopisuje formularz sekcji (upsertSection). Do tego czasu
 * obiekt jest sierotą sprzątaną przez cron (app.site_image_paths_in_use).
 *
 * Bramka treści (magiczne bajty) i kompensacja (usuń obiekt + odrzuć bilet przy
 * niezgodności) są takie same jak dla zdjęć produktów — bilet 'completed' bez
 * przejścia kontroli nie ma prawa powstać.
 */
import {
  checkSiteImageMetadata,
  detectSiteImageMime,
  MAX_SITE_IMAGE_BYTES,
  type SiteImageMime,
} from "@/lib/site-image-file";

export interface PreparedSiteImageUpload {
  uploadId: string;
  path: string;
  token: string;
}

export type PrepareSiteImageUploadResult =
  | { ok: true; upload: PreparedSiteImageUpload }
  | { ok: false; error: string };

export type FinalizeSiteImageUploadResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

export interface ClaimedSiteImageUpload {
  uploadId: string;
  tenantId: string;
  /**
   * Strona-rodzic biletu albo `null` dla biletu LOGO najemcy (ADR-160): znak
   * jest własnością najemcy, a nie którejkolwiek z jego stron.
   */
  siteId: string | null;
  storagePath: string;
  declaredMime: SiteImageMime;
  declaredSize: number;
}

export interface PrepareSiteImageUploadDependencies {
  issue: (input: {
    siteId: string;
    mime: SiteImageMime;
    size: number;
  }) => Promise<{ uploadId: string; storagePath: string }>;
  sign: (path: string) => Promise<{ token: string }>;
}

export interface SiteImageStorageInfo {
  size: number;
  contentType: string | null;
}

export interface FinalizeSiteImageUploadDependencies {
  claim: (uploadId: string) => Promise<ClaimedSiteImageUpload>;
  info: (path: string) => Promise<SiteImageStorageInfo>;
  download: (path: string) => Promise<Uint8Array>;
  remove: (path: string) => Promise<void>;
  finish: (uploadId: string, status: "completed" | "rejected") => Promise<void>;
  report: (error: unknown) => void | Promise<void>;
}

export async function prepareSiteImageUpload(
  input: { siteId: string; mime: string; size: number },
  deps: PrepareSiteImageUploadDependencies,
): Promise<PrepareSiteImageUploadResult> {
  const problem = checkSiteImageMetadata({ size: input.size, type: input.mime });
  if (problem) return { ok: false, error: problem };

  let intent: { uploadId: string; storagePath: string };
  try {
    intent = await deps.issue({
      siteId: input.siteId,
      mime: input.mime as SiteImageMime,
      size: input.size,
    });
  } catch {
    return { ok: false, error: "denied" };
  }

  try {
    const signed = await deps.sign(intent.storagePath);
    return {
      ok: true,
      upload: { uploadId: intent.uploadId, path: intent.storagePath, token: signed.token },
    };
  } catch {
    return { ok: false, error: "sign" };
  }
}

async function report(deps: FinalizeSiteImageUploadDependencies, error: unknown): Promise<void> {
  try {
    await deps.report(error);
  } catch {
    // Raportowanie nie może zmienić wyniku autorytatywnych operacji.
  }
}

async function finishRejected(
  uploadId: string,
  deps: FinalizeSiteImageUploadDependencies,
): Promise<void> {
  try {
    await deps.finish(uploadId, "rejected");
  } catch (error) {
    await report(deps, error);
  }
}

async function removeAndReject(
  uploadId: string,
  path: string,
  deps: FinalizeSiteImageUploadDependencies,
): Promise<void> {
  try {
    await deps.remove(path);
  } catch (error) {
    await report(deps, error);
  }
  await finishRejected(uploadId, deps);
}

export async function finalizeSiteImageUpload(
  uploadId: string,
  deps: FinalizeSiteImageUploadDependencies,
  /**
   * SUFIT ROZMIARU dla TEGO biletu (ADR-160). Domyślnie sufit zdjęcia sekcji;
   * bilet logo domyka się ostrzejszym (512 KiB), bo bucket przyjmuje 5 MiB
   * i sam by tej różnicy nie wyłapał — bajty idą do Storage bez pośrednictwa
   * Server Action, więc jedynym miejscem na porównanie deklaracji z faktem
   * jest właśnie ta kontrola po fakcie.
   */
  options: { maxBytes?: number } = {},
): Promise<FinalizeSiteImageUploadResult> {
  const maxBytes = options.maxBytes ?? MAX_SITE_IMAGE_BYTES;
  let claimed: ClaimedSiteImageUpload;
  try {
    claimed = await deps.claim(uploadId);
  } catch {
    return { ok: false, error: "denied" };
  }

  let info: SiteImageStorageInfo;
  try {
    info = await deps.info(claimed.storagePath);
  } catch {
    await finishRejected(uploadId, deps);
    return { ok: false, error: "missing" };
  }

  if (
    info.size !== claimed.declaredSize ||
    info.contentType !== claimed.declaredMime ||
    info.size <= 0 ||
    info.size > maxBytes
  ) {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "metadata" };
  }

  let bytes: Uint8Array;
  try {
    bytes = await deps.download(claimed.storagePath);
  } catch {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "missing" };
  }

  // Bramka treści: bajty muszą BYĆ zadeklarowanym typem obrazu (nie np. SVG/
  // HTML przemycone pod nagłówkiem PNG). Niezgodność → usuń obiekt i odrzuć.
  if (detectSiteImageMime(bytes) !== claimed.declaredMime) {
    await removeAndReject(uploadId, claimed.storagePath, deps);
    return { ok: false, error: "content" };
  }

  try {
    await deps.finish(uploadId, "completed");
  } catch (error) {
    await report(deps, error);
  }
  // Ścieżka wraca do formularza — to on dopisuje ją do content_draft sekcji.
  return { ok: true, path: claimed.storagePath };
}
