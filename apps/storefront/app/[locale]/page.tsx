import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
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
  const metadata = messages.landing.metadata;
  const canonical = `${CANONICAL_SITE_URL}/${locale}`;

  return {
    title: metadata.title,
    description: metadata.description,
    alternates: { canonical },
    openGraph: {
      title: metadata.ogTitle,
      description: metadata.ogDescription,
      locale,
      type: "website",
      url: canonical,
    },
  };
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = (await getMessages({ locale })) as AppMessages;

  return (
    <MarketingPageView copy={messages.marketing} locale={locale as Locale} page="home" />
  );
}
