import { bcp47, type Locale } from "@avably/core";
import { ReviewOverlayGate } from "@avably/review/overlay";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { wfBootstrapScript } from "@/lib/marketing/template";
import { isReviewSurfaceEnabled } from "@/lib/review-gate";

const MARKETING_A11Y_CSS = `
.marketing-skip-link {
  position: fixed;
  top: 8px;
  left: 16px;
  z-index: 10000;
  padding: 10px 14px;
  transform: translateY(-200%);
  border: 2px solid currentColor;
  background: #fff;
  color: #0b1017;
  font: 600 16px/1.25 Arial, sans-serif;
}
.marketing-skip-link:focus-visible { transform: none; }
:where(.nav-link, .cta-main, .footer-link, .text-underline, .marketing-skip-link):focus-visible {
  outline: 3px solid currentColor;
  outline-offset: 3px;
}
:where(.cta-main, .footer-link) { min-height: 44px; }
.footer-link { display: inline-flex; align-items: center; }
`;

/**
 * Root layout OSI MARKETINGOWEJ (www.avably.io).
 *
 * Ładuje wyłącznie arkusze przeniesionego szablonu (ADR-068) — bez Tailwinda
 * i bez `@avably/ui`. To jest granica izolacji: sklepy najemców mają własny
 * root layout `(tenant)/layout.tsx`, który importuje `globals.css` i tokeny
 * Fazy 2. Żaden arkusz szablonu tam nie dociera, bo obie grupy tras są
 * osobnymi rootami i nie dziedziczą po sobie.
 *
 * Kolejność arkuszy jest ta sama co w eksporcie: normalize → webflow → motyw.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  // CSP ma 'strict-dynamic' i nonce per żądanie (proxy → @avably/security).
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={bcp47(locale as Locale)}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: wfBootstrapScript() }} nonce={nonce} />
        {/* Arkusze szablonu są plikami eksportu, nie modułami CSS — import
            przez bundler przepisałby ścieżki fontów i obrazów w `url()`.
            eslint-disable-next-line @next/next/no-css-tags */}
        <link href="/forerunner/css/normalize.css" rel="stylesheet" />
        <link href="/forerunner/css/webflow.css" rel="stylesheet" />
        <link href="/forerunner/css/forerunner-template.webflow.css" rel="stylesheet" />
        <link href="/forerunner/css/avably-marketing.css" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{ __html: MARKETING_A11Y_CSS }} nonce={nonce} />
        {/* Ikona SVG marki dla przeglądarek; starsze wracają do app/favicon.ico
            (konwencja Next). Bez apple-touch-icon — iOS wymaga tam PNG, a nie SVG. */}
        <link href="/forerunner/images/avably-favicon.svg" rel="icon" type="image/svg+xml" />
        {/* Bez JS interakcje szablonu nie odsłonią elementów startujących od
            opacity:0 — reguła awaryjna pokazuje treść zamiast pustej strony. */}
        <noscript>
          <style
            dangerouslySetInnerHTML={{ __html: '[style*="opacity:0"]{opacity:1 !important}' }}
          />
        </noscript>
      </head>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* Kolejność i moment wykonania jak w eksporcie: jQuery przed
            webflow.js, oba przed DOMContentLoaded. Interakcje odsłaniające
            sekcje startują „na wczytaniu strony” — biblioteka doładowana
            później nie ma już czego złapać. */}
        <script defer nonce={nonce} src="/forerunner/js/jquery.min.js" />
        <script defer nonce={nonce} src="/forerunner/js/webflow.js" />
        {/* Nakładka przeglądu (ADR-071): REVIEW_MODE=1 ORAZ środowisko inne niż
            produkcyjne — po zdjęciu Basic Auth (ADR-128) marketing jest realnie
            publiczny, więc sama flaga nie może być jedyną bramką. Trzeci warunek
            (?review=1) domyka klient. Chrome nakładki jedzie na tokenach Fazy 2
            niezależnie od arkuszy szablonu (izolacja ADR-068 nietknięta). */}
        {isReviewSurfaceEnabled() ? <ReviewOverlayGate surface="marketing" /> : null}
      </body>
    </html>
  );
}
