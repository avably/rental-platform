/**
 * Middleware storefrontu. Trzy zadania, w kolejności:
 *
 * (Bramka Basic Auth całego site'u — TYMCZASOWA, 2026-07-22 → 2026-08-10 —
 * została zdjęta przy odsłonięciu LP: ADR-128, checklista I-03 audytu
 * 2026-08-09. Site jest publiczny; żadna gałąź nie pyta o hasło.)
 *
 * 0. ROZGAŁĘZIENIE PO HOŚCIE (Zadanie 2.1, ADR-039): kanon marketingowy →
 *    istniejąca ścieżka LP; `<slug>.avably.io` → rozwiązanie tenanta i rewrite
 *    na trasę tenancką; własna domena najemcy (2.6, ADR-046) → rozwiązanie po
 *    hoście i ta sama trasa tenancka. Cokolwiek się NIE rozwiąże — nieznana
 *    subdomena i nierozwiązany host obcy — dostaje jedno neutralne 404
 *    (ADR-131). Gałąź marketingowa należy WYŁĄCZNIE do hostów platformy.
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
import { LOCALES } from "@avably/core";
import {
  INTERNAL_PAGE_PREFIX,
  internalPagePathname,
  isReservedPageSlug,
  isValidPageSlug,
  pagePathFromSlug,
} from "@avably/core/site";
import { applySecurityHeaders, buildCsp, generateNonce, type CspOptions } from "@avably/security";
import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";

import { routing } from "@/i18n/routing";
import { EMBED_PATH_PREFIX } from "@/lib/embed/contract";
import { getCachedTenant, setCachedTenant } from "@/lib/tenant/cache";
import { classifyHost } from "@/lib/tenant/host";
import { setResolvedTenant, stripInboundTenantHeaders } from "@/lib/tenant/headers";
import { lookupTenantIdByDomain, lookupTenantIdBySlug } from "@/lib/tenant/lookup";
import {
  getCachedTenantPages,
  lookupTenantPages,
  resolveTenantPages,
  setCachedTenantPages,
  type TenantPageRegistry,
} from "@/lib/tenant/pages";
import { resolveTenant, resolveTenantByDomain } from "@/lib/tenant/resolve";

const handleI18n = createIntlMiddleware(routing);

/**
 * Kto może osadzić dokument embedu w ramce (M3, ADR-120). Reszta site'u
 * zostaje przy `frame-ancestors 'none'` — ta lista dotyczy WYŁĄCZNIE
 * `/embed/**`.
 *
 * DLACZEGO NIE LISTA DOMEN ZADEKLAROWANYCH PRZEZ NAJEMCĘ. Rozważona i
 * odrzucona w tej iteracji z dwóch powodów, oba zapisane w ADR-120:
 *   1. Nie ma jej gdzie trzymać bez migracji. `tenant_settings` jest jedynym
 *      zerowo-DDL-owym miejscem, ale anon go NIE CZYTA (brak grantu), a
 *      storefront chodzi wyłącznie na anonie — odczyt wymagałby nowego RPC
 *      SECURITY DEFINER, czyli migracji, której to zadanie nie ma.
 *   2. Nawet gdyby była, nie broniłaby niczego, czego nie broni już zapis.
 *      Osadzenie tego dokumentu nie daje osadzającemu ŻADNEGO dostępu:
 *      treść to dane, które publiczny sklep najemcy i tak pokazuje anonimowi;
 *      pola formularza są za granicą pochodzenia, więc strona gospodarza ich
 *      nie odczyta; a zapis przyjmujemy WYŁĄCZNIE same-origin (lib/embed/
 *      origin.ts), więc obca strona nie zarezerwuje niczego nawet z ramką.
 *
 * RYZYKO SZCZĄTKOWE, przyjęte świadomie: obcy serwis może wyświetlić cudzy
 * widget rezerwacji u siebie (podszycie się pod najemcę). To jest ryzyko
 * TREŚCIOWE, nie techniczne — rezerwacje i tak trafiają do właściwego
 * najemcy — i nie da się go domknąć ramką, skoro ten sam formularz stoi
 * publicznie pod adresem sklepu.
 *
 * `https:` zamiast `*`: schemat jest zawężeniem, które nic nie kosztuje —
 * osadzenie ze strony po http i tak zostałoby zablokowane jako mieszana
 * treść. `http:` dochodzi TYLKO w dev, gdzie strona-gospodarz stoi lokalnie.
 */
const EMBED_FRAME_ANCESTORS: readonly string[] =
  process.env.NODE_ENV === "production" ? ["'self'", "https:"] : ["'self'", "https:", "http:"];

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
 * sieci (wzorzec: rdzeń checkoutu przyjmuje `callRpc`). Domyślnie: cache
 * Upstash/in-memory → miss → baza (0017).
 */
export interface ProxyDeps {
  resolveTenant: (host: string, slug: string) => Promise<{ tenantId: string } | null>;
  /**
   * Rozwiązanie WŁASNEJ domeny najemcy (Zadanie 2.6, 0022, ADR-046) — osobna oś
   * hostów, osobne RPC. Ten sam cache (klucz = host), te same TTL-e.
   */
  resolveTenantByDomain: (host: string) => Promise<{ tenantId: string } | null>;
  /**
   * REJESTR ADRESÓW STRON najemcy (Faza 2, ADR-158) — cache per NAJEMCA, nie
   * per host: ten sam sklep bywa dostępny pod subdomeną i pod własną domeną,
   * a listy jego stron nie ma powodu trzymać dwa razy.
   */
  resolveTenantPages: (tenantId: string) => Promise<TenantPageRegistry | null>;
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
  resolveTenantPages: (tenantId) =>
    resolveTenantPages(tenantId, {
      getCache: getCachedTenantPages,
      setCache: setCachedTenantPages,
      lookup: lookupTenantPages,
    }),
};

function cspOptions(): CspOptions {
  return {
    dev: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    // Dyrektywy Cloudflare tylko gdy widget faktycznie się renderuje (ten sam
    // warunek co w app/(tenant)/checkout/page.tsx).
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
 * JĘZYK NEUTRALNEJ ODMOWY — z `Accept-Language` PRZEGLĄDARKI, i tylko stąd
 * (S-14 audytu 2026-08-25).
 *
 * To jest jedyne źródło, które NICZEGO nie zdradza: nagłówek przynosi ze sobą
 * sam odwiedzający, więc odpowiedź dalej nie zależy od tego, czy pod adresem
 * stoi jakikolwiek najemca i w jakim jest stanie (warunek nierozróżnialności
 * z ADR-131). Osi tenanckiej nie pytamy — tu jeszcze nie ma tenanta, a gdyby
 * był, jego język byłby wyrocznią.
 *
 * Dopasowanie jest po PREFIKSIE podstawowego tagu (`pl-PL` → `pl`), bez wag
 * `q`: kolejność wpisów w nagłówku to preferencja malejąca i dla dwóch języków
 * pełny parser nie zmienia ani jednego wyniku. Brak nagłówka i język spoza
 * listy → domyślny locale platformy.
 */
export function neutralNotFoundLocale(acceptLanguage: string | null): string {
  for (const entry of (acceptLanguage ?? "").split(",")) {
    const tag = entry.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!tag) continue;
    const base = tag.split("-")[0] ?? "";
    const hit = (LOCALES as readonly string[]).find((locale) => locale === base);
    if (hit) return hit;
  }
  return routing.defaultLocale;
}

/**
 * Treść neutralnej odmowy w obu językach. Świadomie BEZ nazwy platformy,
 * bez nazwy najemcy, bez odnośnika dokądkolwiek: dokument stoi pod adresem,
 * który do nas nie należy (obca domena, cudza subdomena), a każdy odnośnik
 * byłby reklamą pod cudzym adresem — dokładnie tym, co ADR-131 zamyka.
 */
const NOT_FOUND_COPY: Record<string, { title: string; lead: string }> = {
  pl: { title: "Nie znaleziono strony", lead: "Sprawdź adres i spróbuj ponownie." },
  en: { title: "Page not found", lead: "Check the address and try again." },
};

/**
 * JEDYNA odmowa storefrontu — neutralne 404 z nagłówkami bezpieczeństwa.
 *
 * Nie ujawnia, czy tenant istnieje: identyczna dla nieistniejącego,
 * zawieszonego, usuniętego i dla niepoprawnego slugu — a od ADR-131 również
 * dla NIEROZWIĄZANEJ DOMENY WŁASNEJ (host nieznany, tenant zawieszony/usunięty,
 * domena jeszcze niezweryfikowana). Obie osie hostów wołają tę funkcję, więc
 * nierozróżnialność wynika z BUDOWY, a nie z pilnowania dwóch kopii.
 *
 * ==================== DLACZEGO JUŻ NIE `text/plain` (S-14) ====================
 *
 * Do tej poprawki odmowa była dziewięcioma bajtami `Not Found` w `text/plain`.
 * Nierozróżnialność to dawało, ale CZŁOWIEKOWI dawało ekran zepsuty: dokument
 * bez `<meta name="viewport">` renderuje się na telefonie w skali strony
 * desktopowej, więc jedyne zdanie na ekranie jest mikrodrukiem, którego nie da
 * się przeczytać. Do tego bez `<title>` karta przeglądarki i zakładka pokazują
 * goły adres (WCAG 2.4.2), a klient, który trafił tu ze starego linku, nie ma
 * jak zrozumieć, co się stało.
 *
 * ZMIENIA SIĘ WYŁĄCZNIE FORMA, NIE INFORMACJA. Dokument jest dalej JEDNĄ
 * odpowiedzią dla wszystkich powodów odmowy, dalej nie niesie ani znaku
 * Avably, ani nazwy najemcy, ani śladu, że pod adresem kiedykolwiek coś stało
 * — a jego jedyną zmienną jest język wzięty z nagłówka przeglądarki
 * (patrz `neutralNotFoundLocale`), czyli z danych, które przyniósł sam
 * odwiedzający. Rozważone i odrzucone dalej: 403 (mówi „istnieje, ale nie dla
 * ciebie"), 410 („było i zniknęło") i strona z brandingiem (wyrocznia albo
 * reklama pod cudzym adresem). Uzasadnienie pełne: ADR-131.
 *
 * Ostylowana strona 404 ROUTERA sklepu (`app/(tenant)/not-found.tsx`) to
 * osobny ekran i zostaje bez zmian: tam tenant JEST rozwiązany, więc motyw
 * i wyjście do katalogu niczego nie zdradzają.
 *
 * `<style>` inline zamiast arkusza: middleware nie ma jak podać adresu pliku,
 * który przetrwa deploy, a polityka i tak dopuszcza style inline
 * (`style-src 'unsafe-inline'` w @avably/security). Skryptu nie ma ani jednego.
 */
function neutralNotFound(nonce: string, csp: CspOptions, request: NextRequest): NextResponse {
  const locale = neutralNotFoundLocale(request.headers.get("accept-language"));
  const copy = NOT_FOUND_COPY[locale] ?? NOT_FOUND_COPY.en!;

  const body = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${copy.title}</title>
<style>
:root { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1.5rem; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
main { max-width: 28rem; }
p.code { margin: 0 0 .5rem; font-size: 1.5rem; font-weight: 600; opacity: .55; font-variant-numeric: tabular-nums; }
h1 { margin: 0 0 .5rem; font-size: 1.5rem; font-weight: 600; letter-spacing: -.02em; }
p.lead { margin: 0; opacity: .7; }
</style>
</head>
<body>
<main>
<p class="code">404</p>
<h1>${copy.title}</h1>
<p class="lead">${copy.lead}</p>
</main>
</body>
</html>
`;

  const response = new NextResponse(body, {
    status: 404,
    headers: { "content-type": "text/html; charset=utf-8" },
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
  const isEmbedPath = request.nextUrl.pathname.startsWith(EMBED_PATH_PREFIX);
  const csp = isEmbedPath
    ? { ...cspOptions(), frameAncestors: EMBED_FRAME_ANCESTORS }
    : cspOptions();
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", buildCsp(nonce, csp));

  // ROUTE HANDLERY /api/** nie mają wersji językowych i prefiks locale by je
  // zepsuł — ten sam wzorzec co isNonLocalizedPath w proxy panelu. Obejmuje:
  //   * /api/v1/** — publiczne API maszynowe (M1, ADR-108); autoryzacją jest
  //     klucz API per najemca w route handlerach (jednolite 401 bez klucza),
  //     więc przejście przez middleware nie otwiera niczego anonimowi,
  //   * /api/review — narzędzie przeglądu (ADR-071); kill-switch REVIEW_MODE
  //     w handlerze odpowiada 404, jakby endpointu nie było (I-03).
  // Anty-spoofing (stripInboundTenantHeaders) już się wykonał — przychodzący
  // x-tenant-id nie przetrwał także na tej gałęzi. Gałąź świadomie stoi PRZED
  // rozwiązaniem tenanta: handlery API rozwiązują tenanta same (z klucza),
  // więc zapytanie do bazy o hosta byłoby kosztem bez konsumenta.
  if (request.nextUrl.pathname.startsWith("/api")) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    return applySecurityHeaders(response, nonce, csp);
  }

  // EMBED REZERWACJI (M3, ADR-120): `isEmbedPath` (dosłowny prefiks /embed/,
  // policzony wyżej dla CSP) NIE zmienia routingu — embed idzie DALEJ, w gałąź
  // tenancką, jak każda strona sklepu: przechodzi anty-spoofing i rozwiązanie
  // tenanta. Wyjątkowa jest wyłącznie polityka ramkowania (EMBED_FRAME_ANCESTORS
  // zamiast 'none'), i tylko dla tego prefiksu — samo `/embed` bez ukośnika
  // dostaje domyślne, pełne ramkowanie 'none'.

  /**
   * Gałąź tenancka — JEDNO miejsce dla obu osi hostów (subdomena i własna
   * domena), żeby wstrzyknięcie nagłówka i rewrite nie mogły się między nimi
   * rozjechać. `slug` bywa nieznany (własna domena rozwiązuje się po hoście
   * i zwraca sam uuid) — wtedy nagłówek slugu po prostu nie powstaje.
   */
  const tenantBranch = async (tenantId: string, slug?: string): Promise<NextResponse> => {
    setResolvedTenant(request.headers, { id: tenantId, ...(slug ? { slug } : {}) });

    // Rewrite (nie next()) niesie wstrzyknięte nagłówki tenanta na trasę
    // docelową grupy (tenant).
    const url = request.nextUrl.clone();
    const rewriteTo = (pathname: string): NextResponse => {
      url.pathname = pathname;
      return applySecurityHeaders(
        NextResponse.rewrite(url, { request: { headers: request.headers } }),
        nonce,
        csp,
      );
    };
    const passThrough = (): NextResponse =>
      applySecurityHeaders(
        NextResponse.rewrite(url, { request: { headers: request.headers } }),
        nonce,
        csp,
      );

    const pathname = url.pathname;
    const first = pathname.split("/")[1] ?? "";

    // (1) KORZEŃ → strona GŁÓWNA sklepu.
    if (first === "") return rewriteTo(TENANT_STORE_PATHNAME);

    /*
     * (2) OŚ MARKETINGOWA NIE NALEŻY DO HOSTA NAJEMCY (ADR-158).
     *
     * `<najemca>.avably.io/pl` renderowało do Fazy 2 LANDING PAGE AVABLY:
     * segment `pl` nie ma odpowiednika w grupie (tenant), więc dopasowywał się
     * dynamiczny `app/[locale]` osi marketingowej — a tam nie ma ani jednego
     * sprawdzenia hosta. Skutek był tej samej klasy, co wyciek zamknięty przez
     * ADR-131 na obcych domenach: pod adresem, który klienci znają jako sklep,
     * stała oferta naszego SaaS-u. Lista jest DOKŁADNA, nie zachowawcza:
     * `app/[locale]` renderuje się wyłącznie dla `hasLocale(LOCALES, …)`, więc
     * odcięcie LOCALES odcina całą gałąź.
     */
    if ((LOCALES as readonly string[]).includes(first)) return neutralNotFound(nonce, csp, request);

    /*
     * (3) TRASA WEWNĘTRZNA NIE JEST ADRESEM PUBLICZNYM. Cel rewrite'u stron
     * treściowych (`/store/{slug}`) siedzi pod segmentem `store`, bo trasy
     * `app/(tenant)/[slug]` nie da się dodać obok `app/[locale]`. Wejście
     * wprost pod adres wewnętrzny dałoby tę samą treść pod drugim adresem —
     * duplikat kanoniczny, którego najemca nigdy sam nie zauważy.
     *
     * GOŁE `/store` TEŻ (S-45/M-14 audytu 2026-08-25): do tej poprawki
     * przechodziło i oddawało 200 z treścią identyczną ze stroną główną —
     * czyli dokładnie ten duplikat kanoniczny, przed którym broni reszta tej
     * gałęzi ("Adres wewnętrzny nigdy nie jest adresem publicznym",
     * `page-slug.ts`). Zamiast 404 jest 308 NA KANON `/`: adres krąży w
     * linkach wewnętrznych sprzed tej poprawki (koszyk, potwierdzenia) i w
     * zakładkach klientów, więc twarda odmowa gasiłaby działające wejścia.
     * Parametry zapytania zostają — jak przy 308 z historii adresów niżej.
     * Rewrite'owi `/` → `/store` z gałęzi (1) nic tu nie grozi: rewrite nie
     * wraca do middleware'u, więc ta gałąź widzi wyłącznie żądania z zewnątrz.
     *
     * `/store/og` zostaje osiągalne: to trasa OBRAZU OG, po którą roboty
     * przychodzą bezpośrednim żądaniem — nie ma kanonu, na który można by ją
     * przekierować.
     */
    if (first === INTERNAL_PAGE_PREFIX.slice(1)) {
      if (pathname === TENANT_STORE_PATHNAME) {
        const target = request.nextUrl.clone();
        target.pathname = "/";
        return applySecurityHeaders(NextResponse.redirect(target, 308), nonce, csp);
      }
      return pathname === "/store/og" ? passThrough() : neutralNotFound(nonce, csp, request);
    }

    // (4) Pozostałe trasy sklepu (koszyk, kasa, produkt, dokumenty, embed)
    // zachowują ścieżkę — dokładnie jak przed Fazą 2. Katalogi prywatne Next
    // (`_next/**`) też, żeby rozstrzyganie adresu nie stanęło im na drodze.
    if (first.startsWith("_") || isReservedPageSlug(first)) return passThrough();

    // (5) Kształt odrzucamy BEZ podróży do bazy. Ścieżka wielosegmentowa pod
    // nieznanym korzeniem też: strony treściowe są w Fazie 2 jednopoziomowe.
    if (!isValidPageSlug(first) || pathname !== `/${first}`) {
      return neutralNotFound(nonce, csp, request);
    }

    // (6) REJESTR ADRESÓW — jedna podróż, z której wychodzi i strona, i
    // przekierowanie (ADR-159: historia adresów jedzie TYM SAMYM torem).
    const registry = await deps.resolveTenantPages(tenantId);
    if (registry?.pages.includes(first)) return rewriteTo(internalPagePathname(first));

    const redirect = registry?.redirects.find((entry) => entry.from === first);
    if (redirect) {
      const target = request.nextUrl.clone();
      target.pathname = pagePathFromSlug(redirect.to);
      // Parametry zapytania ZOSTAJĄ: adres w linku z Facebooka najemcy niesie
      // zwykle `?fbclid=…`, a 308 bez nich gubiłby atrybucję kampanii.
      return applySecurityHeaders(NextResponse.redirect(target, 308), nonce, csp);
    }

    return neutralNotFound(nonce, csp, request);
  };

  if (classification.kind === "tenant") {
    const resolved = await deps.resolveTenant(host, classification.slug);
    if (!resolved) return neutralNotFound(nonce, csp, request);

    return tenantBranch(resolved.tenantId, classification.slug);
  }

  if (classification.kind === "not-found") {
    return neutralNotFound(nonce, csp, request);
  }

  /*
   * WŁASNA DOMENA NAJEMCY (Zadanie 2.6, ADR-046). Host spoza naszych domen
   * próbuje rozwiązać się przez `app.resolve_tenant_by_domain` — bramki
   * `verified` i statusu tenanta siedzą w BAZIE, więc tutaj widać wyłącznie
   * „trafienie albo nic". Trafienie → gałąź tenancka. Brak trafienia →
   * `neutralNotFound`, DOKŁADNIE ta sama odmowa co na nieznanej subdomenie.
   *
   * DO ADR-131 BRAK TRAFIENIA SPADAŁ NA GAŁĄŹ MARKETINGOWĄ, a to był błąd o
   * dwóch twarzach. Po pierwsze: domena zawieszonego albo usuniętego najemcy
   * przestawała być jego sklepem, ale nie przestawała odpowiadać — jego
   * klientom serwowała LANDING PAGE AVABLY, czyli ofertę naszego SaaS-u pod
   * adresem, który znają jako sklep. Po drugie: dowolny obcy host wycelowany
   * w nasz deployment hostował u siebie nasz marketing.
   *
   * DLACZEGO TO JEDNA LINIA, A NIE NOWA ŚCIEŻKA. Rozwiązywanie hosta zostaje
   * jedno (wywołanie wyżej); zmienia się wyłącznie to, co robimy z `null`.
   * Odmowa jest TĄ SAMĄ funkcją, której używa oś subdomen — nie kopią o
   * zbliżonym kształcie. I to jest cały mechanizm nierozróżnialności: host
   * nieistniejący, tenant zawieszony, tenant usunięty i domena
   * niezweryfikowana schodzą się w `resolveTenantByDomain` → `null`, a stąd
   * wychodzi JEDEN `return`, którego nie ma czym sparametryzować, bo stan
   * tenanta nigdy tu nie dociera. Gdyby odmowa cokolwiek różnicowała, bylibyśmy
   * publiczną wyrocznią „czy ta firma jest klientem Avably i w jakim stanie" —
   * dla dowolnej domeny, bez logowania (ADR-131).
   *
   * ARGUMENT „404 ZEPSUJE HOSTY OPERACYJNE" (powód pierwotnej decyzji z 2.6)
   * NIE OBRONIŁ SIĘ: hosty operacyjne tu nie docierają. Kanon, apex,
   * `localhost`, pętla zwrotna i `*.vercel.app` klasyfikują się WYŻEJ jako
   * `marketing` (lib/tenant/host.ts) i nie ruszają bazy. Do tej gałęzi wchodzi
   * wyłącznie host, którego nikt u nas nie zadeklarował — a taki ma prawo
   * dostać odmowę. Nowy host platformy (np. druga domena marketingowa) dopisuje
   * się do `classifyHost` i to jest właściwe miejsce: pominięcie wpisu daje
   * awarię głośną, jednoznaczną i po bezpiecznej stronie, zamiast cichego
   * serwowania marketingu pod cudzym adresem.
   */
  if (classification.kind === "foreign") {
    const resolved = await deps.resolveTenantByDomain(classification.host);
    if (!resolved) return neutralNotFound(nonce, csp, request);

    return tenantBranch(resolved.tenantId);
  }

  // Gałąź marketingowa: WYŁĄCZNIE hosty platformy (kanon, apex, dev, preview).
  return applySecurityHeaders(handleI18n(request), nonce, csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
