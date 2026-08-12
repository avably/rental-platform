/**
 * Miniatura produktu na liście katalogu (U8a).
 *
 * ROZSTRZYGNIĘCIE: budujemy GOŁY PUBLICZNY URL, dokładnie tak jak sklep
 * (`apps/storefront/lib/catalog/present.ts` → `storagePublicUrl`), a NIE
 * transformację obrazów Supabase (`getPublicUrl(..., { transform })`), której
 * używa ekran `/katalog/[id]/zdjecia`. Powód: transformacje obrazów są opcją
 * PLANU HOSTINGU, a miniatura na GŁÓWNYM EKRANIE PRACY nie może zależeć od
 * opcji planu — na planie bez transformacji ścieżka `/render/image/public/…`
 * przestaje oddawać plik i lista traci zdjęcia. Ekran zdjęć jest ekranem
 * rzadkim i tam degradacja jest do przyjęcia; tutaj nie jest.
 *
 * Skalowanie robi więc przeglądarka (atrybuty `width`/`height` + `size-10`),
 * a nie serwer. Przy ~100 wierszach to jest tańsze niż jeden zapasowy odczyt.
 *
 * IZOLACJA: `storagePath` MUSI pochodzić z wiersza `product_images`
 * przeczytanego pod polityką RLS tenanta. Bucket jest PUBLICZNY (odczyt
 * anonimowy), więc kto zna ścieżkę, ten pobierze plik — ścieżka nie ma prawa
 * przyjść z parametru URL, formularza ani nazwy pliku. Sonda
 * `catalog-list-isolation.test.ts` pilnuje tego zachowaniem.
 */
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-image-file";

/**
 * Publiczny URL zdjęcia z bucketu `product-images`. Składamy wprost — bez
 * podpisu i bez klienta Supabase (to samo, co `storage.from(bucket)
 * .getPublicUrl` robi bez sieci).
 */
export function productImagePublicUrl(supabaseUrl: string, storagePath: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/${path}`;
}

/** Wiersz `product_images` w kolejności, w jakiej czyta go lista. */
export interface ProductImageRow {
  product_id: string;
  storage_path: string;
  alt_text: string | null;
}

export interface ProductThumbnail {
  url: string;
  /**
   * Pusty `alt` przy braku `alt_text` = obraz DEKORACYJNY. Nazwy pliku ani
   * nazwy produktu tu nie wstawiamy: nazwa produktu stoi w sąsiedniej
   * komórce, więc czytnik ekranu ogłaszałby ją dwa razy, a nazwa pliku
   * („IMG_2481.jpg") nie niesie żadnej informacji.
   */
  alt: string;
}

/**
 * Pierwsze zdjęcie każdego produktu → miniatura. Wejście MUSI być już
 * posortowane po `(sort_order, created_at)` — kolejność nadaje zapytanie
 * (`lib/catalog/list-query.ts`), zgodnie z indeksem
 * `product_images_tenant_product_idx (tenant_id, product_id, sort_order,
 * created_at)` z 0018. Wygrywa PIERWSZY
 * napotkany wiersz danego produktu.
 */
export function pickProductThumbnails(
  images: readonly ProductImageRow[],
  supabaseUrl: string,
): Map<string, ProductThumbnail> {
  const thumbnails = new Map<string, ProductThumbnail>();
  for (const image of images) {
    if (thumbnails.has(image.product_id)) continue;
    thumbnails.set(image.product_id, {
      url: productImagePublicUrl(supabaseUrl, image.storage_path),
      alt: image.alt_text?.trim() ?? "",
    });
  }
  return thumbnails;
}
