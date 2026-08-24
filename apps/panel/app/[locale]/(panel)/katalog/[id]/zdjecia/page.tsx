import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { requireMemberPage } from "@/lib/member-page";

import { reorderProductImagesAction, updateImageAction } from "./actions";
import { MultiUploadImageForm, PhotoGrid } from "./photo-forms";
import {
  finalizeProductImageUploadAction,
  prepareProductImageUploadAction,
} from "./upload-actions";

const BUCKET = "product-images";

/**
 * Zakładka „Zdjęcia" karty produktu.
 *
 * Powrót do produktu i nazwa rekordu przeniosły się do `../layout.tsx` (U8b,
 * ADR-146). Miniatury zostają na TRANSFORMACJI obrazów Supabase — świadoma
 * różnica wobec listy i karty (ADR-145): to ekran rzadki, na którym
 * degradacja przy planie hostingu bez transformacji jest do przyjęcia.
 */
export default async function ProductImagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/zdjecia`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const { data: images } = await ctx.supabase
    .from("product_images")
    .select("id, storage_path, sort_order, alt_text")
    .eq("tenant_id", ctx.tenantId)
    .eq("product_id", id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const t = await getTranslations("catalog.images");

  // Miniatura przez transformację obrazów Supabase (parametr width/quality) —
  // nie budujemy własnego resize. Na hostingu (plan z transformacjami)
  // zwraca przeskalowany wariant; ścieżka /render/image/public/… .
  const rows = (images ?? []).map((image) => ({
    id: image.id,
    sortOrder: image.sort_order,
    altText: image.alt_text ?? "",
    thumbnailUrl: ctx.supabase.storage.from(BUCKET).getPublicUrl(image.storage_path, {
      transform: { width: 240, height: 240, resize: "cover", quality: 70 },
    }).data.publicUrl,
  }));

  return (
    <div className="flex flex-col gap-4">
      {/* Wielo-upload niesie WŁASNĄ kartę i własny nagłówek — drugie opakowanie
          dałoby ramkę w ramce (uwaga właściciela #1). */}
      <MultiUploadImageForm
        prepare={prepareProductImageUploadAction.bind(null, product.id)}
        finalize={finalizeProductImageUploadAction}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
          {t("listHeading", { count: rows.length })}
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          <PhotoGrid
            images={rows}
            reorder={reorderProductImagesAction.bind(null, product.id)}
            remove={updateImageAction.bind(null, product.id)}
          />
        )}
      </section>
    </div>
  );
}
