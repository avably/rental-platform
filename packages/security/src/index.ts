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
  /**
   * Płatność online skonfigurowana (Z3, ADR-066). Dyrektywy dla dostawcy
   * płatności wchodzą TYLKO wtedy — sklep bez płatności online nie ma powodu
   * mieć w polityce cudzych origins.
   *
   * KTÓRE DYREKTYWY I DLACZEGO KAŻDA:
   *   * `frame-src` — pola karty żyją w RAMKACH dostawcy i to jest cały
   *     sens tego rozwiązania: numer karty nie przechodzi przez naszą stronę,
   *     więc nie mamy jak go zgubić. Bez tej dyrektywy `default-src 'self'`
   *     tnie ramki i formularz płatności NIE RENDERUJE SIĘ WCALE;
   *   * `connect-src` — biblioteka dostawcy rozmawia z jego API z
   *     przeglądarki (potwierdzenie płatności, BLIK, 3DS);
   *   * `script-src` — fallback CSP2 dla przeglądarek, które ignorują
   *     `'strict-dynamic'`. W CSP3 skrypt dostawcy jest zaufany przechodnio
   *     (wstrzykuje go nasz nonce'owany chunk), dokładnie jak api.js
   *     Turnstile.
   */
  stripe?: boolean;
  /**
   * Osadzona mapa dojazdu (E5, ADR-096). Dodaje źródło ramki dostawcy map —
   * i WYŁĄCZNIE ramki.
   *
   * DLACZEGO TYLKO `frame-src`: dokument mapy żyje w RAMCE, czyli ma własne
   * pochodzenie i własną politykę. Kafle, skrypty i zapytania, które on
   * wykonuje, nie przechodzą przez NASZĄ politykę, więc dopisanie dostawcy do
   * `img-src`, `script-src` albo `connect-src` nie umożliwiłoby niczego —
   * otworzyłoby za to naszą stronę na wykonanie jego kodu i na wysyłanie do
   * niego danych z naszego kontekstu. Test pilnuje OBU stron tej decyzji:
   * że źródło jest w `frame-src` i że nie ma go nigdzie indziej.
   *
   * DLACZEGO NIE W PANELU: aplikacja panelu tej flagi nie podaje. Kreator
   * renderuje tę samą sekcję, ale mapy nie osadza (render dostaje wtedy
   * `mapEmbed={false}` i rysuje zdanie zamiast ramki) — powierzchnia
   * edycyjna z zalogowaną sesją najemcy nie jest miejscem na obce ramki.
   */
  maps?: boolean;
  /**
   * Kto może osadzić tę odpowiedź w ramce (M3, ADR-120). Domyślnie NIKT —
   * `frame-ancestors 'none'` + `X-Frame-Options: DENY` — i tak zostaje dla
   * każdej trasy poza embedem. Podanie NIEPUSTEJ listy przełącza politykę na
   * te źródła, bo embed rezerwacji z definicji żyje na cudzej stronie.
   *
   * DWIE KONSEKWENCJE, obie celowe:
   *   * lista wchodzi DOSŁOWNIE do dyrektywy, więc wołający odpowiada za to,
   *     by nie było w niej `*` — pilnuje tego test polityki, nie ta funkcja;
   *   * `X-Frame-Options` przy niepustej liście NIE JEST WYSYŁANY. Ten nagłówek
   *     nie zna pojęcia listy (ma tylko DENY/SAMEORIGIN), a wysłany obok CSP
   *     wygrałby w przeglądarkach, które go honorują — czyli zablokowałby
   *     ramkę, którą polityka właśnie wpuściła. Zostawienie obu byłoby cichą
   *     awarią widoczną dopiero u najemcy.
   *
   * Pusta tablica jest równoważna brakowi opcji (`'none'` + DENY), żeby
   * „nie udało się wyliczyć dozwolonego źródła" domykało się w stronę zamkniętą.
   */
  frameAncestors?: readonly string[] | undefined;
}

/** Czy CSP ma wpuścić kogokolwiek do ramki — jedno rozstrzygnięcie dla obu nagłówków. */
function resolvedFrameAncestors(options: CspOptions): readonly string[] {
  const declared = options.frameAncestors ?? [];
  return declared.length > 0 ? declared : ["'none'"];
}

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Host hotlinkowanych zdjęć Unsplash (K3, ADR-086). Zdjęcia w pickerze
 * kreatora i na opublikowanych stronach ładują się bezpośrednio z Unsplash
 * (bez pośrednictwa naszego Storage), więc host wchodzi do img-src na stałe —
 * w obu apkach, niezależnie od konfiguracji tenanta. Wyszukiwanie zdjęć idzie
 * server-side (API key nie trafia do przeglądarki), więc connect-src tego
 * hosta NIE potrzebuje.
 */
const UNSPLASH_IMAGE_ORIGIN = "https://images.unsplash.com";

/**
 * Origins dostawcy płatności. `js.` niesie bibliotekę i ramki pól karty,
 * `api.` przyjmuje potwierdzenia z przeglądarki, `hooks.` obsługuje
 * przekierowania 3DS wewnątrz ramki.
 */
const PAYMENTS_SCRIPT_ORIGIN = "https://js.stripe.com";
const PAYMENTS_FRAME_ORIGINS = ["https://js.stripe.com", "https://hooks.stripe.com"];
const PAYMENTS_CONNECT_ORIGINS = ["https://api.stripe.com", "https://js.stripe.com"];

/**
 * Origin dostawcy osadzonej mapy (E5, ADR-096) — lustro `MAP_PROVIDER_ORIGIN`
 * z @avably/core/site, z którego render składa adres ramki. Pakiet
 * bezpieczeństwa NIE importuje rdzenia (polityka ma stać sama, bez zależności
 * od modelu treści), więc zgodność obu stałych jest pilnowana testami po obu
 * stronach: rdzeń sprawdza, że adres ramki wychodzi z tego origin, a test
 * polityki — że dokładnie ten origin wpuszcza `frame-src`.
 */
const MAPS_FRAME_ORIGIN = "https://www.google.com";

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
  const { dev = false, supabaseUrl, turnstile = false, stripe = false, maps = false } = options;

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React Refresh / HMR w dev; w produkcji eval jest zabroniony.
    ...(dev ? ["'unsafe-eval'"] : []),
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
    ...(stripe ? [PAYMENTS_SCRIPT_ORIGIN] : []),
  ];

  const connectSrc = ["'self'", ...(supabaseUrl ? [supabaseUrl] : [])];
  if (dev) connectSrc.push("ws:");
  if (turnstile) connectSrc.push(TURNSTILE_ORIGIN);
  if (stripe) connectSrc.push(...PAYMENTS_CONNECT_ORIGINS);

  // frame-src zbiera WSZYSTKICH osadzanych (Turnstile + płatności + mapa) — to
  // jedna dyrektywa, więc druga jej deklaracja niżej po cichu nadpisałaby
  // pierwszą i wyłączyła widget captchy w sklepie z płatnościami.
  const frameSrc = [
    ...(turnstile ? [TURNSTILE_ORIGIN] : []),
    ...(stripe ? PAYMENTS_FRAME_ORIGINS : []),
    ...(maps ? [MAPS_FRAME_ORIGIN] : []),
  ];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'"],
    // supabaseUrl: zdjęcia produktów storefrontu leżą w publicznym bucketcie
    // Storage (inny origin niż strona tenanta), więc bez niego CSP tnie je jak
    // każdy obcy obraz. Ta sama motywacja co supabaseUrl w connect-src.
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      UNSPLASH_IMAGE_ORIGIN,
      ...(supabaseUrl ? [supabaseUrl] : []),
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSrc,
    // frame-src istnieje TYLKO dla osadzanych, których jawnie włączono
    // (widget captchy, pola płatności); bez nich ramki tnie default-src 'self'.
    ...(frameSrc.length > 0 ? { "frame-src": frameSrc } : {}),
    "frame-ancestors": [...resolvedFrameAncestors(options)],
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
  // Patrz CspOptions.frameAncestors: przy jawnie wpuszczonych źródłach ten
  // nagłówek musi ZNIKNĄĆ, bo nie umie ich wyrazić i zablokowałby ramkę.
  if (resolvedFrameAncestors(options)[0] === "'none'") {
    response.headers.set("X-Frame-Options", "DENY");
  } else {
    response.headers.delete("X-Frame-Options");
  }
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
