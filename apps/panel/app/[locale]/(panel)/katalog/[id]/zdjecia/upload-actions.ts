"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { invalidateStorefrontCatalog } from "@/lib/catalog-cache";
import { type FormState } from "@/lib/form-state";
import { PRODUCT_IMAGE_BUCKET, type ProductImageMime } from "@/lib/product-image-file";
import {
  finalizeProductImageUpload,
  prepareProductImageUpload,
  type ClaimedProductImageUpload,
  type PrepareProductImageUploadResult,
} from "@/lib/product-image-upload";
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

export async function prepareProductImageUploadAction(
  productId: string,
  input: { mime: string; size: number },
): Promise<PrepareProductImageUploadResult> {
  const t = await getTranslations("catalog.images");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { ok: false, error: t("errors.denied") };
  }

  const result = await prepareProductImageUpload(
    { productId, mime: input.mime, size: input.size },
    {
      issue: async ({ productId: requestedProductId, mime, size }) => {
        const { data, error } = await ctx.supabase
          .schema("app")
          .rpc("issue_product_image_upload", {
            p_product_id: requestedProductId,
            p_declared_mime: mime,
            p_declared_size: size,
          });
        if (error) throw error;
        const row = singleRpcRow<{
          upload_id: string;
          storage_path: string;
        }>(data);
        return {
          uploadId: row.upload_id,
          storagePath: row.storage_path,
        };
      },
      sign: async (path) => {
        const { data, error } = await ctx.supabase.storage
          .from(PRODUCT_IMAGE_BUCKET)
          .createSignedUploadUrl(path, { upsert: false });
        if (error || !data) throw error ?? new Error("Brak tokenu signed upload.");
        return { token: data.token };
      },
    },
  );

  if (result.ok) return result;
  return { ok: false, error: prepareErrorMessage(result.error, t) };
}

export async function finalizeProductImageUploadAction(uploadId: string): Promise<FormState> {
  const t = await getTranslations("catalog.images");

  let ctx: Awaited<ReturnType<typeof requireMember>>;
  try {
    ctx = await requireMember();
  } catch {
    return { formError: t("errors.denied") };
  }

  const bucket = ctx.supabase.storage.from(PRODUCT_IMAGE_BUCKET);
  const result = await finalizeProductImageUpload(uploadId, {
    claim: async (claimedUploadId): Promise<ClaimedProductImageUpload> => {
      const { data, error } = await ctx.supabase
        .schema("app")
        .rpc("claim_product_image_upload", {
          p_upload_id: claimedUploadId,
        });
      if (error) throw error;
      const row = singleRpcRow<{
        upload_id: string;
        tenant_id: string;
        product_id: string;
        storage_path: string;
        declared_mime: string;
        declared_size: number | string;
      }>(data);
      return {
        uploadId: row.upload_id,
        tenantId: row.tenant_id,
        productId: row.product_id,
        storagePath: row.storage_path,
        declaredMime: row.declared_mime as ProductImageMime,
        declaredSize: Number(row.declared_size),
      };
    },
    info: async (path) => {
      const { data, error } = await bucket.info(path);
      if (error || !data) throw error ?? new Error("Brak obiektu.");
      return {
        size: Number(data.size),
        contentType: data.contentType ?? null,
      };
    },
    download: async (path) => {
      const { data, error } = await bucket.download(path);
      if (error || !data) throw error ?? new Error("Brak obiektu.");
      return new Uint8Array(await data.arrayBuffer());
    },
    nextSortOrder: async (tenantId, productId) => {
      const { data, error } = await ctx.supabase
        .from("product_images")
        .select("sort_order")
        .eq("tenant_id", tenantId)
        .eq("product_id", productId)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? Number(data.sort_order) + 1 : 0;
    },
    insert: async ({ tenantId, productId, storagePath, sortOrder }) => {
      const { error } = await ctx.supabase.from("product_images").insert({
        tenant_id: tenantId,
        product_id: productId,
        storage_path: storagePath,
        sort_order: sortOrder,
      });
      if (error) throw error;
    },
    exists: async (path) => {
      const { data, error } = await ctx.supabase
        .from("product_images")
        .select("storage_path")
        .eq("storage_path", path)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    remove: async (path) => {
      const { error } = await bucket.remove([path]);
      if (error) throw error;
    },
    finish: async (finishedUploadId, status) => {
      const { error } = await ctx.supabase
        .schema("app")
        .rpc("finish_product_image_upload", {
          p_outcome: status,
          p_upload_id: finishedUploadId,
        });
      if (error) throw error;
    },
    report: (error) => {
      console.error("Nie udało się zakończyć biletu uploadu zdjęcia.", error);
    },
  });

  if (!result.ok) return { formError: finalizeErrorMessage(result.error, t) };

  revalidatePath("/", "layout");
  // Cache katalogu w SKLEPIE (ADR-185) — panelowy `revalidatePath` go nie
  // dosięga: to osobna aplikacja Next. Patrz lib/catalog-cache.ts.
  await invalidateStorefrontCatalog(ctx.tenantId!);
  return { success: "added" };
}
