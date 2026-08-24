/**
 * schema.org (JSON-LD) dla stron tenanta — Zadanie 2.7, ADR-044.
 *
 * ŹRÓDŁO DANYCH: WYŁĄCZNIE publiczny kontrakt (`app.get_public_catalog` /
 * `app.get_published_site`). Do znaczników nie trafia nic, czego anonimowy
 * kupujący i tak nie widzi na stronie: żadnych identyfikatorów wewnętrznych
 * poza `product_id` (który jest w URL-u podstrony), żadnych numerów
 * egzemplarzy, adresów powiadomień ani konfiguracji tenanta. Builder przyjmuje
 * jawnie wypisane pola — nie cały obiekt tenanta — więc rozszerzenie kontraktu
 * po stronie bazy NIE wycieknie tu przypadkiem.
 *
 * BRAMKA XSS (`serializeJsonLd`): treść pochodzi od najemcy i ląduje w bloku
 * `<script type="application/ld+json">`. `JSON.stringify` sam w sobie NIE
 * wystarcza — ciąg `</script>` w nazwie produktu zamknąłby blok i wszystko po
 * nim przeglądarka potraktowałaby jako HTML. Dlatego po serializacji uciekamy
 * `<`, `>`, `&` oraz separatory linii U+2028/U+2029 do sekwencji `\uXXXX`.
 * Wynik jest nadal poprawnym JSON-em (parsery rozwijają `\uXXXX`), a wyjście z
 * kontekstu skryptu staje się niemożliwe. To ta sama ostrożność, którą po
 * stronie renderu treści realizuje `SafeRichText` (@avably/ui/site): nigdy nie
 * ufamy tekstowi najemcy jako znacznikom.
 */

/** Grosze → kwota dziesiętna w formacie schema.org („12000” → „120.00”). */
export function groszeToDecimal(grosze: number): string {
  const safe = Number.isFinite(grosze) ? Math.round(grosze) : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Serializuje obiekt do bezpiecznej zawartości `<script type="application/ld+json">`.
 * Patrz docblock modułu — bez tego escapowania `</script>` w danych tenanta
 * wychodzi z kontekstu skryptu.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export interface PostalAddressInput {
  street: string | null;
  zip: string | null;
  city: string | null;
}

/** PostalAddress tylko gdy jest cokolwiek do pokazania — inaczej `undefined`. */
function postalAddress(address: PostalAddressInput | null | undefined): Record<string, unknown> | undefined {
  if (!address) return undefined;
  const entries: Record<string, unknown> = { "@type": "PostalAddress" };
  if (address.street) entries.streetAddress = address.street;
  if (address.zip) entries.postalCode = address.zip;
  if (address.city) entries.addressLocality = address.city;
  return Object.keys(entries).length > 1 ? entries : undefined;
}

export interface LocalBusinessInput {
  name: string;
  url: string;
  /** Adres PUNKTU ODBIORU (publiczny kontrakt katalogu), gdy tenant go ma. */
  address?: PostalAddressInput | null;
  /** Opis ze strony opublikowanej (hero) — opcjonalny. */
  description?: string | null;
}

export function localBusinessJsonLd(input: LocalBusinessInput): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: input.name,
    url: input.url,
  };
  if (input.description) node.description = input.description;
  const address = postalAddress(input.address);
  if (address) node.address = address;
  return node;
}

export interface BreadcrumbItem {
  /** Etykieta okruszka (nazwa sklepu, nazwa kategorii) — tekst od najemcy. */
  name: string;
  /** Absolutny adres celu okruszka. */
  url: string;
}

/**
 * BreadcrumbList (schema.org) — ścieżka „Sklep > Kategoria" na stronie
 * kategorii (faza C, ADR-247). `position` jest 1-based i idzie w kolejności
 * tablicy, więc wołający podaje okruszki OD KORZENIA do bieżącej strony.
 *
 * Treść (nazwa kategorii) pochodzi od najemcy i przechodzi przez
 * `serializeJsonLd` tak samo jak Product/LocalBusiness — `</script>` w nazwie
 * kategorii nie wychodzi z kontekstu skryptu (patrz docblock modułu).
 */
export function breadcrumbListJsonLd(items: BreadcrumbItem[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export interface ProductJsonLdInput {
  name: string;
  description?: string | null;
  /** Absolutne URL-e zdjęć z publicznego bucketu. */
  images?: string[];
  /** Kanoniczny adres podstrony produktu. */
  url: string;
  currency: string;
  /** Cena WYJŚCIOWA za dobę (grosze) — „od”, bo progi cenowe ją obniżają. */
  basePriceDayGrosze: number;
}

/**
 * Product + Offer. Cena to stawka ZA DOBĘ — wyrażona jawnie przez
 * `UnitPriceSpecification` z `referenceQuantity` 1 DAY, żeby wyszukiwarka nie
 * czytała jej jako ceny sprzedaży egzemplarza. `businessFunction` LeaseOut
 * (GoodRelations) mówi wprost: to wynajem, nie sprzedaż.
 *
 * `availability: InStock` znaczy tu „pozycja jest w publicznej ofercie" —
 * katalog publiczny zawiera wyłącznie produkty AKTYWNE. Dostępność w
 * KONKRETNYM terminie zależy od dat i sprawdza ją `get_public_availability`
 * przy wyborze terminu; znacznik statyczny nie ma jak jej wyrazić i celowo nie
 * udaje, że wie.
 */
export function productJsonLd(input: ProductJsonLdInput): Record<string, unknown> {
  const price = groszeToDecimal(input.basePriceDayGrosze);
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    offers: {
      "@type": "Offer",
      url: input.url,
      price,
      priceCurrency: input.currency,
      availability: "https://schema.org/InStock",
      businessFunction: "http://purl.org/goodrelations/v1#LeaseOut",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: input.currency,
        referenceQuantity: { "@type": "QuantitativeValue", value: 1, unitCode: "DAY" },
      },
    },
  };
  if (input.description) node.description = input.description;
  if (input.images && input.images.length > 0) node.image = input.images;
  return node;
}
