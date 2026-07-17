import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
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
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-6">
      <Link className="text-sm underline" href={`/katalog/${product.id}`}>
        {t("backToProduct", { name: product.name })}
      </Link>
      <h1 className="text-xl font-semibold">{t("title", { name: product.name })}</h1>

      <UploadImageForm action={uploadImageAction.bind(null, product.id)} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">{t("listHeading", { count: rows.length })}</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-gray-600">{t("empty")}</p>
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
    </main>
  );
}
