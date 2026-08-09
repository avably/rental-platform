/**
 * Relay uwag przeglądu do panelu (ADR-099/ADR-115).
 *
 * Storefront jest aplikacją PUBLICZNĄ i po ADR-099 nie trzyma ŻADNEGO
 * sekretu bazy — jego trasy /api/review/** nie dotykają Supabase, tylko
 * przekazują żądanie server-side do endpointu ingest panelu
 * (apps/panel/app/api/review/ingest/**), gdzie klucz service_role
 * prawowicie mieszka. Nakładka przeglądu nic o tym nie wie: dalej POST-uje
 * same-origin na /api/review, a bramka REVIEW_MODE trzyma z obu stron
 * (tu 404 zanim wyjdzie jakiekolwiek żądanie, w panelu 404 niezależnie).
 *
 * Sekret relaya żyje wyłącznie w env serwera i nagłówku wychodzącym —
 * nigdy w odpowiedzi ani w HTML-u. Z odpowiedzi panelu wraca wyłącznie
 * status i ciało (content-type) — żadnych nagłówków sesyjnych panelu.
 * Komunikaty błędów nie nazywają zmiennych środowiskowych (dyscyplina U1).
 *
 * ŚCIEŻKA CELU NIE POCHODZI OD WOŁAJĄCEGO. Trasa wybiera KSZTAŁT adresu
 * z zamkniętego zbioru (lista uwag / pojedyncza uwaga), a identyfikator
 * wchodzi POJEDYNCZYM segmentem przez `encodeURIComponent` — nigdy jako
 * kawałek sklejanego napisu. Sklejanie oddawało sterowanie ścieżką
 * wołającemu: segment `../../jobs/wysylka` wyprowadzał żądanie
 * (z nagłówkiem `Authorization`) poza segment ingest, czyli sekret relaya
 * wychodził poza swoją powierzchnię i dawał server-side sondowanie panelu.
 * Czyszczenia napisu tu NIE MA świadomie — czarna lista `..` przegrywa
 * z kodowaniem. Zamiast niej stoi asercja na WYNIKU: `pathname` musi być
 * dokładnie tym, co zbudowaliśmy (normalizacja URL niczego nie przesunęła)
 * i musi leżeć pod `/api/review/ingest/`. Rozjazd = 400 i ZERO ruchu
 * wychodzącego (fail-closed).
 */
import { PANEL_URL } from "@avably/core";

const INGEST_BASE = "/api/review/ingest";

/**
 * Zamknięty zbiór kształtów adresu ingest. Wołający WYBIERA kształt,
 * nie pisze ścieżki — dlatego to unia wariantów, a nie napis.
 */
export type ReviewRelayTarget =
  | { readonly resource: "comments" }
  | { readonly resource: "comment"; readonly id: string };

function ingestSegments(target: ReviewRelayTarget): readonly string[] {
  return target.resource === "comments" ? ["comments"] : ["comments", target.id];
}

export async function relayReviewRequest(
  request: Request,
  target: ReviewRelayTarget,
): Promise<Response> {
  if (process.env.REVIEW_MODE !== "1") return new Response("Not Found", { status: 404 });

  const token = process.env.REVIEW_INGEST_TOKEN;
  if (!token) {
    return Response.json(
      { error: "Przekazywanie uwag przeglądu nie jest skonfigurowane." },
      { status: 503 },
    );
  }

  // Lokalne uruchomienia wskazują panel jawnie (REVIEW_INGEST_URL);
  // na hostingu wystarcza kanoniczny adres panelu.
  const base = process.env.REVIEW_INGEST_URL || PANEL_URL;
  const pathname = `${INGEST_BASE}/${ingestSegments(target).map(encodeURIComponent).join("/")}`;
  const url = new URL(`${pathname}${new URL(request.url).search}`, base);
  if (url.pathname !== pathname || !url.pathname.startsWith(`${INGEST_BASE}/`)) {
    // Obrona w głąb: gdyby kiedykolwiek dało się przemycić separator lub
    // segment `..`, normalizacja URL zmieniłaby ścieżkę — wtedy nie wychodzi
    // ŻADNE żądanie, więc token nie ma jak polecieć pod cudzy adres.
    return Response.json({ error: "Nieprawidłowe żądanie uwag przeglądu." }, { status: 400 });
  }

  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(url, { method: request.method, headers, body, cache: "no-store" });
  } catch {
    // Szczegóły awarii (adresy, porty) zostają w logach serwera, nie w
    // odpowiedzi dla przeglądarki.
    return Response.json({ error: "Zapis uwag przeglądu jest chwilowo niedostępny." }, { status: 502 });
  }

  const responseHeaders = new Headers();
  const upstreamType = upstream.headers.get("content-type");
  if (upstreamType) responseHeaders.set("content-type", upstreamType);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
