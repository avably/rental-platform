import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { PrivacyContent } from "@/components/marketing/privacy-content";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";

type AppMessages = typeof enMessages;

// CSP wymaga nonce per żądanie; statyczny HTML nie może go nadać skryptom Next.js.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = (await getMessages({ locale })) as AppMessages;

  return {
    title: messages.privacy.title,
    description: messages.marketing.privacyPage.metadataDescription,
    alternates: { canonical: `${CANONICAL_SITE_URL}/${locale}/privacy` },
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = (await getMessages({ locale })) as AppMessages;

  return (
    <MarketingPageView
      copy={messages.marketing}
      island={<PrivacyContent copy={messages.privacy} />}
      locale={locale as Locale}
      page="privacy"
    />
  );
}
