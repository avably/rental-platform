import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";

import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import enMessages from "@/messages/en.json";

export type PrivacyCopy = typeof enMessages.privacy;

export function PrivacyDocument({ copy }: { copy: PrivacyCopy }) {
  return (
    <div className="min-h-screen bg-landing-paper text-foreground">
      <header className="border-b border-border bg-landing-paper">
        <div className="mx-auto flex h-16 w-full max-w-4xl items-center px-5 sm:px-8">
          <Link className="text-sm font-medium underline underline-offset-4" href="/">
            {copy.backToHome}
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl px-5 py-16 sm:px-8 sm:py-24">
        <header className="border-b border-border pb-10">
          <h1 className="landing-heading text-balance">{copy.title}</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {copy.updatedLabel} {copy.updatedValue}
          </p>
        </header>
        <div className="mt-12 grid gap-12">
          {copy.sections.map((section) => (
            <section key={section.heading}>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{section.heading}</h2>
              <div className="mt-5 grid gap-4 leading-7 text-muted-foreground">
                {section.body.map((paragraph) => (
                  <p className="whitespace-pre-line" key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "privacy" });
  const copy: PrivacyCopy = {
    title: t("title"),
    updatedLabel: t("updatedLabel"),
    updatedValue: t("updatedValue"),
    backToHome: t("backToHome"),
    sections: t.raw("sections") as PrivacyCopy["sections"],
  };
  return <PrivacyDocument copy={copy} />;
}
