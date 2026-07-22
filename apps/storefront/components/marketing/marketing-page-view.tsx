import type { Locale } from "@avably/core";

import {
  marketingLinks,
  renderMarketingPage,
  wfPageId,
  WF_SITE,
  type MarketingPage,
} from "@/lib/marketing/template";

import { LandingAnalytics } from "../landing-analytics";
import { MarketingRuntime } from "./marketing-runtime";

interface MarketingPageViewProps {
  copy: Record<string, unknown>;
  locale: Locale;
  page: MarketingPage;
  /** Treść wstawiana w miejsce wyspy (formularz) — patrz `marketing/*.html`. */
  island?: React.ReactNode;
}

const ISLAND_MARKER = "<!--avably-island-->";

/**
 * Render strony przeniesionej z szablonu. HTML jest źródłem układu, treść
 * wchodzi tokenami, a interaktywne fragmenty (formularz waitlisty) wstawiamy
 * jako wyspę Reacta w miejscu znacznika — dzięki temu jeden plik niesie i
 * dokładny układ szablonu, i nasz komponent.
 */
export function MarketingPageView({ copy, locale, page, island }: MarketingPageViewProps) {
  const html = renderMarketingPage(page, { ...copy, ...marketingLinks(locale) });
  const [before, after] = html.split(ISLAND_MARKER);

  return (
    <>
      <LandingAnalytics locale={locale} />
      <MarketingRuntime wfPage={wfPageId(page)} wfSite={WF_SITE} />
      <div dangerouslySetInnerHTML={{ __html: before }} />
      {island && after !== undefined ? (
        <>
          {island}
          <div dangerouslySetInnerHTML={{ __html: after }} />
        </>
      ) : null}
    </>
  );
}
