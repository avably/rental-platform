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
  /** Treść wstawiana w miejsce wyspy (formularz, dokument) — patrz marketing/*.html. */
  island?: React.ReactNode;
}

const ISLAND_MARKER = "<!--avably-island-->";

/**
 * Render strony przeniesionej z szablonu (ADR-068). HTML jest źródłem układu,
 * treść wchodzi tokenami, a fragmenty interaktywne wstawiamy jako wyspę Reacta
 * w miejscu znacznika.
 *
 * Skrypty szablonu ładuje layout (`defer`, kolejność jak w eksporcie), a
 * `MarketingRuntime` domyka identyfikator strony dla IX2 i ponowną
 * inicjalizację interakcji po hydratacji.
 */
export function MarketingPageView({ copy, locale, page, island }: MarketingPageViewProps) {
  const html = renderMarketingPage(page, { ...copy, ...marketingLinks(locale) });
  const [before, after] = html.split(ISLAND_MARKER);

  return (
    <>
      <LandingAnalytics locale={locale} />
      <MarketingRuntime wfPage={wfPageId(page)} wfSite={WF_SITE} />
      {island && after !== undefined ? (
        // ZNANE OGRANICZENIE (do domknięcia): na stronach z wyspą interakcje
        // odsłaniające nie startują — elementy eksportu zostają na inline
        // `opacity:0`. Do czasu naprawy klasa wymusza widoczność, żeby strona
        // niosła treść zamiast pustego tła. Landing biegnie bez tej klasy,
        // z pełnymi animacjami szablonu.
        <div className="marketing-static">
          <div dangerouslySetInnerHTML={{ __html: before }} />
          {island}
          <div dangerouslySetInnerHTML={{ __html: after }} />
        </div>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: before }} />
      )}
    </>
  );
}
