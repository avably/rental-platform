import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Nagłówki bezpieczeństwa dla odpowiedzi, których `proxy.ts` NIE dotyka
 * (L-01, audyt bezpieczeństwa 2026-08-09; ADR-124). Matcher proxy.ts
 * (`"/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"`) wyklucza
 * `_next/static`, `_next/image`, favicon i KAŻDĄ ścieżkę z rozszerzeniem —
 * te same odpowiedzi (404, `robots.txt`, `sitemap.xml`, `security.txt`,
 * zasoby statyczne) omijają `applySecurityHeaders` z `@avably/security`.
 * `headers()` configu Next.js jest PODŁOGĄ pod całym ruchem — framework ją
 * stosuje niezależnie od tego, czy proxy w ogóle się wykonało.
 *
 * WARTOŚCI MUSZĄ zostać zsynchronizowane z `applySecurityHeaders`
 * (`packages/security/src/index.ts`) — pilnuje tego
 * `test/next-config-headers.test.ts` (porównuje literały, nie zgaduje).
 * Nie importujemy stamtąd wprost: ten plik ładuje Node BEZPOŚREDNIO, zanim
 * zadziała `transpilePackages` (ta działa dopiero w bundlu aplikacji, nie
 * w loaderze configu) — import realnego pakietu workspace w tym miejscu
 * byłby kruchy i psułby się w sposób trudny do zdiagnozowania.
 *
 * CSP NIE wchodzi tutaj i to jest decyzja: zostaje WYŁĄCZNIE w proxy.ts,
 * gdzie dostaje świeży nonce per żądanie. Statyczny CSP bez nonce na
 * surowych zasobach byłby iluzją polityki, nie polityką — zgodnie z
 * zaleceniem audytu CSP na tych odpowiedziach nie jest konieczne.
 */
const STATIC_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@avably/core", "@avably/db",
    "@avably/review", "@avably/security", "@avably/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  async headers() {
    return [
      {
        // Podłoga dla WSZYSTKICH odpowiedzi, w tym embedu — te cztery
        // nagłówki są identyczne na każdej trasie (proxy.ts ich nie różnicuje
        // per route ani dla /embed/**), więc bezpieczne bez wyjątków.
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
      {
        // X-Frame-Options WYŁĄCZONY na `/embed/**`: cała ta przestrzeń (M3,
        // ADR-120) przechodzi przez proxy.ts (jej trasy celowo NIE mają
        // rozszerzenia w ścieżce — patrz `app/embed/loader/route.ts`) i
        // dostaje WŁASNĄ, węższą politykę ramkowania z @avably/security
        // (`frame-ancestors 'self' https:`, BEZ nagłówka XFO — ten nie umie
        // wyrazić listy źródeł i zablokowałby ramkę, którą CSP właśnie
        // wpuściła). Wykluczenie ścieżki jest STRUKTURALNE (negative
        // lookahead w segmencie, ten sam wzorzec co matcher proxy.ts) —
        // nie założeniem o kolejności next.config vs middleware.
        source: "/:path((?!embed/).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
