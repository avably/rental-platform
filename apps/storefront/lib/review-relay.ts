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
 */
import { PANEL_URL } from "@avably/core";

const INGEST_BASE = "/api/review/ingest";

export async function relayReviewRequest(request: Request, path: string): Promise<Response> {
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
  const target = new URL(`${INGEST_BASE}${path}${new URL(request.url).search}`, base);

  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(target, { method: request.method, headers, body, cache: "no-store" });
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
