import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { TermsContent } from "@/components/marketing/terms-content";
import { getPlatformTermsVersion, platformTermsLocalized } from "@/lib/legal/platform-terms";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";

type AppMessages = typeof enMessages;

/**
 * PERMALINK konkretnej wersji regulaminu platformy: /{locale}/terms/w/2
 * (0070, ADR-141 — „adres ma dać się przepisać", wzorzec B4). Wersje są
 * niezmienne, więc czytelnik okazuje dokładnie ten tekst, który
 * zaakceptował — także po wejściu nowszych wersji.
 *
 * Numer, nie uuid; wejście spoza zakresu liczb naturalnych ≥ 1 kończy się
 * 404 bez odpytania bazy (v0 to placeholder-szkic i nie wychodzi NIGDY —
 * pilnuje tego sama funkcja `app.get_platform_terms_version`). Wersje
 * ARCHIWALNE mają istnieć dla stron umowy, a nie konkurować w wynikach
 * z obowiązującą — stąd noindex.
 */
export const dynamic = "force-dynamic";

const VERSION_SHAPE = /^[1-9][0-9]{0,8}$/;

interface RouteParams {
  locale: string;
  wersja: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { locale, wersja } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!VERSION_SHAPE.test(wersja)) return {};

  const document = await getPlatformTermsVersion(Number(wersja));
  if (!document) return {};

  const metadata: Metadata = {
    title: `${platformTermsLocalized(document, locale).title} (${document.version_label})`,
    alternates: { canonical: `${CANONICAL_SITE_URL}/${locale}/terms/w/${document.version_no}` },
  };
  if (!document.current) metadata.robots = { index: false, follow: true };
  return metadata;
}

export default async function TermsVersionPage({ params }: { params: Promise<RouteParams> }) {
  const { locale, wersja } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  if (!VERSION_SHAPE.test(wersja)) notFound();

  const document = await getPlatformTermsVersion(Number(wersja));
  if (!document) notFound();

  const messages = (await getMessages({ locale })) as AppMessages;

  return (
    <MarketingPageView
      copy={messages.marketing}
      island={<TermsContent document={document} copy={messages.terms} locale={locale} />}
      locale={locale as Locale}
      page="terms"
    />
  );
}
