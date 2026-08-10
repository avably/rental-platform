import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Nagłówki bezpieczeństwa dla odpowiedzi, których `proxy.ts` NIE dotyka
 * (L-01, audyt bezpieczeństwa 2026-08-09; ADR-124). Matcher proxy.ts
 * (`"/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"`) wyklucza
 * `_next/static`, `_next/image`, favicon i KAŻDĄ ścieżkę z rozszerzeniem —
 * te odpowiedzi (404 i zasoby statyczne) omijają `applySecurityHeaders` z
 * `@avably/security`. `headers()` configu Next.js jest PODŁOGĄ pod całym
 * ruchem — framework ją stosuje niezależnie od tego, czy proxy w ogóle się
 * wykonało.
 *
 * Panel — w odróżnieniu od storefrontu — nie ma żadnej trasy embedowalnej
 * (ADR-120 dotyczy wyłącznie `apps/storefront`), więc `X-Frame-Options: DENY`
 * wchodzi tu GLOBALNIE, bez wyjątków ścieżkowych.
 *
 * WARTOŚCI MUSZĄ zostać zsynchronizowane z `applySecurityHeaders`
 * (`packages/security/src/index.ts`) — pilnuje tego
 * `test/next-config-headers.test.ts`. Nie importujemy stamtąd wprost: ten
 * plik ładuje Node BEZPOŚREDNIO, zanim zadziała `transpilePackages` (ta
 * działa dopiero w bundlu aplikacji, nie w loaderze configu).
 *
 * CSP NIE wchodzi tutaj — zostaje WYŁĄCZNIE w proxy.ts, gdzie dostaje
 * świeży nonce per żądanie (statyczny CSP bez nonce na surowych zasobach
 * byłby iluzją polityki, nie polityką).
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
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@avably/core", "@avably/db",
    "@avably/review", "@avably/security", "@avably/ui"],
  turbopack: {
    root: path.join(__dirname, "../.."),
  },
  experimental: {
    /**
     * Górna granica ciała żądania akcji serwerowych. Domyślna to 1 MB —
     * i była tu MILCZĄCĄ NIEPRAWDĄ, zanim ta linia powstała.
     *
     * Panel obiecuje operatorowi dwa limity na plikach: „Zdjęcie może mieć
     * najwyżej 5 MB" (lib/catalog-validation.ts) i — od D3/ADR-076 —
     * „Faktura może mieć najwyżej 8 MB". Obu tych zdań nie dawało się
     * spełnić: żądanie powyżej 1 MB odbijało się o framework, zanim
     * jakakolwiek nasza walidacja je zobaczyła, a operator dostawał błąd
     * 413 bez powodu zamiast zdania, które przeczytał w interfejsie.
     * Limit ogłoszony i limit egzekwowany muszą być tym samym limitem —
     * inaczej odmowa nie jest uczciwa, tylko przypadkowa.
     *
     * 12 MB, a nie 8: to budżet CAŁEGO żądania (obwiednie multipart, pola
     * formularza, narzut kodowania), więc musi być wyraźnie WYŻSZY od
     * największego dopuszczalnego pliku. Wtedy odmową zawsze rusza NASZA
     * bramka, z powodem — a limit frameworka zostaje ostatnią siatką, do
     * której poprawne użycie nie dociera.
     *
     * DRUGIEGO SUFITU TU NIE PODNOSIMY i to jest decyzja. Ciało żądania
     * przechodzi jeszcze przez klon dla warstwy pośredniczącej
     * (`middlewareClientMaxBodySize`, domyślnie 10 MB); powyżej niego
     * `proxy.ts` dostaje ciało OBCIĘTE i akcja kończy się błędem 500
     * „Unexpected end of form". Zamiast rozsuwać oba limity, limit pliku
     * (8 MB) stoi pod tym niższym — mniej globalnych pokręteł i mniej
     * miejsc, w których trzeba pamiętać o obu naraz.
     *
     * ŚWIADOMY KOSZT: ustawienie jest globalne, więc dotyczy także akcji
     * przed zalogowaniem (logowanie, rejestracja, reset hasła) — anonim może
     * wysłać 12 MB zamiast 1 MB. Tamte ścieżki stoją za limitowaniem tempa
     * (@avably/security) i Turnstile, a żadna z nich nie parsuje ciała,
     * zanim odrzuci żądanie, więc kosztem jest przepustowość, nie pamięć.
     */
    serverActions: { bodySizeLimit: "12mb" },
  },

  /**
   * Punkty odbioru przeprowadziły się spod Katalogu do Dostaw (2026-08-04).
   * Stary adres zostaje żywy jako przekierowanie stałe — właściciel ma go
   * w zakładkach, a i tak jest w historii przeglądarek zespołu.
   *
   * `redirects()` z konfiguracji, a NIE trasa-stub pod `katalog/`, i to jest
   * decyzja: stub oznaczałby, że w Katalogu dalej stoi katalog `punkty-odbioru`
   * — czyli dokładnie ten ślad, który przeprowadzka miała usunąć (znalazłby go
   * skan tras, `protected-routes`, każdy `grep`). Konfiguracja trzyma to jako
   * fakt o adresach, nie o strukturze ekranów.
   *
   * `permanent: true` daje 308, a nie 301: 308 zachowuje metodę żądania.
   * Znaczenia praktycznego to tu nie ma (przekierowujemy GET-y z zakładek),
   * ale przeglądarki cache'ują oba tak samo agresywnie, a 308 nie kłamie.
   *
   * Prefiks locale jest CZĘŚCIĄ wzorca: routing panelu ma `localePrefix:
   * "always"`, więc każdy realny adres nosi `/pl` albo `/en` i wzorzec bez
   * prefiksu nie trafiłby w nic. `:rest*` niesie podstrony (`/nowy`,
   * `/<id>`) — zakładka bywa założona na formularzu edycji, nie tylko na liście.
   */
  async redirects() {
    return [
      {
        source: "/:locale(pl|en)/katalog/punkty-odbioru/:rest*",
        destination: "/:locale/ustawienia-dostaw/punkty-odbioru/:rest*",
        permanent: true,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: STATIC_SECURITY_HEADERS,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
