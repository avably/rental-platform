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
import { MarketingNavA11y } from "./marketing-nav-a11y";
import { MarketingRuntime } from "./marketing-runtime";

interface MarketingPageViewProps {
  copy: Record<string, unknown>;
  locale: Locale;
  page: MarketingPage;
  /** Dokładny odpowiednik językowy, np. ta sama wersja opublikowanego regulaminu. */
  alternateHref?: string;
  /** Treść wstawiana w miejsce wyspy (formularz, dokument) — patrz marketing/*.html. */
  island?: React.ReactNode;
}

const ISLAND_MARKER = "<!--avably-island-->";
const FOOTER_MARKER = '<section class="footer-component">';

/**
 * Etykieta przycisku menu dla czytnika ekranu — z treści, nie z literału.
 *
 * Brak klucza jest BŁĘDEM, dokładnie jak brak tokenu w `renderMarketingPage`:
 * cicha wartość zastępcza znaczyłaby angielskie „menu" na polskiej stronie,
 * i nikt by tego nie zobaczył, bo etykiety nie widać na ekranie.
 */
function etykietaMenu(copy: Record<string, unknown>): string {
  const nav = copy.nav as { menuLabel?: unknown } | undefined;
  if (typeof nav?.menuLabel !== "string") {
    throw new Error("Brak treści dla tokenu szablonu: nav.menuLabel");
  }
  return nav.menuLabel;
}

function etykietaPominTresc(copy: Record<string, unknown>): string {
  const nav = copy.nav as { skipToContent?: unknown } | undefined;
  if (typeof nav?.skipToContent !== "string") {
    throw new Error("Brak treści dla tokenu szablonu: nav.skipToContent");
  }
  return nav.skipToContent;
}

function podzielPowierzchnie(html: string) {
  const contentStart = html.indexOf("<section");
  const footerStart = html.lastIndexOf(FOOTER_MARKER);

  if (contentStart < 0 || footerStart <= contentStart) {
    throw new Error("Szablon marketingowy nie ma rozdzielnych obszarów nawigacji, treści i stopki");
  }

  return {
    navigation: html.slice(0, contentStart),
    content: html.slice(contentStart, footerStart),
    footer: html.slice(footerStart),
  };
}

/**
 * Dwie warstwy tekstu animowanego odnośnika są potrzebne wizualnie, ale bez
 * jawnej nazwy czytnik składa je w „Cennik Cennik”. Nazwę dokładamy do HTML-u
 * serwera, żeby poprawność nie zależała od hydratacji ani od biblioteki animacji.
 */
function nazwijMaskowaneOdnosnikiHtml(html: string): string {
  return html.replace(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/g,
    (anchor, attributes: string, body: string) => {
      if (!body.includes("button-text-mask") || /\saria-label=/.test(attributes)) return anchor;
      const label = body
        .match(/<div class="button-text(?: [^"]*)?">([^<]+)<\/div>/)?.[1]
        ?.trim();
      if (!label) return anchor;
      return `<a${attributes} aria-label="${label}">${body}</a>`;
    },
  );
}

function nazwijPrzyciskiMenuHtml(html: string, label: string): string {
  const encodedLabel = label
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
  return html.replace(
    /<div([^>]*class="[^"]*\bw-nav-button\b[^"]*"[^>]*)>/g,
    (_tag, attributes: string) =>
      `<div${attributes.replace(/\saria-label="[^"]*"/, "")} aria-label="${encodedLabel}">`,
  );
}

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
export async function MarketingPageView({
  copy,
  locale,
  page,
  alternateHref,
  island,
}: MarketingPageViewProps) {
  const links = marketingLinks(locale);
  const otherLocale: Locale = locale === "pl" ? "en" : "pl";
  const matchingAlternateHref =
    alternateHref ?? (page === "home" ? `/${otherLocale}` : `/${otherLocale}/${page}`);
  const html = nazwijPrzyciskiMenuHtml(
    nazwijMaskowaneOdnosnikiHtml(
      renderMarketingPage(
        page,
        {
          ...copy,
          ...links,
          link: { ...links.link, langAlternate: matchingAlternateHref },
        },
        { terms: await platformTermsPublished() },
      ),
    ),
    etykietaMenu(copy),
  );
  const { navigation, content, footer } = podzielPowierzchnie(html);
  const [beforeIsland, afterIsland] = content.split(ISLAND_MARKER);

  return (
    <>
      <LandingAnalytics locale={locale} />
      <MarketingRuntime wfPage={wfPageId(page)} wfSite={WF_SITE} />
      <MarketingNavA11y etykietaMenu={etykietaMenu(copy)} />
      <div className={island ? "marketing-static" : undefined}>
        <a className="marketing-skip-link" href="#main-content">
          {etykietaPominTresc(copy)}
        </a>
        <div dangerouslySetInnerHTML={{ __html: navigation }} />
        <main id="main-content">
          {island && afterIsland !== undefined ? (
            // ZNANE OGRANICZENIE (do domknięcia): na stronach z wyspą interakcje
            // odsłaniające nie startują — elementy eksportu zostają na inline
            // `opacity:0`. Do czasu naprawy klasa wymusza widoczność, żeby strona
            // niosła treść zamiast pustego tła. Landing biegnie bez tej klasy,
            // z pełnymi animacjami szablonu.
            //
            // PODZIAŁ TNIE HTML NA ZNACZNIKU WYSPY, więc znacznik MUSI stać między
            // rodzeństwem najwyższego poziomu — obie połówki jadą osobnym
            // `dangerouslySetInnerHTML`, a połówka urwana w środku drzewa zostaje
            // domknięta przez parser i wyrzuca wyspę poza kontener strony
            // (ADR-162; bramka: `marketing-island.test.ts`).
            <>
              <div dangerouslySetInnerHTML={{ __html: beforeIsland }} />
              {island}
              <div dangerouslySetInnerHTML={{ __html: afterIsland }} />
            </>
          ) : (
            <div dangerouslySetInnerHTML={{ __html: content }} />
          )}
        </main>
        <div dangerouslySetInnerHTML={{ __html: footer }} />
      </div>
    </>
  );
}
