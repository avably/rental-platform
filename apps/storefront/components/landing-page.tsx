import Image from "next/image";

import enMessages from "@/messages/en.json";

import { FaqAccordion } from "./faq-accordion";
import { LandingAnalytics } from "./landing-analytics";
import { LandingWireframe } from "./landing-wireframes";
import { LanguageSwitcher } from "./language-switcher";
import { ThemeToggle } from "./theme-toggle";
import { TrackedCta } from "./tracked-cta";
import { WaitlistForm } from "./waitlist-form";

export type LandingCopy = typeof enMessages.landing;

interface LandingPageProps {
  copy: LandingCopy;
  locale: "en" | "pl";
  waitlistEnabled: boolean;
}

const sectionClass = "mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10";

export function LandingPage({ copy, locale, waitlistEnabled }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <LandingAnalytics locale={locale} />
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8 lg:px-10">
          <a className="text-lg font-semibold tracking-tight" href={`/${locale}`}>
            {copy.header.brand}
          </a>
          <div className="flex items-center gap-2">
            <ThemeToggle darkLabel={copy.header.darkTheme} lightLabel={copy.header.lightTheme} />
            <LanguageSwitcher copy={copy.header} locale={locale} />
          </div>
        </div>
      </header>

      <main>
        <section className={`${sectionClass} grid items-center gap-12 lg:grid-cols-[0.88fr_1.12fr]`} data-analytics-section="hero">
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {copy.hero.eyebrow}
            </p>
            <h1 className="max-w-3xl text-balance text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              {copy.hero.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">{copy.hero.body}</p>
            <TrackedCta
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              locale={locale}
              placement="hero"
            >
              {copy.hero.cta}
            </TrackedCta>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">{copy.hero.microcopy}</p>
          </div>
          <LandingWireframe
            ariaLabel={copy.hero.wireframe.ariaLabel}
            items={copy.hero.wireframe.items}
            label={copy.hero.wireframe.label}
          />
        </section>

        <section
          aria-labelledby="problem-title"
          className={`${sectionClass} border-y border-border`}
          data-analytics-section="problem"
        >
          <div className="max-w-3xl">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl" id="problem-title">
              {copy.problem.title}
            </h2>
            <p className="mt-5 text-xl leading-8">{copy.problem.intro}</p>
          </div>
          <p className="mt-10 overflow-x-auto border-y border-border py-4 text-sm font-medium text-muted-foreground">
            {copy.problem.flow}
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-[1.35fr_0.65fr]">
            {/* DO PODMIANY NA AUTENTYCZNE ZDJĘCIE PRZED LAUNCHEM */}
            <Image
              alt={copy.problem.warehouseAlt}
              className="h-72 w-full rounded-lg object-cover sm:h-96"
              height={927}
              priority={false}
              sizes="(min-width: 640px) 65vw, 100vw"
              src="/images/equipment-workbench.webp"
              width={1400}
            />
            {/* DO PODMIANY NA AUTENTYCZNE ZDJĘCIE PRZED LAUNCHEM */}
            <Image
              alt={copy.problem.useAlt}
              className="h-72 w-full rounded-lg object-cover sm:h-96"
              height={1500}
              priority={false}
              sizes="(min-width: 640px) 30vw, 100vw"
              src="/images/equipment-workshop.webp"
              width={1000}
            />
          </div>
          <div className="mt-10 divide-y divide-border">
            {copy.problem.items.map((item) => (
              <article className="grid gap-3 py-7 md:grid-cols-[0.75fr_1.25fr] md:gap-10" key={item.title}>
                <h3 className="text-lg font-semibold">{item.title}</h3>
                <p className="leading-7 text-muted-foreground">{item.body}</p>
              </article>
            ))}
          </div>
          <p className="mt-8 max-w-3xl text-lg font-medium">{copy.problem.closing}</p>
        </section>

        <div data-analytics-section="capabilities">
          {copy.capabilities.map((capability, index) => (
            <section
              aria-labelledby={`capability-${index}`}
              className={`${sectionClass} grid items-center gap-12 border-b border-border lg:grid-cols-2`}
              key={capability.title}
            >
              <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {capability.eyebrow}
                </p>
                <h2
                  className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl"
                  id={`capability-${index}`}
                >
                  {capability.title}
                </h2>
                <p className="mt-5 text-lg leading-8 text-muted-foreground">{capability.body}</p>
                <ul className="mt-7 grid gap-3">
                  {capability.items.map((item) => (
                    <li className="border-l-2 border-foreground/20 pl-4 leading-7" key={item}>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className={index % 2 === 1 ? "lg:order-1" : undefined}>
                <LandingWireframe
                  ariaLabel={capability.wireframeAriaLabel}
                  items={capability.wireframeItems}
                  label={capability.wireframeLabel}
                />
              </div>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="founder-title"
          className={`${sectionClass} border-b border-border`}
          data-analytics-section="founder"
        >
          <div className="max-w-4xl">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-4xl" id="founder-title">
              {copy.founder.title}
            </h2>
            <div className="mt-8 grid gap-6 text-lg leading-8 text-muted-foreground md:grid-cols-2">
              {copy.founder.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
            <p className="mt-8 border-t border-border pt-6 font-semibold">{copy.founder.signature}</p>
          </div>
        </section>

        <section
          aria-labelledby="founders-title"
          className={`${sectionClass} grid gap-12 border-b border-border lg:grid-cols-[1.1fr_0.9fr]`}
          data-analytics-section="founders"
        >
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {copy.founders.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl" id="founders-title">
              {copy.founders.title}
            </h2>
            <p className="mt-6 text-lg leading-8 text-muted-foreground">
              {copy.founders.bodyBeforePrice} <strong className="text-foreground">{copy.founders.price}</strong>
              {copy.founders.bodyBetween}{" "}
              <strong className="text-foreground">{copy.founders.discount}</strong>
              {copy.founders.bodyAfter}
            </p>
            <TrackedCta
              className="mt-8 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              locale={locale}
              placement="founders"
            >
              {copy.founders.cta}
            </TrackedCta>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{copy.founders.microcopy}</p>
          </div>
          <div>
            <p className="font-semibold">{copy.founders.listIntro}</p>
            <ul className="mt-5 divide-y divide-border border-y border-border">
              {copy.founders.items.map((item) => (
                <li className="py-4 leading-7" key={item}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          aria-labelledby="waitlist-title"
          className={sectionClass}
          data-analytics-section="waitlist"
          id="waitlist"
        >
          <div className="mx-auto max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {copy.form.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl" id="waitlist-title">
              {copy.form.title}
            </h2>
            <p className="mt-5 text-lg leading-8 text-muted-foreground">{copy.form.intro}</p>
            <WaitlistForm copy={copy.form} enabled={waitlistEnabled} locale={locale} />
          </div>
        </section>

        <section
          aria-labelledby="faq-title"
          className={`${sectionClass} border-t border-border bg-landing-warm`}
          data-analytics-section="faq"
        >
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {copy.faq.eyebrow}
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-[-0.03em] sm:text-4xl" id="faq-title">
              {copy.faq.title}
            </h2>
            <div className="mt-10">
              <FaqAccordion items={copy.faq.items} />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-10 text-sm text-muted-foreground sm:px-8 md:grid-cols-[1fr_auto] lg:px-10">
          <div>
            <p>{copy.footer.description}</p>
            <p className="mt-2">{copy.footer.copyright}</p>
          </div>
          <a aria-disabled="true" className="underline underline-offset-4" href="#privacy-policy-pending">
            {copy.footer.privacy}
          </a>
        </div>
      </footer>
    </div>
  );
}
