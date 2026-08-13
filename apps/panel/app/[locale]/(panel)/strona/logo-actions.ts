"use server";

/**
 * Server actions LOGO NAJEMCY (ADR-160, migracja 0076).
 *
 * Cztery czasowniki i ani jednego więcej: wystaw bilet, domknij bilet, zapisz
 * szkic, opublikuj. Bajty NIE przechodzą przez Server Actions — sesja członka
 * dostaje wyłącznie bilet i podpis do jednej ścieżki, dokładnie jak przy
 * zdjęciu sekcji.
 *
 * KTO PILNUJE CZEGO. Ten plik nie jest bramką bezpieczeństwa i nie udaje nią
 * być: tenanta wybiera baza (`app.tenant_id()`), ścieżkę liczy baza, żywego
 * członkostwa pilnują RPC z 0076, a granicę draft/publish — strażnik kolumn
 * opublikowanych. Tu zostaje walidacja KSZTAŁTU (schemat z rdzenia) i tłumaczenie
 * odmów na zdania dla operatora.
 *
 * UWAGA: plik "use server" — WSZYSTKIE eksporty muszą być async funkcjami.
 * Eksport innego kształtu wywraca cały moduł („no exports at all"), a łapie to
 * dopiero `next build`.
 */
import { revalidatePath, revalidateTag } from "next/cache";
import { getTranslations } from "next-intl/server";

import { siteLogoSchema, tenantCacheTag } from "@avably/core/site";

import { SITE_IMAGE_BUCKET, type SiteImageMime } from "@/lib/site-image-file";
import {
  finalizeSiteImageUpload,
  type ClaimedSiteImageUpload,
  type FinalizeSiteImageUploadResult,
  type PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";
import {
  MAX_SITE_LOGO_BYTES,
  prepareTenantLogoUpload,
  type TenantLogoActionResult,
} from "@/lib/tenant-logo-upload";
import { requireMember } from "@/lib/supabase-server";

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
  return t("errors.finalize");
}

function singleRpcRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RPC nie zwróciło wiersza.");
  return row;
}

export async function prepareTenantLogoUploadAction(input: {
  mime: string;
  size: number;
}): Promise<PrepareSiteImageUploadResult> {
  const t = await getTranslations("site.logo");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const result = await prepareTenantLogoUpload(input, {
    issue: async ({ mime, size }) => {
      // Ani jednego argumentu o ścieżce ani o tenancie: jedno i drugie liczy
      // funkcja w bazie z claimu wołającego (0076).
      const { data, error } = await ctx.supabase.schema("app").rpc("issue_site_logo_upload", {
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
  });

  if (result.ok) return result;
  return { ok: false, error: prepareErrorMessage(result.error, t) };
}

export async function finalizeTenantLogoUploadAction(
  uploadId: string,
): Promise<FinalizeSiteImageUploadResult> {
  const t = await getTranslations("site.logo");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const bucket = ctx.supabase.storage.from(SITE_IMAGE_BUCKET);
  const result = await finalizeSiteImageUpload(
    uploadId,
    {
      claim: async (claimedUploadId): Promise<ClaimedSiteImageUpload> => {
        // TEN SAM claim, co przy zdjęciu sekcji: bilet rozpoznaje się po
        // identyfikatorze, a nie po przeznaczeniu — drugiego czasownika
        // domykającego nie ma po co budować.
        const { data, error } = await ctx.supabase.schema("app").rpc("claim_site_image_upload", {
          p_upload_id: claimedUploadId,
        });
        if (error) throw error;
        const row = singleRpcRow<{
          upload_id: string;
          tenant_id: string;
          site_id: string | null;
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
        console.error("Nie udało się zakończyć biletu uploadu logo najemcy.", error);
      },
    },
    { maxBytes: MAX_SITE_LOGO_BYTES },
  );

  if (!result.ok) return { ok: false, error: finalizeErrorMessage(result.error, t) };
  return { ok: true, path: result.path };
}

/**
 * ZAPIS SZKICU. `null` znaczy „zdejmij znak" i jedzie do bazy jako pusty
 * obiekt — ta sama reprezentacja braku, co przy stylu strony.
 *
 * Szkic NIE ZMIENIA sklepu ani o bajt: publiczny odczyt czyta wyłącznie
 * `logo_published` (0076). Gwarancji nie niesie ten kod, tylko rozdzielenie
 * kolumn i strażnik.
 */
export async function saveTenantLogoAction(
  input: { path: string; alt?: string; inFooter?: boolean } | null,
): Promise<TenantLogoActionResult> {
  const t = await getTranslations("site.logo");

  let payload: Record<string, unknown> = {};
  if (input !== null) {
    const parsed = siteLogoSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: t("errors.shape") };
    payload = parsed.data;
  }

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const { error } = await ctx.supabase.schema("app").rpc("set_tenant_logo", { p_logo: payload });
  if (error) return { ok: false, error: t("errors.save") };

  revalidatePath("/strona");
  return { ok: true };
}

/**
 * PUBLIKACJA ZNAKU — własny czasownik, nie doczepka do publikacji strony.
 * Po sukcesie unieważnia cache storefrontu tagiem TENANTA (kontrakt ADR-041):
 * ten sam tag, co przy publikacji strony, bo zmienia się to samo — co widzi
 * klient tego najemcy.
 */
export async function publishTenantLogoAction(): Promise<TenantLogoActionResult> {
  const t = await getTranslations("site.logo");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const { error } = await ctx.supabase.schema("app").rpc("publish_tenant_logo");
  if (error) return { ok: false, error: t("errors.publish") };

  revalidatePath("/", "layout");
  if (ctx.tenantId) revalidateTag(tenantCacheTag(ctx.tenantId), "max");
  return { ok: true };
}
