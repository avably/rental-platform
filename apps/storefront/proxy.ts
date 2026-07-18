/**
 * Middleware storefrontu. Trzy zadania, w kolejności:
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
