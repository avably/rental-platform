"use server";

/**
 * Server actions BANERA KATEGORII (ADR-260, migracja 0106).
 *
 * Trzy czasowniki: wystaw bilet, domknij bilet, zapisz (albo zdejmij) ścieżkę.
 * Bajty NIE przechodzą przez Server Actions — sesja członka dostaje wyłącznie
 * bilet i podpis do jednej ścieżki, dokładnie jak przy logo (0076) i zdjęciu
 * sekcji (0043). Reużyta maszyneria: `@/lib/site-image-upload`
 * (finalizeSiteImageUpload), bucket `site-images`, RPC claim/finish z 0043.
 *
 * KTO PILNUJE CZEGO. Ten plik nie jest bramką bezpieczeństwa: tenanta wybiera
 * baza (`app.tenant_id()`), ścieżkę liczy baza, żywego członkostwa i przynależności
 * kategorii pilnują RPC z 0106, a wzorzec ścieżki — `app.set_category_image`.
 * Tu zostaje tłumaczenie odmów na zdania dla operatora.
 *
 * UWAGA: plik "use server" — WSZYSTKIE eksporty muszą być async funkcjami.
 * Eksport innego kształtu wywraca cały moduł („no exports at all"), a łapie to
 * dopiero `next build`.
 */
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { uuidSchema } from "@/lib/catalog-validation";
import { SITE_IMAGE_BUCKET, type SiteImageMime } from "@/lib/site-image-file";
import {
  finalizeSiteImageUpload,
  type ClaimedSiteImageUpload,
  type FinalizeSiteImageUploadResult,
  type PrepareSiteImageUploadResult,
} from "@/lib/site-image-upload";
import { requireMember } from "@/lib/supabase-server";

type Translator = (key: string) => string;

/** Wynik czasownika zapisu/zdjęcia banera. */
export type CategoryImageActionResult = { ok: true } | { ok: false; error: string };

function finalizeErrorMessage(error: string, t: Translator): string {
  if (error === "denied") return t("errors.denied");
  if (error === "content") return t("errors.content");
  if (error === "metadata") return t("errors.content");
  if (error === "missing") return t("errors.finalize");
  return t("errors.finalize");
}

function singleRpcRow<T>(data: T | T[] | null): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("RPC nie zwróciło wiersza.");
  return row;
}

/**
 * WYSTAWIENIE biletu. Ani jednego argumentu o ścieżce ani o tenancie: jedno
 * i drugie liczy funkcja w bazie z claimu wołającego (0106). `p_category_id`
 * jedzie WYŁĄCZNIE po to, by baza odmówiła biletu na kategorię spoza najemcy.
 */
export async function prepareCategoryImageUploadAction(input: {
  categoryId: string;
  mime: string;
  size: number;
}): Promise<PrepareSiteImageUploadResult> {
  const t = await getTranslations("catalog.categories.banner");

  const id = uuidSchema.safeParse(input.categoryId);
  if (!id.success) return { ok: false, error: t("errors.denied") };

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  let intent: { uploadId: string; storagePath: string };
  try {
    const { data, error } = await ctx.supabase.schema("app").rpc("issue_category_image_upload", {
      p_category_id: id.data,
      p_declared_mime: input.mime,
      p_declared_size: input.size,
    });
    if (error) throw error;
    const row = singleRpcRow<{ upload_id: string; storage_path: string }>(data);
    intent = { uploadId: row.upload_id, storagePath: row.storage_path };
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  try {
    const { data, error } = await ctx.supabase.storage
      .from(SITE_IMAGE_BUCKET)
      .createSignedUploadUrl(intent.storagePath, { upsert: false });
    if (error || !data) throw error ?? new Error("Brak tokenu signed upload.");
    return {
      ok: true,
      upload: { uploadId: intent.uploadId, path: intent.storagePath, token: data.token },
    };
  } catch {
    return { ok: false, error: t("errors.upload") };
  }
}

/**
 * DOMKNIĘCIE biletu. TA SAMA maszyneria co logo/sekcja — claim rozpoznaje bilet
 * po identyfikatorze, autorytatywne metadane i bramka treści (magiczne bajty)
 * są wspólne. Sufit DOMYŚLNY (5 MiB): baner jest fotografią na szerokość kafla,
 * nie znakiem w pasku, więc zostaje przy sufcie bucketa (inaczej niż logo).
 */
export async function finalizeCategoryImageUploadAction(
  uploadId: string,
): Promise<FinalizeSiteImageUploadResult> {
  const t = await getTranslations("catalog.categories.banner");

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
      console.error("Nie udało się zakończyć biletu uploadu banera kategorii.", error);
    },
  });

  if (!result.ok) return { ok: false, error: finalizeErrorMessage(result.error, t) };
  return { ok: true, path: result.path };
}

/**
 * ZAPIS albo ZDJĘCIE banera (`path === null` = zdejmij). Ścieżkę i tenanta
 * pilnuje `app.set_category_image` (0106): wskazanie cudzego pliku lub cudzej
 * kategorii to 22023. Po sukcesie unieważnia cache katalogu SKLEPU (ADR-185) —
 * baner jedzie kopertą `app.get_public_catalog` (0103).
 */
export async function setCategoryImageAction(input: {
  categoryId: string;
  path: string | null;
}): Promise<CategoryImageActionResult> {
  const t = await getTranslations("catalog.categories.banner");

  const id = uuidSchema.safeParse(input.categoryId);
  if (!id.success) return { ok: false, error: t("errors.denied") };

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const { error } = await ctx.supabase.schema("app").rpc("set_category_image", {
    p_category_id: id.data,
    p_path: input.path,
  });
  if (error) return { ok: false, error: t("errors.save") };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy revalidatePath go nie dosięga:
  // to osobna aplikacja Next. Baner kategorii wchodzi do publicznej koperty.
  if (ctx.tenantId) await invalidateStorefrontCatalog(ctx.tenantId);
  return { ok: true };
}
