import Image from "next/image";

import { Link } from "@/i18n/navigation";
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

const sectionClass = "mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28 lg:px-10 lg:py-32";
const eyebrowClass = "text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const primaryCtaClass =
  "landing-pill inline-flex min-h-12 items-center justify-center bg-landing-ink px-7 py-3 text-sm font-semibold text-white ring-1 ring-white/30 focus-visible:outline-2 focus-visible:outline-offset-4";

export function LandingPage({ copy, locale, waitlistEnabled }: LandingPageProps) {
  return (
    <div className="min-h-screen bg-landing-paper text-foreground">
      <LandingAnalytics locale={locale} />
      <header className="border-b border-border bg-landing-paper">
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
        <section
          className="landing-hero relative isolate grid min-h-[44rem] place-items-center overflow-hidden px-5 py-24 text-white sm:px-8"
          data-analytics-section="hero"
          data-landing-section="hero"
        >
          <LandingWireframe
            ariaLabel={copy.hero.wireframe.ariaLabel}
            items={copy.hero.wireframe.items}
            label={copy.hero.wireframe.label}
            variant="hero"
          />
          <div className="relative z-10 mx-auto flex max-w-4xl flex-col items-center text-center">
            <p className="mb-6 text-sm font-semibold uppercase tracking-[0.18em] text-white/80">
              {copy.hero.eyebrow}
            </p>
            <h1 className="landing-display text-balance">{copy.hero.title}</h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/80">{copy.hero.body}</p>
            <TrackedCta
              className={`${primaryCtaClass} mt-9`}
              dataHeroCta
              locale={locale}
              placement="hero"
            >
              {copy.hero.cta}
            </TrackedCta>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/70">{copy.hero.microcopy}</p>
            <p className="landing-pill mt-10 border border-white/25 bg-black/25 px-4 py-2 text-xs font-medium text-white/80">
              {copy.hero.wireframe.label}
            </p>
          </div>
        </section>

        <section
          className="bg-landing-paper"
          data-landing-section="statement"
        >
          <div className={`${sectionClass} landing-reveal`}>
            <p className="landing-statement max-w-5xl text-balance">{copy.problem.intro}</p>
          </div>
        </section>

        <section
          aria-labelledby="problem-title"
          className="border-y border-border bg-landing-warm"
          data-analytics-section="problem"
          data-landing-section="problem"
        >
          <div className={`${sectionClass} landing-reveal`}>
            <div className="max-w-3xl">
              <h2 className="landing-heading" id="problem-title">
                {copy.problem.title}
              </h2>
            </div>
            <p className="mt-10 overflow-x-auto border-y border-border py-4 text-sm font-medium text-muted-foreground">
              {copy.problem.flow}
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-[1.35fr_0.65fr]">
              {/* DO PODMIANY NA AUTENTYCZNE ZDJĘCIE PRZED LAUNCHEM */}
              <Image
                alt={copy.problem.warehouseAlt}
                className="h-72 w-full rounded-2xl object-cover sm:h-96"
                height={927}
                priority={false}
                sizes="(min-width: 640px) 65vw, 100vw"
                src="/images/equipment-workbench.webp"
                width={1400}
              />
              {/* DO PODMIANY NA AUTENTYCZNE ZDJĘCIE PRZED LAUNCHEM */}
              <Image
                alt={copy.problem.useAlt}
                className="h-72 w-full rounded-2xl object-cover sm:h-96"
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
          </div>
        </section>

        <div data-analytics-section="capabilities">
          {copy.capabilities.map((capability, index) => (
            <section
              aria-labelledby={`capability-${index}`}
              className={`border-b border-border ${index % 2 === 0 ? "bg-landing-paper" : "bg-landing-warm"}`}
              data-landing-section="capability"
              key={capability.title}
            >
              <div className={`${sectionClass} landing-reveal grid items-center gap-12 lg:grid-cols-2 lg:gap-20`}>
                <div className={index % 2 === 1 ? "lg:order-2" : undefined}>
                  <p className={eyebrowClass}>{capability.eyebrow}</p>
                  <h2 className="landing-heading mt-4" id={`capability-${index}`}>
                    {capability.title}
                  </h2>
                  <p className="mt-6 text-lg leading-8 text-muted-foreground">{capability.body}</p>
                  <ul className="mt-8 grid gap-3">
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
              </div>
            </section>
          ))}
        </div>

        <section
          aria-labelledby="founder-title"
          className="landing-dark-section"
          data-analytics-section="founder"
          data-landing-section="founder"
        >
          <div className={`${sectionClass} landing-reveal`}>
            <div className="max-w-4xl">
              <h2 className="landing-heading" id="founder-title">
                {copy.founder.title}
              </h2>
              <div className="landing-secondary mt-10 grid gap-7 text-lg leading-8 md:grid-cols-2">
                {copy.founder.paragraphs.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
              <p className="mt-10 border-t border-white/20 pt-7 font-semibold">{copy.founder.signature}</p>
            </div>
          </div>
        </section>

        <section
          aria-labelledby="founders-title"
          className="border-b border-border bg-landing-warm"
          data-analytics-section="founders"
          data-landing-section="founders"
        >
          <div className={`${sectionClass} landing-reveal grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:gap-20`}>
            <div>
              <p className={eyebrowClass}>{copy.founders.eyebrow}</p>
              <h2 className="landing-heading mt-4" id="founders-title">
                {copy.founders.title}
              </h2>
              <p className="mt-7 text-lg leading-8 text-muted-foreground">
                {copy.founders.bodyBeforePrice} <strong className="text-foreground">{copy.founders.price}</strong>
                {copy.founders.bodyBetween} <strong className="text-foreground">{copy.founders.discount}</strong>
                {copy.founders.bodyAfter}
              </p>
              <TrackedCta className={`${primaryCtaClass} mt-9`} locale={locale} placement="founders">
                {copy.founders.cta}
              </TrackedCta>
              <p className="mt-4 text-sm leading-6 text-muted-foreground">{copy.founders.microcopy}</p>
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
          </div>
        </section>

        <section
          aria-labelledby="waitlist-title"
          className="bg-landing-paper"
          data-analytics-section="waitlist"
          data-landing-section="waitlist"
          id="waitlist"
        >
          <div className={`${sectionClass} landing-reveal`}>
            <div className="mx-auto max-w-2xl">
              <p className={eyebrowClass}>{copy.form.eyebrow}</p>
              <h2 className="landing-heading mt-4" id="waitlist-title">
                {copy.form.title}
              </h2>
              <p className="mt-6 text-lg leading-8 text-muted-foreground">{copy.form.intro}</p>
              <WaitlistForm copy={copy.form} enabled={waitlistEnabled} locale={locale} />
            </div>
          </div>
        </section>

        <section
          aria-labelledby="faq-title"
          className="border-t border-border bg-landing-warm"
          data-analytics-section="faq"
          data-landing-section="faq"
        >
          <div className={`${sectionClass} landing-reveal`}>
            <div className="mx-auto max-w-4xl">
              <p className={eyebrowClass}>{copy.faq.eyebrow}</p>
              <h2 className="landing-heading mt-4" id="faq-title">
                {copy.faq.title}
              </h2>
              <div className="mt-10">
                <FaqAccordion items={copy.faq.items} />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border bg-landing-paper">
        <div className="mx-auto grid w-full max-w-6xl gap-5 px-5 py-10 text-sm text-muted-foreground sm:px-8 md:grid-cols-[1fr_auto] lg:px-10">
          <div>
            <p>{copy.footer.description}</p>
            <p className="mt-2">{copy.footer.copyright}</p>
          </div>
          <Link className="underline underline-offset-4" href="/privacy">
            {copy.footer.privacy}
          </Link>
        </div>
      </footer>
    </div>
  );
}
