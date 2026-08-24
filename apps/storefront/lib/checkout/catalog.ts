/**
 * Publiczny odczyt katalogu i dostępności storefrontu (Zadanie 2.4a) —
 * WARSTWA DANYCH dla katalogu/koszyka 2.4b (komponenty powstają osobno).
 *
 * Jedyne ścieżki: app.get_public_catalog / app.get_public_availability (0020,
 * SECURITY DEFINER — wzorzec ADR-039/041). Anonimowy odwiedzający nie ma grantów
 * na products/product_units/... — RPC zwracają jawnie wybrane kolumny (bez
 * credentiali, bez numerów seryjnych, bez danych zamówień) i NULL dla tenanta
 * nieaktywnego / produktu nieosiągalnego. Fail-closed: błąd transportu = NULL.
 *
 * `client` wstrzykiwalny dla testów; produkcyjnie klient anon z cookies.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProductSlugRegistry } from "@avably/core";

import { createSupabaseServerClient } from "@/lib/supabase-server";

import { customFieldsFromPublicRows } from "./custom-fields";
import type {
  PublicAvailability,
  PublicAvailabilityDays,
  PublicCatalog,
  PublicCatalogAvailability,
  PublicCatalogPage,
  PublicCategoryPage,
  PublicCustomField,
  PublicProductEnvelope,
} from "./contract";

/**
 * Definicje pól własnych ZAMAWIANIA (C6-A3, 0058) — osobno od katalogu, bo
 * ścieżka ZAPISU (rdzeń checkoutu) potrzebuje ich przy każdym żądaniu, a nie
 * potrzebuje przy tym całego katalogu z cennikiem i zdjęciami. Strona
 * checkoutu bierze te same definicje z katalogu, który i tak już czyta.
 *
 * BŁĄD ODCZYTU ≠ BRAK PÓL. Odwrotnie niż `get_public_catalog`/`_availability`
 * (gdzie null = „online niedostępne", tor offline działa dalej), TA lista
 * bramkuje egzekwowanie pól WYMAGANYCH przy zapisie. Gdyby błąd transportu
 * dawał pustą listę, chwilowy blip zdejmowałby wymagalność — 201 i zamówienie
 * bez pola, które najemca oznaczył jako obowiązkowe. Dlatego RZUCAMY na błąd:
 * rdzeń checkoutu łapie to i ZAMYKA ścieżkę (odmowa), zamiast przepuścić.
 * Ścieżka RENDEROWANIA definicji nie wchodzi tędy — bierze je z katalogu
 * (`get_public_catalog`), więc odmowa dotyka wyłącznie ZAPISU.
 */
export async function getPublicCustomFields(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublicCustomField[]> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_custom_fields", { p_tenant_id: tenantId });

  if (error) {
    throw new Error(
      `Odczyt definicji pól własnych nie powiódł się (${error.code ?? error.message}).`,
    );
  }
  // Brak błędu, ale nie-tablica (np. najemca nieaktywny → null): PRAWDZIWY brak
  // pól, a nie awaria — pusta lista jest tu poprawną odpowiedzią.
  if (!Array.isArray(data)) return [];
  return data as PublicCustomField[];
}

/** To samo, ale w kształcie domenowym — tak, jak chce rdzeń pól własnych. */
export async function readCheckoutCustomFieldDefinitions(
  tenantId: string,
  client?: SupabaseClient,
) {
  return customFieldsFromPublicRows(await getPublicCustomFields(tenantId, client));
}

export async function getPublicCatalog(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublicCatalog | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_catalog", { p_tenant_id: tenantId });

  if (error || data == null) return null;
  return data as PublicCatalog;
}

/**
 * WĄSKI ODCZYT JEDNEJ POZYCJI dla strony sprzętu (0084, ADR-185).
 *
 * ==================== CO ZASTĘPUJE ====================
 *
 * DWA odczyty O(N) naraz: pełny katalog (`get_public_catalog`) i rejestr
 * adresów (`get_public_product_slugs`). Do ADR-185 strona sprzętu ciągnęła oba
 * — pierwszy po to, żeby znaleźć w nim jeden wiersz, drugi po to, żeby
 * rozstrzygnąć adres. Zmierzone na katalogu 200 pozycji: 227 019 + 15 440
 * bajtów na odsłonę wobec ~1 300 bajtów tej koperty.
 *
 * ==================== DLACZEGO WSKAZANIE JEST SUMĄ, A NIE DWIEMA FUNKCJAMI ====================
 *
 * Trasa kanoniczna wskazuje slugiem, trasa zastana identyfikatorem, ale obie
 * potrzebują DOKŁADNIE tej samej odpowiedzi. Dwie funkcje warstwy danych
 * znaczyłyby dwa zbiory pozycji osiągalnych publicznie — a rozjazd między nimi
 * byłby cichy i widoczny dopiero jako 404 pod jednym z dwóch adresów tej samej
 * pozycji.
 *
 * FAIL-CLOSED jak katalog: błąd transportu / najemca poza oknem handlowym →
 * `null`, czyli dla trasy to samo, co „nie ma takiej pozycji". Odwrotny wybór
 * (renderuj mimo nieudanego odczytu) nie ma czego renderować.
 */
export async function getPublicProduct(
  tenantId: string,
  target: { slug: string } | { productId: string },
  client?: SupabaseClient,
): Promise<PublicProductEnvelope | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_product", {
    p_tenant_id: tenantId,
    p_slug: "slug" in target ? target.slug : null,
    p_product_id: "productId" in target ? target.productId : null,
  });

  if (error || data == null) return null;
  return data as PublicProductEnvelope;
}

/**
 * JEDNA STRONA KATALOGU dla trasy `/katalog` (0085, ADR-186).
 *
 * ==================== DLACZEGO NIE WYCINEK Z PEŁNEJ KOPERTY ====================
 *
 * Odczyt całego katalogu i pokazanie z niego 24 pozycji kosztuje przy 200
 * pozycjach 227 019 bajtów na odsłonę (zmierzone, ADR-185) — czyli dokładnie
 * ten koszt, który faza 4a właśnie zdjęła ze strony sprzętu. Okno wyników
 * liczy BAZA, więc koszt odsłony jest O(strony) i nie rośnie razem z ofertą
 * najemcy.
 *
 * ==================== DLACZEGO TA KOPERTA NIE IDZIE PRZEZ CACHE ====================
 *
 * Cache katalogu (ADR-185) stoi na JEDNYM kluczu na najemcę i na tym, że panel
 * ten klucz KASUJE przy każdej mutacji koperty publicznej. Strony wyników to
 * rodzina kluczy, której panel nie kasuje — a cache, którego nie ma jak
 * unieważnić, to nie jest cache, tylko obietnica pokazywania nieaktualnej ceny
 * przez TTL. Powód, dla którego cache w ogóle powstał (227 KB na odsłonę),
 * w tym odczycie nie występuje.
 *
 * FAIL-CLOSED jak katalog: błąd transportu / najemca poza oknem handlowym →
 * `null`, czyli dla trasy to samo, co „nie ma czego pokazać".
 */
export async function getPublicCatalogPage(
  tenantId: string,
  offset: number,
  limit: number,
  client?: SupabaseClient,
): Promise<PublicCatalogPage | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_catalog_page", {
    p_tenant_id: tenantId,
    p_offset: offset,
    p_limit: limit,
  });

  if (error || data == null) return null;
  return data as PublicCatalogPage;
}

/**
 * JEDNA STRONA JEDNEJ KATEGORII dla trasy `/kategoria/{slug}` (0101, ADR-244).
 *
 * ==================== DLACZEGO OSOBNY ODCZYT, A NIE FILTR KATALOGU ====================
 *
 * Odfiltrowanie kategorii z pełnego katalogu w pamięci procesu wraca do kosztu
 * O(katalogu) na odsłonę — dokładnie tego, który stronicowanie katalogu zdjęło
 * (ADR-186). Baza tnie okno wyników PO stronie i sortowaniu, więc koszt jest
 * O(strony kategorii), a nie rośnie z ofertą najemcy.
 *
 * TRZY STANY NIESIE KOPERTA, nie ta funkcja (patrz `PublicCategoryPage`):
 * `null` = najemca poza oknem handlowym / błąd transportu (trasa: 404, jak
 * katalog); `data.category === null` = slug nieznany (trasa: 404);
 * `data.category = {meta}` = kategoria istnieje (trasa renderuje, także pustą).
 * Rozstrzygnięcie „404 vs pusty widok" należy do trasy — tu przenosimy kopertę
 * co do znaku.
 *
 * FAIL-CLOSED jak reszta warstwy: błąd transportu → `null`, czyli dla trasy to
 * samo, co „nie ma czego pokazać".
 */
export async function getPublicCategoryPage(
  tenantId: string,
  slug: string,
  page: number,
  pageSize: number,
  sort: string,
  client?: SupabaseClient,
): Promise<PublicCategoryPage | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_category_page", {
    p_tenant_id: tenantId,
    p_slug: slug,
    p_page: page,
    p_page_size: pageSize,
    p_sort: sort,
  });

  if (error || data == null) return null;
  return data as PublicCategoryPage;
}

export async function getPublicAvailability(
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicAvailability | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_availability", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicAvailability;
}

/**
 * Dostępność CAŁEGO katalogu jednym odczytem (0081, ADR-179).
 *
 * Istnieje po to, żeby katalog i wykrywanie konfliktu w koszyku nie robiły
 * jednego zapytania NA POZYCJĘ. Fail-closed jak reszta warstwy: błąd transportu
 * daje `null`, czyli „dostępności nie znamy" — nigdy pustej listy, bo pusta
 * lista znaczyłaby „najemca nie ma ani jednej pozycji" i cicho zdejmowałaby
 * blokadę kasy przy konflikcie.
 */
export async function getPublicCatalogAvailability(
  tenantId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicCatalogAvailability | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_catalog_availability", {
    p_tenant_id: tenantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicCatalogAvailability;
}

/**
 * Dostępność DZIENNA jednego sprzętu (0081, ADR-179) — dane dla siatki
 * kalendarza na stronie sprzętu. Baza odmawia okna szerszego niż
 * `AVAILABILITY_WINDOW_MAX_DAYS`, oddając `null`; ta warstwa go tylko przenosi.
 */
export async function getPublicAvailabilityDays(
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
  client?: SupabaseClient,
): Promise<PublicAvailabilityDays | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase.schema("app").rpc("get_public_availability_days", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

  if (error || data == null) return null;
  return data as PublicAvailabilityDays;
}

/**
 * REJESTR ADRESÓW SPRZĘTU (0083, ADR-182) — adresy bieżące i stare, jednym
 * odczytem.
 *
 * DLACZEGO OSOBNE WYWOŁANIE, A NIE KLUCZ W KATALOGU. Migracje jadą na produkcję
 * PRZED kodem, a koperta katalogu jest po stronie sklepu parsowana schematem,
 * który nowego klucza nie zna — bezwarunkowy `slug` przy pozycji położyłby sklep
 * KAŻDEGO najemcy na czas okna wdrożeniowego. Nowa funkcja nie ma jak niczego
 * zepsuć, bo w oknie NIKT jej nie woła (ten sam argument, co ADR-171 dla
 * wyglądu). Koszt jest jawny i policzony: jedno wywołanie RÓWNOLEGLE
 * z pozostałymi w `loadStorefrontContext`, więc zero dodatkowych podróży
 * w czasie odpowiedzi.
 *
 * FAIL-SOFT, NIE FAIL-CLOSED — i to jest świadoma różnica względem katalogu.
 * `null` znaczy „adresów nie znamy", a wtedy sklep linkuje pozycje adresem
 * ZASTANYM (`/product/{id}`), który dalej działa. Gdyby ten odczyt gasił całą
 * stronę jak katalog, chwilowy blip zamieniałby brak ADRESU w brak SKLEPU.
 */
export async function getPublicProductSlugs(
  tenantId: string,
  client?: SupabaseClient,
): Promise<ProductSlugRegistry | null> {
  const supabase = client ?? (await createSupabaseServerClient());
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_public_product_slugs", { p_tenant_id: tenantId });

  if (error || data == null) return null;
  return data as ProductSlugRegistry;
}
