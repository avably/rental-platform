import { PRODUCT_NAME, bcp47, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";

import "../globals.css";

/*
 * Sygnał operacyjny (ADR-053): panel w całości w Geist Sans, bez Geist Mono.
 *
 * KRÓJ Z REPOZYTORIUM, NIE Z SIECI (dziennik 2026-08-12). `next/font/google`
 * pobierał plik w czasie BUDOWANIA: 2026-08-12 `fonts.gstatic.com` przez
 * kilkanaście minut oddawał 404 na wycofywaną rodzinę adresów i wywrócił CI
 * dwa razy (`Module not found: … /internal/font/google/font`), po czym ten sam
 * commit zbudował się bez żadnej zmiany. Build zależny od cudzego CDN-u nie
 * jest odtwarzalny, więc plik leży u nas — tak samo jak kroje stron najemców
 * (ADR-090), w packages/ui/fonts razem z treścią licencji OFL.
 *
 * `weight: "400 600"` odwzorowuje POPRZEDNI stan co do joty: Google serwowało
 * ten sam plik zmienny w trzech deklaracjach (400/500/600), więc `font-bold`
 * (700) rozstrzygał się do najbliższej dostępnej, czyli 600. Pełny zakres
 * „100 900" pogrubiłby te miejsca — to byłaby zmiana wyglądu.
 */
const geistSans = localFont({
  src: "../../../../packages/ui/fonts/geist-variable.woff2",
  variable: "--font-geist-sans",
  weight: "400 600",
  style: "normal",
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
