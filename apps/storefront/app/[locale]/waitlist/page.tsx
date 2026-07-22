import { CANONICAL_SITE_URL, type Locale } from "@avably/core";
import type { Metadata } from "next";
import { hasLocale } from "next-intl";
import { getMessages } from "next-intl/server";
import { notFound } from "next/navigation";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { WaitlistForm } from "@/components/waitlist-form";
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
  const copy = messages.landing.waitlistPage;

  return {
    title: copy.metadataTitle,
    description: copy.metadataDescription,
    alternates: { canonical: `${CANONICAL_SITE_URL}/${locale}/waitlist` },
  };
}

export default async function WaitlistPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  const messages = (await getMessages({ locale })) as AppMessages;

  return (
    <MarketingPageView
      copy={{ ...messages.marketing, form: messages.landing.form }}
      island={
        <WaitlistForm
          copy={messages.landing.form}
          enabled={process.env.WAITLIST_ENABLED === "true"}
          locale={locale as Locale}
          // Odczyt w komponencie serwerowym (strona jest force-dynamic):
          // ten sam warunek co dyrektywy Turnstile w proxy.
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />
      }
      locale={locale as Locale}
      page="waitlist"
    />
  );
}
