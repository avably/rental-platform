import type { Locale } from "@avably/core";

import { getPlatformTerms } from "@/lib/legal/platform-terms";
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
 * Czy powierzchnia marketingowa ma prawo linkować regulamin platformy.
 *
 * Odpowiada dokładnie na to samo pytanie co `/[locale]/terms`: czy jakaś wersja
 * OBOWIĄZUJE (0070, ADR-141). Źródłem prawdy jest baza — ta sama funkcja, którą
 * woła strona regulaminu i sitemapa — a nie flaga w kodzie ani zmienna
 * środowiskowa: treść wejdzie migracją-seedem od prawnika i nikt nie będzie
 * wtedy szukał drugiego miejsca do przełączenia.
 *
 * WYJĄTEK ZJADANY ŚWIADOMIE. `getPlatformTerms` jest fail-closed wobec błędu
 * RPC, ale samo zbudowanie klienta (brak konfiguracji, cookies poza żądaniem)
 * potrafi rzucić — a to jest jedyne dotknięcie bazy na stronie głównej, która
 * dotąd renderowała się bez niej. Awaria odczytu ma zabrać JEDEN link w stopce,
 * nie całą stronę wejściową; kierunek odmowy jest zresztą ten sam, w którym
 * odpowie wtedy `/terms`.
 */
async function platformTermsPublished(): Promise<boolean> {
  try {
    return (await getPlatformTerms()) !== null;
  } catch {
    return false;
  }
}

/**
 * Render strony przeniesionej z szablonu (ADR-068). HTML jest źródłem układu,
 * treść wchodzi tokenami, a fragmenty interaktywne wstawiamy jako wyspę Reacta
 * w miejscu znacznika.
 *
 * Skrypty szablonu ładuje layout (`defer`, kolejność jak w eksporcie), a
 * `MarketingRuntime` domyka identyfikator strony dla IX2 i ponowną
 * inicjalizację interakcji po hydratacji.
 *
 * REGUŁA REGULAMINU SIEDZI TUTAJ, a nie w każdej trasie z osobna: stopkę
 * renderuje KAŻDA strona marketingowa, więc trasa dopisana jutro dziedziczy ją
 * bez pamiętania o niej. Właśnie tego zabrakło — sitemapa znała regułę
 * (`app/sitemap.xml/route.ts`), stopka nie, i wystawiała 404 każdemu gościowi LP.
 *
 * Odczyt kosztuje jedno wywołanie RPC per render; wszystkie trasy marketingowe
 * są i tak `force-dynamic` (CSP wymaga nonce per żądanie), więc nic się przez to
 * nie odstatycznia. Na `/terms` to samo pytanie pada dwa razy — raz w trasie,
 * raz tutaj — i jest to świadoma cena za regułę trzymaną w JEDNYM miejscu.
 */
export async function MarketingPageView({ copy, locale, page, island }: MarketingPageViewProps) {
  const html = renderMarketingPage(
    page,
    { ...copy, ...marketingLinks(locale) },
    { terms: await platformTermsPublished() },
  );
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
