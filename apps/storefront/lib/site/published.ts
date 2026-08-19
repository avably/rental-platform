/**
 * Publiczny odczyt opublikowanej strony tenanta (Zadanie 2.3a, ADR-041) —
 * WARSTWA DANYCH dla renderu 2.3b (komponenty powstają osobno).
 *
 * Jedyna ścieżka: app.get_published_site (0019, SECURITY DEFINER — wzorzec
 * ADR-039). Anonimowy odwiedzający nie ma grantów na sites/site_sections;
 * RPC zwraca WYŁĄCZNIE opublikowany stan (template, published_at, sekcje
 * enabled z content_published, posortowane po position) i NULL dla tenanta
 * nieaktywnego / strony nieopublikowanej — nieodróżnialnie od nieistniejącej.
 *
 * Odpowiedź jest parsowana schematami @avably/core/site: powłoka fail-closed,
 * sekcje degradują się indywidualnie (parsePublishedSite) — zła sekcja znika,
 * nie kładzie sklepu.
 *
 * Cache: trasa tenancka jest dziś force-dynamic (CSP nonce, patrz store/page),
 * więc odczyt idzie świeżo per żądanie. Tag tenanta (tenantCacheTag) emitowany
 * przez publikację w panelu to przygotowany seam pod ISR/data-cache (2.4/2.6)
 * — wpis cache owinięty tym tagiem będzie unieważniany bez zmiany kontraktu.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  HOME_PAGE_SLUG,
  parsePublishedSite,
  parseSiteLogo,
  resolveSiteStyle,
  siteStyleSchema,
  siteTemplateSchema,
  type PublishedSite,
  type ResolvedSiteStyle,
  type SiteLogo,
  type SiteStyle,
  type SiteTemplate,
} from "@avably/core/site";

import { createSupabaseServerClient } from "@/lib/supabase-server";

export type { PublishedSite, PublishedSection } from "@avably/core/site";

/**
 * Opublikowana strona tenanta albo null (brak strony / nieopublikowana /
 * tenant nieaktywny / odpowiedź w nieznanym kształcie — fail-closed).
 * `client` wstrzykiwalny dla testów; produkcyjnie klient anon z cookies.
 */
export async function getPublishedSite(
  tenantId: string,
  client?: SupabaseClient,
): Promise<PublishedSite | null> {
  return getPublishedPage(tenantId, HOME_PAGE_SLUG, client);
}

/**
 * Opublikowana strona najemcy POD WSKAZANYM ADRESEM (Faza 2, 0074, ADR-158).
 *
 * Pusty slug to strona główna — i to jest jedyna różnica między tą funkcją
 * a `getPublishedSite`, która od Fazy 2 jest właśnie jej wywołaniem. Jedna
 * droga odczytu, jeden kształt parsowania: druga kopia tego ciała rozjechałaby
 * się z pierwszą przy najbliższej zmianie koperty, a koperta jest `.strict()`.
 *
 * IZOLACJA. `app.get_published_page` jest SECURITY DEFINER, więc RLS jej nie
 * dotyczy — bramką są jawne argumenty. `tenantId` przychodzi WYŁĄCZNIE
 * z nagłówka wstrzykniętego przez proxy z rozwiązania server-side po hoście
 * (lib/tenant/headers.ts zdejmuje przychodzące nagłówki bezwarunkowo), więc
 * slug podany przez odwiedzającego nie ma jak dosięgnąć cudzego najemcy.
 */
export async function getPublishedPage(
  tenantId: string,
  slug: string,
  client?: SupabaseClient,
): Promise<PublishedSite | null> {
  const supabase = client ?? (await createSupabaseServerClient());

  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });

  // Fail-closed: błąd transportu/API jest dla odwiedzającego tym samym, czym
  // brak strony — storefront pokaże 404/pustkę, nie stacktrace.
  if (error || data == null) return null;

  return parsePublishedSite(data);
}

/**
 * OPUBLIKOWANA STRONA SPRZĘTU najemcy (faza 5, 0080, ADR-178; wyjątek
 * per produkt — faza 6A, 0088, ADR-199).
 *
 * ==================== DRABINA: WYJĄTEK > SZABLON-MATKA > WBUDOWANA ====================
 *
 * Od ADR-199 najemca może dać WYBRANEMU produktowi własną stronę — osobny
 * wiersz `sites` przypięty po ID produktu (nigdy po slugu). Rozstrzyganie
 * stoi W BAZIE (`app.get_published_product_template`, drugi argument
 * `p_product_id`): żywy wyjątek wskazanego produktu wygrywa z żywym
 * szablonem-matką; `null` dalej znaczy „oddaj stronę wbudowaną" i ta granica
 * jest trzecim szczeblem drabiny — po stronie sklepu, nie bazy. Wołający
 * podaje `productId` z pozycji spod adresu; pominięcie go (stare wywołania)
 * jest legalne i oddaje matkę — dokładnie stan sprzed fazy 6A.
 *
 * ==================== `null` ZNACZY „ODDAJ WBUDOWANĄ STRONĘ" ====================
 *
 * I to jest jedyna rzecz, którą wołający musi o tej funkcji wiedzieć. Granica
 * przebiega po PUBLIKACJI, nie po zawartości: najemca bez opublikowanego
 * szablonu — czyli na dziś każdy — dostaje dokładnie tę stronę sprzętu, którą
 * dostawał przed fazą 5. Wdrożenie nie ma prawa zabrać działającej funkcji.
 *
 * Odwrotna strona tej samej granicy jest równie ostra: szablon OPUBLIKOWANY
 * obowiązuje także wtedy, gdy jest ubogi albo pusty. Podmienianie go z powrotem
 * na wbudowaną stronę byłoby dokładnie tym kłamstwem interfejsu, które
 * naprawiały ADR-171 i ADR-172 — „opublikowałem i widzę co innego".
 *
 * ==================== DLACZEGO OSOBNA FUNKCJA, A NIE `getPublishedPage` ====================
 *
 * Bo szablon NIE MA ADRESU, a tamta funkcja pyta adresem. Rozdział jest już
 * w bazie (`app.get_published_product_template` kontra `app.get_published_page`,
 * 0080) i tutaj tylko go odwzorowujemy. Parsowanie zostaje WSPÓLNE
 * (`parsePublishedSite`), bo koperta jest identyczna co do klucza — druga kopia
 * tego ciała rozjechałaby się z pierwszą przy najbliższej zmianie koperty,
 * a koperta jest `.strict()`.
 *
 * FAIL-CLOSED, jak `getPublishedPage`: błąd transportu jest dla odwiedzającego
 * tym samym, czym brak szablonu — zobaczy wbudowaną stronę sprzętu, a nie
 * pustą ramkę. To jest właściwy kierunek degradacji, bo wbudowana strona ma
 * komplet informacji o sprzęcie i przycisk rezerwacji.
 *
 * IZOLACJA. `app.get_published_product_template` jest SECURITY DEFINER, więc
 * RLS jej nie dotyczy — bramką jest jawne zawężenie `s.tenant_id = p_tenant_id`
 * w ciele, a `tenantId` przychodzi WYŁĄCZNIE z nagłówka wstrzykniętego przez
 * proxy po rozwiązaniu hosta server-side (lib/tenant/headers.ts zdejmuje
 * przychodzące nagłówki bezwarunkowo). Odwiedzający nie ma czym wskazać
 * cudzego najemcy.
 */
export async function getPublishedProductTemplate(
  tenantId: string,
  productId?: string,
  client?: SupabaseClient,
): Promise<PublishedSite | null> {
  const supabase = client ?? (await createSupabaseServerClient());

  // `p_product_id` jedzie ZAWSZE (jawny null zamiast pominięcia): jeden
  // kształt wywołania RPC, a null po stronie bazy znaczy to samo, co domyślka
  // okna wdrożeniowego — szablon-matka, zbiór sprzed 0088.
  const { data, error } = await supabase
    .schema("app")
    .rpc("get_published_product_template", {
      p_tenant_id: tenantId,
      p_product_id: productId ?? null,
    });

  if (error || data == null) return null;

  return parsePublishedSite(data);
}

/**
 * STYL STRONY w postaci, w której posługuje się nim render (K5, ADR-090):
 * szablon, akcent i para fontów uzupełnione o wartości domyślne.
 *
 * Rozstrzygnięcie stoi TUTAJ, a nie w komponencie trasy, z trzech powodów:
 *
 *   1. SZABLON MA OD K5 DWA ŹRÓDŁA. `sites.template` jest kolumną ZASTANĄ —
 *      strona sprzed ADR-090 nie ma zapisanego stylu, więc kolumna zostaje
 *      jedynym źródłem; strona, która przeszła przez panel stylu, niesie
 *      szablon w jsonb i to on obowiązuje. Dwa niezależne odczyty rozjechałyby
 *      się dokładnie w dniu, w którym operator zmieni szablon w kreatorze —
 *      i to jest ten rodzaj rozjazdu, który widać dopiero u klienta.
 *   2. BRAK STRONY MA MIEĆ STYL. `null` (nieopublikowana / tenant nieaktywny)
 *      dostaje styl domyślny zamiast zmuszać każdą trasę do własnego `?:`.
 *   3. TESTOWALNOŚĆ SZWU. Cały tor „koperta RPC → tokeny na korzeniu strony"
 *      da się przejechać bez nagłówków żądania i bez bazy (test site-style).
 *
 * Fail-soft jest w `resolveSiteStyle`: styl w nieznanym kształcie znaczy
 * „strona wygląda domyślnie", a nie „strona nie wygląda wcale".
 */
export function publishedSiteStyle(site: PublishedSite | null): ResolvedSiteStyle {
  return resolveSiteStyle(site?.style, site?.template);
}

// -----------------------------------------------------------------------
// POWŁOKA SKLEPU TOREM NAJEMCY (ADR-171, migracja 0079)
// -----------------------------------------------------------------------

/**
 * ZNAK FIRMY I WYGLĄD SKLEPU — własność NAJEMCY, nie żadnej ze stron.
 *
 * Ten sam kształt, co odpowiadające klucze koperty strony, i to jest decyzja:
 * jedno miejsce, w którym rozstrzyga się allowlista motywów i kształt znaku.
 */
export interface TenantAppearance {
  template: SiteTemplate;
  /** Styl w kształcie zapisanym; render uzupełnia braki `tenantAppearanceStyle`. */
  style: SiteStyle;
  /** Znak firmy albo `null` — brak znaku jest stanem NORMALNYM (ADR-160). */
  logo: SiteLogo | null;
}

/**
 * Powłoka najemcy, o którym nic nie wiadomo: motyw zastany, żadnego stylu,
 * żadnego znaku. Dokładnie to, co sklep pokazywał przed ADR-090 i ADR-160 —
 * więc nieudany odczyt nie zmienia wyglądu, tylko go NIE POPRAWIA.
 */
export const DEFAULT_TENANT_APPEARANCE: TenantAppearance = {
  template: "classic",
  style: {},
  logo: null,
};

/**
 * POWŁOKA SKLEPU CZYTANA TOREM NAJEMCY (ADR-171).
 *
 * DLACZEGO NIE KOPERTĄ STRONY GŁÓWNEJ, którą sklep czytał do tej pory. Znak
 * i wygląd są od 0076/0077 własnością NAJEMCY, a koperta strony niosła je
 * wyłącznie dlatego, że akurat tamtędy przechodził odczyt. Najemca
 * z opublikowaną PODSTRONĄ i nieopublikowaną stroną główną nie dostawał ani
 * znaku, ani motywu — na żadnej trasie, bo trasy bez wiersza `sites`
 * (katalog, koszyk, kasa, dokumenty prawne) i tak sięgały po tę samą pustą
 * kopertę. To jest stan DOMYŚLNY nowego najemcy, nie przypadek brzegowy.
 *
 * Stopka zostaje przy stronie głównej i dalej jedzie kopertą (ADR-154):
 * powłoka ma po ADR-171 dwóch właścicieli i ta funkcja obsługuje wyłącznie
 * tego, którym jest najemca.
 *
 * FAIL-SOFT, nie fail-closed — inaczej niż `getPublishedPage`. Nierozpoznana
 * odpowiedź znaczy „sklep wygląda domyślnie", a nie „sklep nie wygląda wcale":
 * powłoka nie jest bramką dostępu do niczego, a wywrócenie strony z powodu
 * kolumny dekoracyjnej zabrałoby klientowi katalog.
 *
 * IZOLACJA. `app.get_tenant_appearance` jest SECURITY DEFINER, więc RLS jej
 * nie dotyczy — bramką jest jawne zawężenie `t.id = p_tenant_id`, a sam
 * `tenantId` przychodzi WYŁĄCZNIE z nagłówka wstrzykniętego przez proxy po
 * rozwiązaniu hosta server-side (lib/tenant/headers.ts zdejmuje przychodzące
 * nagłówki bezwarunkowo).
 */
export async function getTenantAppearance(
  tenantId: string,
  client?: SupabaseClient,
): Promise<TenantAppearance> {
  const supabase = client ?? (await createSupabaseServerClient());

  const { data, error } = await supabase
    .schema("app")
    .rpc("get_tenant_appearance", { p_tenant_id: tenantId });

  if (error || data == null) return DEFAULT_TENANT_APPEARANCE;

  return parseTenantAppearance(data);
}

/** Parsowanie koperty powłoki — wydzielone, bo mierzą je testy bez bazy. */
export function parseTenantAppearance(payload: unknown): TenantAppearance {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return DEFAULT_TENANT_APPEARANCE;
  }
  const raw = payload as Record<string, unknown>;

  const template = siteTemplateSchema.safeParse(raw.template);
  const style = siteStyleSchema.safeParse(raw.style ?? {});

  return {
    template: template.success ? template.data : DEFAULT_TENANT_APPEARANCE.template,
    style: style.success ? style.data : {},
    logo: parseSiteLogo(raw.logo),
  };
}

/**
 * WYGLĄD POWŁOKI w postaci, w której posługuje się nim render — bliźniak
 * `publishedSiteStyle` dla toru najemcy. Rozstrzygnięcie stoi tutaj z tego
 * samego powodu: szablon i styl mają zejść się w JEDNYM miejscu, inaczej
 * zmiana motywu w panelu rozjeżdża się z akcentem u klienta.
 */
export function tenantAppearanceStyle(appearance: TenantAppearance): ResolvedSiteStyle {
  return resolveSiteStyle(appearance.style, appearance.template);
}
