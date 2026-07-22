import { bcp47, type Locale } from "@avably/core";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { WF_SITE } from "@/lib/marketing/template";

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

  return (
    <html data-wf-site={WF_SITE} lang={bcp47(locale as Locale)}>
      <head>
        <link href="/forerunner/css/normalize.css" rel="stylesheet" />
        <link href="/forerunner/css/webflow.css" rel="stylesheet" />
        <link href="/forerunner/css/forerunner-template.webflow.css" rel="stylesheet" />
        <link href="/forerunner/images/avably-favicon.svg" rel="shortcut icon" type="image/x-icon" />
        <link href="/forerunner/images/avably-favicon.svg" rel="apple-touch-icon" />
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
      </body>
    </html>
  );
}
