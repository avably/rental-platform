import { PRODUCT_NAME, bcp47, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Geist } from "next/font/google";
import { notFound } from "next/navigation";

import { routing } from "@/i18n/routing";

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

  return (
    <html
      lang={bcp47(locale as Locale)}
      className={`${geistSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
