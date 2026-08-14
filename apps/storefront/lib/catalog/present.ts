/**
 * Prezentacja katalogu publicznego (2.4b) — mapuje surowy `PublicCatalog`
 * (kształt RPC app.get_public_catalog, kontrakt 2.4a) na modele widoku:
 * `StorefrontProduct` sekcji @avably/ui oraz parametry wyceny @avably/core.
 *
 * CZYSTE funkcje (bez fetchowania, bez env poza jawnym argumentem `supabaseUrl`)
 * — testowalne bez przeglądarki i bez bazy. Ceny formatuje TU warstwa odczytu
 * (zna locale/walutę tenanta), żeby pakiet UI nie zależał od formatMoney
 * (kontrakt StorefrontProduct: `priceLabel` jest gotowe).
 */
import { formatMoney, type CurrencyCode, type PriceParams } from "@avably/core";
import type { StorefrontProduct, StorefrontProductField } from "@avably/ui";

import type { PublicCatalogProduct, PublicCustomField } from "@/lib/checkout/contract";
import { productFieldRows, type ProductFieldLocale } from "@/lib/catalog/product-fields";

/** Bucket zdjęć produktów — lustro apps/panel (.../zdjecia). */
const PRODUCT_IMAGES_BUCKET = "product-images";

/**
 * Publiczny URL zdjęcia z bucketu `product-images`. Bucket jest publiczny
 * (odczyt anonimowy), więc URL składamy wprost — bez podpisu i bez klienta
 * Supabase (to samo, co `storage.from(bucket).getPublicUrl` robi bez sieci).
 */
export function storagePublicUrl(supabaseUrl: string, storagePath: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  const path = storagePath.replace(/^\/+/, "");
  return `${base}/storage/v1/object/public/${PRODUCT_IMAGES_BUCKET}/${path}`;
}

/** Parametry wyceny dla @avably/core (podgląd na żywo) — lustro calculatePrice. */
export function toPriceParams(product: PublicCatalogProduct): PriceParams {
  return {
    basePriceDayGrosze: product.base_price_day_grosze,
    depositGrosze: product.deposit_grosze,
    autoIncrementMultiplier: product.auto_increment_multiplier,
    tiers: product.pricing_tiers.map((tier) => ({
      tierDays: tier.tier_days,
      multiplier: tier.multiplier,
    })),
  };
}

export interface PriceLabelWords {
  /** np. „od” / „from”. */
  from: string;
  /** np. „doba” / „day”. */
  perDay: string;
}

/** Etykieta ceny karty: „od 120,00 zł / doba”. Cena wyjściowa = base/dobę. */
export function productPriceLabel(
  product: PublicCatalogProduct,
  currency: CurrencyCode,
  locale: string,
  words: PriceLabelWords,
): string {
  const money = formatMoney(product.base_price_day_grosze, currency, locale);
  return `${words.from} ${money} / ${words.perDay}`;
}

export interface PresentProductsOptions {
  supabaseUrl: string;
  currency: CurrencyCode;
  locale: string;
  words: PriceLabelWords;
  /**
   * ŚCIEŻKA strony sprzętu dla danej pozycji (ADR-182).
   *
   * Funkcja, a nie prefiks: od 0083 adres liczy się ze SLUGA pozycji, a nie
   * z jej identyfikatora, więc `prefiks + id` przestało być wyrażeniem, które
   * da się złożyć w tym pliku. Regułę (i degradację przy braku rejestru
   * adresów) niesie `lib/catalog/product-path.ts` — jedno miejsce dla kafla
   * katalogu, kafla sekcji, koszyka, sitemapy i kanonu.
   */
  productHref: (productId: string) => string;
  /**
   * DEFINICJE PÓL WŁASNYCH ZE SKLEPU (faza 1b) — komplet z katalogu publicznego,
   * wszystkie trzy encje. Zawężenie do encji `product` robi `productFieldRows`,
   * bo to jest reguła, nie szczegół wywołania.
   *
   * Brak = kafle bez pól własnych. Stan poprawny dla powierzchni, które
   * katalogu pól nie czytają — a nie zaproszenie do pominięcia go w sklepie.
   */
  customFields?: readonly PublicCustomField[];
  /** Język zapisu wartości pól własnych (data, liczba) — locale sklepu. */
  fieldLocale?: ProductFieldLocale;
}

/** Pierwsze zdjęcie (RPC sortuje po sort_order) → publiczny URL, albo null. */
function firstImageUrl(product: PublicCatalogProduct, supabaseUrl: string): string | null {
  const image = product.images[0];
  return image ? storagePublicUrl(supabaseUrl, image.storage_path) : null;
}

export interface ProductDetailView {
  id: string;
  name: string;
  description: string | null;
  images: { url: string; alt: string }[];
  /** „od 120,00 zł / doba” — cena wyjściowa. */
  basePriceLabel: string;
  /** Sformatowana kaucja, np. „300,00 zł”. */
  depositFormatted: string;
  /** Cena bazowa za dobę sformatowana (do etykiety „X / doba”). */
  perDayFormatted: string;
  /** Parametry wyceny dla podglądu na żywo. */
  priceParams: PriceParams;
  /**
   * SPECYFIKACJA TECHNICZNA (faza 1a, ADR-154) — publiczne pola własne sprzętu
   * w kolejności z panelu ustawień. Pusta lista = sprzęt bez ani jednej
   * wypełnionej wartości, czyli strona bez tabeli (a nie z pustą tabelą).
   */
  specs: StorefrontProductField[];
}

/** Model podstrony produktu: galeria + sformatowane ceny + parametry podglądu. */
export function toProductDetail(
  product: PublicCatalogProduct,
  options: {
    supabaseUrl: string;
    currency: CurrencyCode;
    locale: string;
    words: PriceLabelWords;
    /** Definicje pól własnych ze sklepu — patrz {@link PresentProductsOptions}. */
    customFields?: readonly PublicCustomField[];
    fieldLocale?: ProductFieldLocale;
  },
): ProductDetailView {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    images: product.images.map((image) => ({
      url: storagePublicUrl(options.supabaseUrl, image.storage_path),
      alt: image.alt_text ?? product.name,
    })),
    basePriceLabel: productPriceLabel(product, options.currency, options.locale, options.words),
    depositFormatted: formatMoney(product.deposit_grosze, options.currency, options.locale),
    perDayFormatted: formatMoney(product.base_price_day_grosze, options.currency, options.locale),
    priceParams: toPriceParams(product),
    /*
      TA SAMA FUNKCJA, CO NA KAFLU (faza 1a i 1b naraz). Dwa ekrany pokazujące
      pola własne tego samego sprzętu muszą pokazywać JE SAME i tak samo —
      druga kopia reguły rozjechałaby się przy pierwszej poprawce, a rozjazd
      widać dopiero u klienta najemcy.
    */
    specs: productFieldRows(product, options.customFields ?? [], options.fieldLocale ?? "pl"),
  };
}

/** Mapuje produkty katalogu na modele karty sekcji products (@avably/ui). */
export function toStorefrontProducts(
  products: PublicCatalogProduct[],
  options: PresentProductsOptions,
): StorefrontProduct[] {
  const definitions = options.customFields ?? [];
  const fieldLocale = options.fieldLocale ?? "pl";
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceLabel: productPriceLabel(product, options.currency, options.locale, options.words),
    imageUrl: firstImageUrl(product, options.supabaseUrl),
    imageAlt: product.images[0]?.alt_text ?? product.name,
    href: options.productHref(product.id),
    /*
      POLA WŁASNE JADĄ Z POZYCJĄ, a nie obok niej (faza 1b, ADR-154). Sekcja
      wskazuje w treści identyfikator DEFINICJI, a wartość musi pochodzić od
      TEGO sprzętu — gdyby render dostał jedną wspólną mapę wartości, wskazanie
      rozwiązywałoby się poza pozycją i kafel pokazałby cudzą wartość.
    */
    fields: productFieldRows(product, definitions, fieldLocale),
  }));
}
