/**
 * WYSZUKIWARKA ZDJĘĆ — KLIENT DOSTAWCY (K3, ADR-086).
 *
 * ================== KLUCZ NIE OPUSZCZA SERWERA ==================
 *
 * Zapytania idą WYŁĄCZNIE stąd (moduł serwerowy wołany z Server Action).
 * Klucz mieszka w `UNSPLASH_ACCESS_KEY` — zwykłej zmiennej serwera, NIGDY
 * `NEXT_PUBLIC_*`: wszystko z tym prefiksem jest wpiekane w bundle klienta na
 * etapie builda i staje się publiczne (lekcja z konwencji repo). Klucza nie
 * logujemy nawet przy błędzie — komunikat dla operatora mówi, że wyszukiwanie
 * nie zadziałało, a nie czym się uwierzytelniamy.
 *
 * ================== WARUNKI LICENCJI SĄ CZĘŚCIĄ KONTRAKTU ==================
 *
 * Dostawca wymaga dwóch rzeczy i obie są tu wymuszone kształtem danych, a nie
 * dobrą wolą wołającego:
 *   1. ATRYBUCJA — z każdym zdjęciem jadą nazwisko autora i link do profilu
 *      z parametrami śledzenia; bez nich wynik nie powstaje (zdjęcie bez
 *      kompletu pól jest ODRZUCANE, a nie pokazywane bez podpisu);
 *   2. WYZWALACZ POBRANIA — przy WYBORZE zdjęcia (nie przy wyświetleniu listy)
 *      wołamy `download_location`. To jest warunek regulaminu, nie telemetria
 *      dla nas: dostawca liczy z niego statystyki autora.
 *
 * Zdjęć NIE kopiujemy do naszego bucketa — hotlinkujemy je u dostawcy (też
 * wymóg licencji). Dlatego `image` w schemacie ma jawne dwa światy: `storage`
 * (nasz plik) i `unsplash` (cudzy adres + atrybucja) — patrz ADR-086.
 */
/*
 * TWARDA STRAŻ GRANICY. `server-only` wywala BUILD, gdy ten moduł trafi do
 * bundla klienta — a to jest jedyny moment, w którym taki błąd jest jeszcze
 * tani. Sama dyscyplina importów („przecież wołamy go tylko z akcji") nie
 * broni przed odruchowym `import { searchUnsplash }` w komponencie klienckim,
 * po którym klucz dostawcy wyjeżdża do przeglądarki wraz z resztą kodu.
 * W testach pakiet zastępuje atrapa (alias w `vitest.config.ts`, wzorzec
 * przejęty ze storefrontu) — straż ma pilnować builda, nie Node'a.
 */
import "server-only";

const API = "https://api.unsplash.com";

/** Parametry atrybucji doklejane do linków autora — wymóg regulaminu dostawcy. */
const ATTRIBUTION_QUERY = "utm_source=avably&utm_medium=referral";

export interface UnsplashPhoto {
  id: string;
  /** Adres miniatury do siatki wyników. */
  thumbUrl: string;
  /** Adres zdjęcia do wstawienia na płótno. */
  url: string;
  alt: string;
  authorName: string;
  authorUrl: string;
  downloadLocation: string;
}

export type UnsplashSearchResult =
  | { ok: true; photos: UnsplashPhoto[] }
  | { ok: false; error: string };

/**
 * Czy wyszukiwarka jest w ogóle dostępna. Brak klucza to NORMALNY stan
 * (właściciel rejestruje aplikację osobno), a nie awaria — interfejs ma wtedy
 * UKRYĆ kartę, a nie pokazać zepsutą (fail-safe z briefu K3).
 */
export function unsplashEnabled(): boolean {
  return Boolean(process.env.UNSPLASH_ACCESS_KEY);
}

function authHeaders(): HeadersInit {
  return {
    Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY ?? ""}`,
    "Accept-Version": "v1",
  };
}

function withAttribution(url: string): string {
  return url.includes("?") ? `${url}&${ATTRIBUTION_QUERY}` : `${url}?${ATTRIBUTION_QUERY}`;
}

/**
 * Surowa odpowiedź dostawcy → nasz kształt. Zdjęcie bez KOMPLETU pól wypada:
 * lepiej pokazać o jedno mniej, niż wystawić na stronie najemcy zdjęcie bez
 * atrybucji, której wymaga licencja.
 */
export function toPhoto(raw: unknown): UnsplashPhoto | null {
  if (typeof raw !== "object" || raw === null) return null;
  const photo = raw as {
    id?: unknown;
    urls?: { small?: unknown; regular?: unknown };
    alt_description?: unknown;
    description?: unknown;
    links?: { download_location?: unknown };
    user?: { name?: unknown; links?: { html?: unknown } };
  };

  const id = typeof photo.id === "string" ? photo.id : null;
  const thumbUrl = typeof photo.urls?.small === "string" ? photo.urls.small : null;
  const url = typeof photo.urls?.regular === "string" ? photo.urls.regular : null;
  const authorName = typeof photo.user?.name === "string" ? photo.user.name : null;
  const authorUrl = typeof photo.user?.links?.html === "string" ? photo.user.links.html : null;
  const downloadLocation =
    typeof photo.links?.download_location === "string" ? photo.links.download_location : null;

  if (!id || !thumbUrl || !url || !authorName || !authorUrl || !downloadLocation) return null;

  const described =
    (typeof photo.alt_description === "string" && photo.alt_description) ||
    (typeof photo.description === "string" && photo.description) ||
    null;

  return {
    id,
    thumbUrl,
    url,
    // `alt` jest WYMAGANY przez schemat elementu, a dostawca bywa go pozbawiony
    // — wtedy podstawiamy podpis autora, żeby operator miał co poprawić,
    // zamiast dostać element, którego nie da się zapisać.
    alt: described ?? authorName,
    authorName,
    authorUrl: withAttribution(authorUrl),
    downloadLocation,
  };
}

/** Wyszukanie zdjęć. Zwraca czytelną odmowę zamiast rzucać — to jest wejście operatora. */
export async function searchUnsplash(query: string, perPage = 24): Promise<UnsplashSearchResult> {
  if (!unsplashEnabled()) return { ok: false, error: "disabled" };

  const url = new URL(`${API}/search/photos`);
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", String(Math.min(Math.max(perPage, 1), 30)));
  url.searchParams.set("content_filter", "high");

  let response: Response;
  try {
    response = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  } catch {
    // Bez szczegółów sieciowych w komunikacie — mogłyby nieść nagłówki żądania.
    return { ok: false, error: "network" };
  }
  if (!response.ok) return { ok: false, error: "provider" };

  const payload = (await response.json()) as { results?: unknown };
  const results = Array.isArray(payload.results) ? payload.results : [];
  return { ok: true, photos: results.map(toPhoto).filter((photo): photo is UnsplashPhoto => photo !== null) };
}

/**
 * WYZWALACZ POBRANIA — wołany w chwili WYBORU zdjęcia, dokładnie raz.
 * Regulamin dostawcy wymaga tego wywołania (liczy z niego statystyki autora);
 * jego niepowodzenie NIE MOŻE zablokować wstawienia zdjęcia, bo to nie jest
 * warunek poprawności treści, tylko zobowiązanie wobec dostawcy.
 */
export async function triggerUnsplashDownload(downloadLocation: string): Promise<void> {
  if (!unsplashEnabled()) return;
  if (!downloadLocation.startsWith(`${API}/`)) return; // tylko adresy dostawcy
  try {
    await fetch(downloadLocation, { headers: authHeaders(), cache: "no-store" });
  } catch {
    // Świadomie cicho — patrz docblock.
  }
}
