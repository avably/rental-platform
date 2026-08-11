import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { TermsContent } from "@/components/marketing/terms-content";
import { getPlatformTerms, platformTermsLocalized } from "@/lib/legal/platform-terms";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";

type AppMessages = typeof enMessages;

/**
 * ŻYWA (obowiązująca) wersja regulaminu platformy (0070, ADR-141) na osi
 * marketingowej. Źródłem treści jest BAZA (`app.get_platform_terms`), nie
 * messages — jedno źródło dla LP, checkboxa onboardingu i dowodu akceptacji
 * (D6). Brak obowiązującej wersji (stan do migracji-seedu od prawnika) =
 * 404, nie pusta strona.
 *
 * Współistnienie z osią tenancką: `(tenant)/terms` (alias → /regulamin
 * najemcy) i `[locale]/terms` (ten plik) rozstrzyga proxy po hoście —
 * dokładnie tak, jak działa już para `(tenant)/privacy` / `[locale]/privacy`.
 */
// CSP wymaga nonce per żądanie; treść i tak jest per-żądanie (baza).
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const document = await getPlatformTerms();
  if (!document) return {};

  return {
    title: platformTermsLocalized(document, locale).title,
    alternates: { canonical: `${CANONICAL_SITE_URL}/${locale}/terms` },
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  const document = await getPlatformTerms();
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
