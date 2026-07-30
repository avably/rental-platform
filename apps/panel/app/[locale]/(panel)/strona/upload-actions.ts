"use server";

/**
 * Server actions podpisanego uploadu zdjęcia SEKCJI (0043) — lustro
 * katalog/[id]/zdjecia/upload-actions.ts. Finalize ZWRACA ścieżkę (nie
 * FormState): referencję do content_draft dopisuje formularz sekcji, nie ta
 * akcja. Bajty nie przechodzą przez Server Actions — sesja członka dostaje
 * wyłącznie bilet i podpis do jednej ścieżki (issue → sign → upload → finalize).
 */
import { SITE_IMAGE_BUCKET, type SiteImageMime } from "@/lib/site-image-file";
import {
  finalizeSiteImageUpload,
  prepareSiteImageUpload,
  type ClaimedSiteImageUpload,
  type FinalizeSiteImageUploadResult,
  type PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";
import { requireMember } from "@/lib/supabase-server";
import { getTranslations } from "next-intl/server";

// UWAGA: plik "use server" — WSZYSTKIE eksporty muszą być async funkcjami
// (eksport innego kształtu wywraca cały moduł, patrz pamięć repo). Typ wyniku
// bierzemy więc z lib/site-image-upload, nie eksportujemy go stąd.
type Translator = (key: string) => string;

function prepareErrorMessage(error: string, t: Translator): string {
  if (error === "missing" || error === "empty" || error === "size" || error === "type") {
    return t(`errors.${error}`);
  }
  if (error === "denied") return t("errors.denied");
  if (error === "sign") return t("errors.upload");
  return t("errors.finalize");
}

function finalizeErrorMessage(error: string, t: Translator): string {
  if (error === "denied") return t("errors.denied");
  if (error === "content") return t("errors.content");
  if (error === "metadata" || error === "missing") return t("errors.finalize");
  return t("errors.finalize");
}

function singleRpcRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RPC nie zwróciło wiersza.");
  return row;
}

export async function prepareSiteImageUploadAction(
  siteId: string,
  input: { mime: string; size: number },
): Promise<PrepareSiteImageUploadResult> {
  const t = await getTranslations("site.images");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const result = await prepareSiteImageUpload(
    { siteId, mime: input.mime, size: input.size },
    {
      issue: async ({ siteId: requestedSiteId, mime, size }) => {
        const { data, error } = await ctx.supabase.schema("app").rpc("issue_site_image_upload", {
          p_site_id: requestedSiteId,
          p_declared_mime: mime,
          p_declared_size: size,
        });
        if (error) throw error;
        const row = singleRpcRow<{ upload_id: string; storage_path: string }>(data);
        return { uploadId: row.upload_id, storagePath: row.storage_path };
      },
      sign: async (path) => {
        const { data, error } = await ctx.supabase.storage
          .from(SITE_IMAGE_BUCKET)
          .createSignedUploadUrl(path, { upsert: false });
        if (error || !data) throw error ?? new Error("Brak tokenu signed upload.");
        return { token: data.token };
      },
    },
  );

  if (result.ok) return result;
  return { ok: false, error: prepareErrorMessage(result.error, t) };
}

export async function finalizeSiteImageUploadAction(
  uploadId: string,
): Promise<FinalizeSiteImageUploadResult> {
  const t = await getTranslations("site.images");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const bucket = ctx.supabase.storage.from(SITE_IMAGE_BUCKET);
  const result = await finalizeSiteImageUpload(uploadId, {
    claim: async (claimedUploadId): Promise<ClaimedSiteImageUpload> => {
      const { data, error } = await ctx.supabase.schema("app").rpc("claim_site_image_upload", {
        p_upload_id: claimedUploadId,
      });
      if (error) throw error;
      const row = singleRpcRow<{
        upload_id: string;
        tenant_id: string;
        site_id: string;
        storage_path: string;
        declared_mime: string;
        declared_size: number | string;
      }>(data);
      return {
        uploadId: row.upload_id,
        tenantId: row.tenant_id,
        siteId: row.site_id,
        storagePath: row.storage_path,
        declaredMime: row.declared_mime as SiteImageMime,
        declaredSize: Number(row.declared_size),
      };
    },
    info: async (path) => {
      const { data, error } = await bucket.info(path);
      if (error || !data) throw error ?? new Error("Brak obiektu.");
      return { size: Number(data.size), contentType: data.contentType ?? null };
    },
    download: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw error ?? new Error("Brak obiektu.");
      return new Uint8Array(await data.arrayBuffer());
    },
    remove: async (path) => {
      const { error } = await bucket.remove([path]);
      if (error) throw error;
    },
    finish: async (finishedUploadId, status) => {
      const { error } = await ctx.supabase.schema("app").rpc("finish_site_image_upload", {
        p_outcome: status,
        p_upload_id: finishedUploadId,
      });
      if (error) throw error;
    },
    report: (error) => {
      console.error("Nie udało się zakończyć biletu uploadu zdjęcia sekcji.", error);
    },
  });

  if (!result.ok) return { ok: false, error: finalizeErrorMessage(result.error, t) };
  return { ok: true, path: result.path };
}
