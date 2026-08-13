import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";
import { TEMPLATE_ROUTES, type MarketingPage } from "@/lib/marketing/template";

type AppMessages = typeof enMessages;

// CSP wymaga nonce per żądanie; statyczny HTML nie może go nadać skryptom Next.js.
export const dynamic = "force-dynamic";

function resolvePage(page: string): MarketingPage {
  if (!(TEMPLATE_ROUTES as readonly string[]).includes(page)) notFound();
  return page as MarketingPage;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; page: string }>;
}): Promise<Metadata> {
  const { locale, page } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const resolved = resolvePage(page);
  const messages = (await getMessages({ locale })) as AppMessages;

  const copy = messages.marketing;
  const pageCopy =
    resolved === "pricing"
      ? copy.pricingPage
      : resolved === "faq"
        ? copy.faqPage
        : copy.contactPage;
  return {
    title: `${pageCopy.title} — Avably`,
    description: pageCopy.metadataDescription,
    alternates: { canonical: `${CANONICAL_SITE_URL}/${locale}/${resolved}` },
  };
}

export default async function TemplatePage({
  params,
}: {
  params: Promise<{ locale: string; page: string }>;
}) {
  const { locale, page } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const resolved = resolvePage(page);
  const messages = (await getMessages({ locale })) as AppMessages;

  return (
    <MarketingPageView copy={messages.marketing} locale={locale as Locale} page={resolved} />
  );
}
