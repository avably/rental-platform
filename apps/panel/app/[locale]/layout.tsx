import { PRODUCT_NAME, bcp47, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

import "../globals.css";

// Sygnał operacyjny (ADR-053): panel w całości w Geist Sans, bez Geist Mono.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
  display: "swap",
});

/** Prerender obu locale zamiast renderu na żądanie. */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });

  return {
    title: `${t("panelTitle")} · ${PRODUCT_NAME}`,
    description: t("panelDescription"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  // Locale spoza listy to 404, nie cichy fallback — inaczej /xx renderowałby
  // się po angielsku i indeksował jako osobna strona.
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  // Nonce żądania (ADR-012) — bez niego CSP `strict-dynamic` odmówi wykonania
  // skryptu motywu i ciemny wracałby do jasnego przy każdym wejściu.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    /*
      `suppressHydrationWarning` na <html>: skrypt startowy dokłada klasę
      `dark` i `data-theme` PRZED hydracją, więc znacznik z serwera z
      założenia różni się od tego, co React zastaje w drzewie. To jedyny
      element, którego to dotyczy — ostrzeżenie byłoby tu szumem, a nie
      sygnałem.
    */
    <html
      lang={bcp47(locale as Locale)}
      className={`${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/*
          DRUGIE `suppressHydrationWarning`, tym razem na samym <script>
          (recenzja PR #89). Serwer renderuje `nonce="…"`, ale przeglądarki
          CELOWO ukrywają ten atrybut przed DOM-em — czytany z drzewa jest
          pusty. React 19 porównuje jedno z drugim i przy każdym wejściu
          logował „A tree hydrated but some attributes…". Funkcjonalnie nic
          się nie działo (produkcja nie loguje rozjazdów atrybutów, a sam
          nonce działa — CSP przepuszcza skrypt), ale stały szum w konsoli
          dev zjada wartość reguły „zero błędów konsoli" i myli każdą
          kolejną sesję. Wyciszamy DOKŁADNIE ten element, nie całe drzewo.
        */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
