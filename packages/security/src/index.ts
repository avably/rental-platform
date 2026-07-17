/**
 * Nagłówki bezpieczeństwa dla obu aplikacji Next.js (panel + storefront) —
 * JEDNO źródło prawdy (Zadanie 7). Polityka CSP jest security-krytyczna i
 * rozjechanie się jej między apkami byłoby cichą regresją, dlatego mieszka
 * w pakiecie, a nie w `lib/` każdej apki z osobna. Z tego samego powodu mieszka
 * tu rate-limit — osobny entrypoint `@avably/security/rate-limit`, bo nie
 * potrzebuje Next.js (patrz src/rate-limit.ts).
 *
 * Użycie: w `proxy.ts` (dawne `middleware.ts`) aplikacji —
 *
 *   const nonce = generateNonce();
 *   const response = NextResponse.next({ request: withNonce(request, nonce) });
 *   applySecurityHeaders(response, nonce);
 *
 * `withNonce` przepisuje nagłówki ŻĄDANIA (x-nonce + Content-Security-Policy).
 * Next.js czyta z nich nonce i wstrzykuje go we własne tagi <script>, dzięki
 * czemu bootstrap frameworka działa bez `unsafe-inline` w script-src.
 */
import { NextResponse, type NextRequest } from "next/server";

/** Losowy nonce (base64, 128 bitów) — nowy dla KAŻDEGO żądania. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export interface CspOptions {
  /** W dev Next.js używa eval (React Refresh, HMR) — w produkcji NIGDY. */
  dev?: boolean;
  /** Origin API Supabase (connect-src). Brak = tylko 'self'. */
  supabaseUrl?: string | undefined;
  /**
   * Cloudflare Turnstile skonfigurowany (NEXT_PUBLIC_TURNSTILE_SITE_KEY).
   * Dyrektywy dla challenges.cloudflare.com wchodzą TYLKO wtedy — brak
   * konfiguracji nie otwiera CSP. Host w script-src to fallback CSP2:
   * przy 'strict-dynamic' przeglądarki CSP3 ignorują hosty, a api.js
   * wstrzykiwany przez zaufany chunk jest zaufany przechodnio.
   */
  turnstile?: boolean;
}

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Buduje wartość nagłówka Content-Security-Policy.
 *
 * `'strict-dynamic'` sprawia, że skrypty załadowane przez zaufany (nonce'owany)
 * bootstrap Next.js — czyli chunki aplikacji — są zaufane przechodnio, bez
 * whitelisty domen. Dzięki temu script-src nie potrzebuje ani 'unsafe-inline',
 * ani listy hostów: nowy chunk nie wymaga zmiany polityki, a wstrzyknięty
 * przez atakującego <script> bez nonce się nie wykona.
 *
 * `style-src` zostaje z 'unsafe-inline' świadomie: Next.js/Tailwind wstrzykują
 * style inline (m.in. krytyczny CSS), a nonce dla stylów nie jest przez
 * framework propagowany. Inline style to wektor kosmetyczny (defacement),
 * nie wykonanie kodu — akceptowane, odnotowane w dokumentacji.
 */
export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const { dev = false, supabaseUrl, turnstile = false } = options;

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React Refresh / HMR w dev; w produkcji eval jest zabroniony.
    ...(dev ? ["'unsafe-eval'"] : []),
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
  ];

  const connectSrc = ["'self'", ...(supabaseUrl ? [supabaseUrl] : [])];
  if (dev) connectSrc.push("ws:");
  if (turnstile) connectSrc.push(TURNSTILE_ORIGIN);

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // frame-src istnieje TYLKO dla Turnstile (widget żyje w ramce Cloudflare);
    // bez niego ramki tnie default-src 'self' — jak przed tą opcją.
    ...(turnstile ? { "frame-src": [TURNSTILE_ORIGIN] } : {}),
    "frame-ancestors": ["'none'"],
    "form-action": ["'self'"],
    "base-uri": ["'self'"],
    "object-src": ["'none'"],
  };

  const policy = Object.entries(directives)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");

  // upgrade-insecure-requests tylko poza devem — lokalnie serwer stoi na http.
  return dev ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * Nakłada komplet nagłówków bezpieczeństwa na odpowiedź.
 *
 * HSTS z `preload`: przeglądarka po pierwszej wizycie po HTTPS nie wykona już
 * żądania po HTTP (rok, wraz z subdomenami — każdy storefront tenanta jest
 * subdomeną, więc includeSubDomains jest tu wymogiem, nie ozdobą).
 */
export function applySecurityHeaders(
  response: NextResponse,
  nonce: string,
  options: CspOptions = {},
): NextResponse {
  response.headers.set("Content-Security-Policy", buildCsp(nonce, options));
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

/**
 * Zwraca `RequestInit` z nagłówkami żądania wzbogaconymi o nonce i CSP —
 * do przekazania w `NextResponse.next({ request })`. To jest kanał, którym
 * Next.js dostaje nonce do własnych tagów <script>.
 */
export function requestWithNonce(
  request: NextRequest,
  nonce: string,
  options: CspOptions = {},
): { headers: Headers } {
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", buildCsp(nonce, options));
  return { headers };
}

/**
 * Kompletny middleware nagłówków: buduje odpowiedź z nonce w żądaniu i
 * nakłada nagłówki. Aplikacja, która nie musi nic robić z sesją (storefront),
 * używa tego wprost; panel składa to samo ręcznie wokół odświeżania sesji
 * Supabase (patrz apps/panel/proxy.ts).
 */
export function securityHeadersResponse(
  request: NextRequest,
  options: CspOptions = {},
): NextResponse {
  const nonce = generateNonce();
  const response = NextResponse.next({ request: requestWithNonce(request, nonce, options) });
  return applySecurityHeaders(response, nonce, options);
}
