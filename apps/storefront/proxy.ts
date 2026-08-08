/**
 * Middleware storefrontu. Cztery zadania, w kolejności:
 *
 * -1. HASŁO CAŁEGO SITE'U (decyzja właściciela, 2026-07-22, TYMCZASOWE —
 *    do momentu ściągnięcia). Przed każdą inną gałęzią, przed jakimkolwiek
 *    rozwiązaniem tenanta: storefront (marketing WWW i sklepy najemców pod
 *    subdomeną/własną domeną) nie jest jeszcze ogłoszony publicznie, więc
 *    CAŁY ruch przez tę appkę pyta o hasło zanim cokolwiek innego się wykona
 *    — łącznie z zapytaniem do bazy o tenanta (oszczędność, mniejsza
 *    powierzchnia dla przypadkowego ruchu). Panel (app.avably.io) NIE jest
 *    objęty — ma własne logowanie, dodatkowe hasło byłoby podwójną bramką
 *    bez treści.
 *
 *    ==================== JAK ZDJĄĆ HASŁO ====================
 *    Usuń blok `if (!siteAuthorized(...))` niżej (i funkcję
 *    `siteAuthorized` oraz `SITE_PASSWORD`, jeśli nieużywane gdzie indziej)
 *    — middleware wraca do zachowania sprzed tej zmiany. Test
 *    `apps/storefront/test/proxy.test.ts` ma przypadek pilnujący tej bramki;
 *    usuń go razem z kodem albo test padnie na czerwono, tłumacząc dlaczego.
 *    =========================================================
 *
 * 0. ROZGAŁĘZIENIE PO HOŚCIE (Zadanie 2.1, ADR-039): kanon marketingowy →
 *    istniejąca ścieżka LP; `<slug>.avably.io` → rozwiązanie tenanta i rewrite
 *    na trasę tenancką; nieznana/nieaktywna subdomena → neutralne 404.
 * 1. Routing locale (next-intl) — WYŁĄCZNIE na gałęzi marketingowej (storefront
 *    tenanta ma własną oś języka z tenants.locale, nie z przeglądarki).
 * 2. CSP z nonce + HSTS/nosniff/… (@avably/security), na KAŻDEJ gałęzi.
 *
 * ANTY-SPOOFING: `stripInboundTenantHeaders` leci na każdej gałęzi, ZANIM
 * cokolwiek przekaże żądanie dalej — żaden przychodzący nagłówek tenanta nie
 * przetrwa. Ustawia go z powrotem wyłącznie gałąź tenancka, z rozwiązania
 * server-side. Klient nie poda `x-tenant-id` i nie zostanie mu zaufany.
 *
 * Nonce ustawiany na ŻĄDANIU przed routingiem locale/rewrite — next-intl i
 * rewrite przenoszą nagłówki żądania dalej, więc kolejność jest warunkiem
 * działania CSP (Next czyta nonce z nagłówka żądania dla własnych <script>).
 */
import { applySecurityHeaders, buildCsp, generateNonce, type CspOptions } from "@avably/security";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { getCachedTenant, setCachedTenant } from "@/lib/tenant/cache";
import { classifyHost } from "@/lib/tenant/host";
import { setResolvedTenant, stripInboundTenantHeaders } from "@/lib/tenant/headers";
import { lookupTenantIdByDomain, lookupTenantIdBySlug } from "@/lib/tenant/lookup";
import { resolveTenant, resolveTenantByDomain } from "@/lib/tenant/resolve";

const handleI18n = createIntlMiddleware(routing);

/**
 * Hasło całego site'u — stała w kodzie, nie sekret w env (patrz nagłówek
 * pliku: bramka jest tymczasowa i jej zdjęcie to usunięcie kodu, nie obrót
 * sekretu). Repo jest prywatne.
 */
const SITE_PASSWORD = "notavably";

/**
 * Basic Auth ręcznie, bez `node:crypto` — proxy działa na Edge Runtime
 * (`generateNonce` wyżej używa Web Crypto z tego samego powodu), a
 * `timingSafeEqual` nie jest tam dostępne. Porównanie znak-po-znaku bez
 * wczesnego wyjścia z pętli jest odpornikiem na atak czasowy w praktycznie
 * istotnym zakresie (długość hasła nie jest tu sekretem chronionym).
 */
function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Liczy się wyłącznie hasło — nazwa użytkownika w Basic Auth jest dowolna. */
function siteAuthorized(header: string | null): boolean {
  if (!header || !header.startsWith("Basic ")) return false;
  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  return timingSafeStringEqual(decoded.slice(separator + 1), SITE_PASSWORD);
}

/**
 * Korzeń storefrontu tenanta = katalog (`/store`, grupa tras (tenant)). Goły `/`
 * na subdomenie tenanta rewrite'uje się tu; podstrony sklepu (`/product/[id]`,
 * `/cart`, `/checkout` — Zadanie 2.4b) ZACHOWUJĄ swoją ścieżkę i trafiają do
 * własnych tras tej samej grupy. Statyczne segmenty grupy (tenant) wygrywają z
 * dynamicznym `[locale]` osi marketingowej, więc obie osie współistnieją (jak
 * `/store` od 2.1).
 */
const TENANT_STORE_PATHNAME = "/store";

/**
 * Rozwiązywanie tenanta jest wstrzykiwane, żeby proxy dało się testować bez
 * sieci (wzorzec: rdzeń waitlisty przyjmuje `callRpc`). Domyślnie: cache
 * Upstash/in-memory → miss → baza (0017).
 */
export interface ProxyDeps {
  resolveTenant: (host: string, slug: string) => Promise<{ tenantId: string } | null>;
  /**
   * Rozwiązanie WŁASNEJ domeny najemcy (Zadanie 2.6, 0022, ADR-046) — osobna oś
   * hostów, osobne RPC. Ten sam cache (klucz = host), te same TTL-e.
   */
  resolveTenantByDomain: (host: string) => Promise<{ tenantId: string } | null>;
}

const defaultDeps: ProxyDeps = {
  resolveTenant: (host, slug) =>
    resolveTenant(host, slug, {
      getCache: getCachedTenant,
      setCache: setCachedTenant,
      lookup: lookupTenantIdBySlug,
    }),
  resolveTenantByDomain: (host) =>
    resolveTenantByDomain(host, {
      getCache: getCachedTenant,
      setCache: setCachedTenant,
      lookup: lookupTenantIdByDomain,
    }),
};

function cspOptions(): CspOptions {
  return {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Dyrektywy Cloudflare tylko gdy widget faktycznie się renderuje (ten sam
    // warunek co w components/waitlist-form).
    turnstile: Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
    // Dyrektywy dostawcy płatności tylko gdy integracja jest skonfigurowana
    // (Z3, ADR-066). Warunek patrzy na klucz SEKRETNY, nie publikowalny: to
    // serwer decyduje, czy płatność w ogóle powstanie, a bez niej nie ma czego
    // renderować w ramce. Liczy się sama OBECNOŚĆ zmiennej — wartość nie
    // opuszcza middleware'u i nie ma jak trafić do polityki ani do bundla.
    stripe: Boolean(process.env.AVABLY_STRIPE_SECRET_KEY),
    /*
     * Ramka mapy dojazdu (E5, ADR-096) — BEZ warunku, i to jest świadome.
     * Middleware liczy politykę per ŻĄDANIE, zanim wiadomo, jakie sekcje ma
     * strona tego najemcy; warunek „czy ta strona ma sekcję dojazdu" kosztowałby
     * odczyt treści na każdym żądaniu, żeby zaoszczędzić jedno źródło RAMKI,
     * którego samo dopuszczenie NICZEGO nie ładuje. Prywatności pilnuje
     * KLIKNIĘCIE w renderze (przed nim nie ma ani ramki, ani preconnectu), a nie
     * ta linia — polityka mówi wyłącznie, co wolno, gdy odwiedzający poprosi.
     */
    maps: true,
  };
}

/**
 * Neutralne 404 — nie ujawnia, czy tenant istnieje (ta sama odpowiedź dla
 * nieistniejącego, zawieszonego i o niepoprawnym slugu), z nagłówkami bezp.
 */
function neutralNotFound(nonce: string, csp: CspOptions): NextResponse {
  const response = new NextResponse("Not Found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  return applySecurityHeaders(response, nonce, csp);
}

/**
 * Wejście middleware'u. Next woła je jako `proxy(request, event)` —
 * NextFetchEvent jest DRUGIM argumentem, więc `runProxy` (który przyjmuje
 * wstrzykiwane deps) musi być osobną funkcją, inaczej event nadpisałby deps.
 */
export function proxy(request: NextRequest): Promise<NextResponse> {
  return runProxy(request, defaultDeps);
}

/** Rdzeń z wstrzykiwanym rozwiązywaniem tenanta — testowalny bez sieci. */
export async function runProxy(request: NextRequest, deps: ProxyDeps): Promise<NextResponse> {
  // Host z nagłówka `Host` (to on niesie subdomenę tenanta na wejściu). Poza
  // proxy CDN/Next go normalizują, ale rozgałęzienie po tenancie MUSI patrzeć
  // na wartość przyniesioną przez klienta. `nextUrl.host` to fallback — w dev
  // wskazuje host nasłuchu (localhost:port), nie nagłówek Host żądania.
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const classification = classifyHost(host);

  // ANTY-SPOOFING — patrz docblock. Na każdej gałęzi, przed przekazaniem dalej.
  stripInboundTenantHeaders(request.headers);

  const nonce = generateNonce();
  const csp = cspOptions();
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", buildCsp(nonce, csp));

  // PUBLICZNE API MASZYNOWE (M1, ADR-108): /api/v1/** jest ŚWIADOMIE i WĄSKO
  // wycięte z bramki SITE_PASSWORD — konsumentem jest SERWER najemcy
  // (wtyczka WordPress), który nie ma jak przejść Basic Auth przeznaczonego
  // dla ludzi przed ogłoszeniem produktu. Autoryzacją tych tras jest klucz
  // API per najemca w route handlerach (401 bez klucza), więc wyjątek nie
  // otwiera niczego anonimowi. Wycinka celowo NIE obejmuje /api/review ani
  // żadnej innej ścieżki — tylko dosłowny prefiks /api/v1/. Anty-spoofing
  // (stripInboundTenantHeaders) już się wykonał — przychodzący x-tenant-id
  // nie przetrwał także na tej gałęzi.
  if (request.nextUrl.pathname.startsWith("/api/v1/")) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    return applySecurityHeaders(response, nonce, csp);
  }

  // HASŁO CAŁEGO SITE'U — patrz nagłówek pliku. Przed jakimkolwiek
  // rozwiązaniem tenanta (żadnego zapytania do bazy dla nieautoryzowanego
  // ruchu). Ta sama odpowiedź dla marketingu, sklepów najemców i domen
  // obcych — nieautoryzowany nie dowiaduje się, na którą gałąź trafił.
  if (!siteAuthorized(request.headers.get("authorization"))) {
    const response = new NextResponse("Wymagane hasło.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="avably", charset="UTF-8"' },
    });
    return applySecurityHeaders(response, nonce, csp);
  }

  // ROUTE HANDLERY (dziś wyłącznie /api/review — ADR-071, narzędzie
  // przeglądu) nie mają wersji językowych i prefiks locale by je zepsuł —
  // ten sam wzorzec co isNonLocalizedPath w proxy panelu. Gałąź świadomie
  // siedzi ZA bramką hasła: endpoint przeglądu ma być dostępny wyłącznie po
  // przejściu Basic Auth, na każdym hoście tak samo.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    return applySecurityHeaders(response, nonce, csp);
  }

  /**
   * Gałąź tenancka — JEDNO miejsce dla obu osi hostów (subdomena i własna
   * domena), żeby wstrzyknięcie nagłówka i rewrite nie mogły się między nimi
   * rozjechać. `slug` bywa nieznany (własna domena rozwiązuje się po hoście
   * i zwraca sam uuid) — wtedy nagłówek slugu po prostu nie powstaje.
   */
  const tenantBranch = (tenantId: string, slug?: string): NextResponse => {
    setResolvedTenant(request.headers, { id: tenantId, ...(slug ? { slug } : {}) });

    // Korzeń → katalog; podstrony sklepu zachowują ścieżkę. Rewrite (nie next())
    // niesie wstrzyknięte nagłówki tenanta na trasę docelową grupy (tenant).
    const url = request.nextUrl.clone();
    if (url.pathname === "/") url.pathname = TENANT_STORE_PATHNAME;
    const response = NextResponse.rewrite(url, { request: { headers: request.headers } });
    return applySecurityHeaders(response, nonce, csp);
  };

  if (classification.kind === "tenant") {
    const resolved = await deps.resolveTenant(host, classification.slug);
    if (!resolved) return neutralNotFound(nonce, csp);

    return tenantBranch(resolved.tenantId, classification.slug);
  }

  if (classification.kind === "not-found") {
    return neutralNotFound(nonce, csp);
  }

  // WŁASNA DOMENA NAJEMCY (Zadanie 2.6, ADR-046). Host spoza naszych domen
  // próbuje rozwiązać się przez app.resolve_tenant_by_domain — bramki `verified`
  // i statusu tenanta siedzą w bazie. Trafienie → gałąź tenancka; BRAK trafienia
  // → DOKŁADNIE dotychczasowe zachowanie z 2.1 (marketing), nie 404: obcy host
  // nierozwiązany nie ujawnia niczego o tenantach, a 404 zepsułoby hosty
  // operacyjne wskazane na ten deployment.
  if (classification.kind === "foreign") {
    const resolved = await deps.resolveTenantByDomain(classification.host);
    if (resolved) return tenantBranch(resolved.tenantId);
  }

  // Gałąź marketingowa (kanon, dev, preview + nierozwiązany host obcy) — bez zmian.
  return applySecurityHeaders(handleI18n(request), nonce, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
