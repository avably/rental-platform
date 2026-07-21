import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { uploadImageAction, updateImageAction } from "./actions";
import { ImageRowForm, UploadImageForm } from "./photo-forms";

const BUCKET = "product-images";

export default async function ProductImagesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/zdjecia`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id, name")
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
      <ScreenHeader
        back={{
          href: `/katalog/${product.id}`,
          label: t("backToProduct", { name: product.name }),
        }}
        title={t("title", { name: product.name })}
      />

      <UploadImageForm action={uploadImageAction.bind(null, product.id)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-xl leading-[26px] font-semibold tracking-[-0.01em]">
          {t("listHeading", { count: rows.length })}
        </h2>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("empty")}</p>
        ) : (
          rows.map((image) => (
            <ImageRowForm
              key={image.id}
              action={updateImageAction.bind(null, product.id)}
              image={image}
            />
          ))
        )}
      </section>
    </div>
  );
}
