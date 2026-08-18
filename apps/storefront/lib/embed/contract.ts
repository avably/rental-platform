/**
 * Kontrakt embedu rezerwacji (M3, ADR-120).
 *
 * Embed to JEDYNA nasza powierzchnia, która z założenia jest wywoływana ze
 * strony, której NIE kontrolujemy. Cały kontrakt jest zbudowany wokół jednego
 * rozstrzygnięcia: fragment do wklejenia tworzy RAMKĘ z dokumentem na NASZYM
 * origin, a nie renderuje niczego w DOM gospodarza. Konsekwencje, które ten
 * plik utrwala:
 *
 *   * TENANT NIE JEST PARAMETREM. Bierze się z hosta (`<slug>.avably.pl`),
 *     rozwiązanego w proxy i wstrzykniętego jako `x-tenant-id` PO
 *     `stripInboundTenantHeaders`. Strona gospodarza nie ma jak go podmienić —
 *     może najwyżej wskazać ramką inny PUBLICZNY sklep, co jest równoważne
 *     wejściu na jego adres.
 *   * ŻADEN SEKRET NIE ISTNIEJE PO STRONIE PRZEGLĄDARKI. Embed nie dotyka
 *     `/api/v1/**` i nie zna klucza API najemcy — dane czyta serwerowo tymi
 *     samymi publicznymi RPC (`app.get_public_*`), co zwykły sklep. Klucz nie
 *     jest tu ukryty; go tu po prostu NIE MA.
 *   * ZAPIS JEST WYŁĄCZNIE SAME-ORIGIN. Formularz żyje w naszej ramce, więc
 *     jedyny legalny wołający zapisu to nasz własny dokument. Dlatego trasy
 *     embedu nie wysyłają `Access-Control-Allow-Origin` NIGDY — ani `*`, ani
 *     listy — a żądanie z obcego origin odbijamy SERWEROWO (patrz origin.ts).
 */

/** Prefiks wszystkich tras embedu — wycinka z bramki hasła w proxy idzie po nim. */
export const EMBED_PATH_PREFIX = "/embed/";

export const EMBED_LOADER_PATH = "/embed/loader";
export const EMBED_WIDGET_PATH = "/embed/widget";
export const EMBED_MONTH_PATH = "/embed/api/month";
export const EMBED_RESERVATION_PATH = "/embed/api/reservations";

/**
 * Atrybuty fragmentu do wklejenia. Wszystkie są JAWNIE zaprojektowanymi
 * parametrami prezentacji — żaden nie steruje tym, do jakiego najemcy idzie
 * żądanie (to robi wyłącznie host w adresie skryptu).
 */
export const EMBED_ATTR_PRODUCT = "data-avably-product";
export const EMBED_ATTR_LANG = "data-avably-lang";
export const EMBED_ATTR_THEME = "data-avably-theme";

export const EMBED_THEMES = ["light", "dark"] as const;
export type EmbedTheme = (typeof EMBED_THEMES)[number];

/** Kody błędów embedu — świadomie UBOŻSZE niż v1: front na cudzej stronie nie dostaje diagnostyki. */
export type EmbedErrorCode =
  | "forbidden_origin"
  | "store_unavailable"
  | "rate_limited"
  | "validation_failed"
  | "not_found"
  | "conflict"
  | "rejected"
  /** Najemca nie opublikował wymaganych dokumentów prawnych (ADR-191). */
  | "legal_documents_missing"
  | "server_error";

export interface EmbedErrorBody {
  error: { code: EmbedErrorCode; fields?: Record<string, string> };
}

/**
 * Mapa dnia miesiąca. Wartość = DOLNE OGRANICZENIE liczby wolnych sztuk
 * (`app.get_public_availability` odpowiada dla ZAKRESU, nie dla dnia), więc
 * `0` znaczy „API powiedziało: zajęty", a dzień, o który rozstrzyganie nie
 * zdążyło zapytać, NIE TRAFIA TU W OGÓLE — wychodzi listą `unresolved`.
 * To jest lekcja ADR-114 (decyzja 2b): degradacja nie ma prawa udawać wyniku.
 */
export interface EmbedMonthPayload {
  month: string;
  days: Record<string, number>;
  unresolved: string[];
  partial: boolean;
}

/**
 * Nagłówki wspólne wszystkim odpowiedziom tras danych embedu.
 *
 * BEZ `Access-Control-Allow-Origin` — patrz docblock pliku. `no-store`, bo
 * odpowiedź zależy od tego, KTO pyta, i nie ma prawa wylądować we wspólnym
 * cache'u pośrednika. `Vary` wymienia OBA nagłówki, po których rozstrzyga
 * bramka (origin.ts): sam `Origin` nie wystarczy, bo przy same-origin GET
 * przeglądarka go nie wysyła i o wpuszczeniu decyduje `Sec-Fetch-Site` —
 * pośrednik kluczujący wyłącznie po `Origin` skleiłby te dwa przypadki.
 */
const EMBED_RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  vary: "Origin, Sec-Fetch-Site",
} as const;

/** Jednolita odpowiedź błędu — kody świadomie ubogie, bez diagnostyki. */
export function embedError(
  status: number,
  code: EmbedErrorCode,
  fields?: Record<string, string>,
): Response {
  const body: EmbedErrorBody = { error: { code, ...(fields ? { fields } : {}) } };
  return new Response(JSON.stringify(body), { status, headers: { ...EMBED_RESPONSE_HEADERS } });
}

/** Odpowiedź sukcesu tras danych embedu — ta sama polityka nagłówków co błąd. */
export function embedJson(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...EMBED_RESPONSE_HEADERS } });
}
