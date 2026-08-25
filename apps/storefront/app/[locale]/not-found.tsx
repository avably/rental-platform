import { type Locale } from "@avably/core";
import { getLocale, getMessages } from "next-intl/server";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import enMessages from "@/messages/en.json";

type AppMessages = typeof enMessages;

/**
 * 404 OSI MARKETINGOWEJ (L-UX-01, ADR-197) — cel `notFound()` spod ważnego
 * locale: nieznana podstrona (`/pl/xyz` przez [page]), głębsza ścieżka przez
 * catch-all `[...rest]`, permalink nieistniejącej wersji regulaminu. Do
 * ADR-197 lądowały we wbudowanym 404 Nexta — angielskim na polskiej trasie,
 * bez szablonu i bez wyjścia.
 *
 * Render TYM SAMYM wzorcem co strony przeniesione z szablonu (ADR-068):
 * `MarketingPageView` z szablonem `marketing/not-found.html` (nawigacja +
 * hero-legal z jedynym `h1` + stopka — markup wprost z privacy.html), treść
 * i CTA powrotu jako WYSPA (ADR-162; wyspa wymusza też `marketing-static`,
 * więc widoczność nie zależy od interakcji IX2 — wzorzec stron dokumentów).
 *
 * Locale — z TRASY (`getLocale`): layout `[locale]` zdążył je ustawić
 * (`setRequestLocale`), zanim boundary się renderuje; nieprawidłowe locale
 * w ogóle tu nie dociera (layout odrzuca je wyżej). Przełącznik języka
 * prowadzi na STRONĘ GŁÓWNĄ drugiego locale, nie na lustrzany 404 — celem
 * odwiedzającego jest treść w drugim języku, a nie ten sam brak.
 *
 * ==================== TYTUŁ DOKUMENTU (ADR-273) ====================
 *
 * Ten ekran nie miał `<title>` W OGÓLE — pomiar w przeglądarce na zbudowanej
 * aplikacji dał `document.title === ""` na `/pl/nie-ma`. Oś tenancka dostała
 * tytuł przy S-57, marketingowa została pominięta; karta przeglądarki,
 * historia i zakładka pokazują goły adres (WCAG 2.4.2 „Page Titled").
 *
 * Braku nie da się załatać metadanymi TRASY, i to z budowy, nie z przeoczenia:
 * `[page]/page.tsx` woła `notFound()` już w `generateMetadata` (przez
 * `resolvePage`), a catch-all `[...rest]` własnych metadanych nie ma wcale —
 * konwencja `not-found.tsx` też ich nie wystawia. Dlatego tytuł jedzie
 * ELEMENTEM `<title>` w drzewie: React wynosi go do `<head>`, a wyspa jest
 * prawdziwym węzłem Reacta (nie `dangerouslySetInnerHTML`), więc wyniesienie
 * naprawdę działa. Konkurenta nie ma — na tej ścieżce żadne inne `<title>`
 * nie powstaje.
 *
 * Szablon tytułu jest TEN SAM co na pozostałych stronach osi
 * (`[page]/page.tsx`: `„{tytuł} - Avably"`), żeby 404 nie wyglądał w karcie
 * przeglądarki jak strona z innego serwisu.
 */
export default async function MarketingNotFound() {
  const locale = (await getLocale()) as Locale;
  const messages = (await getMessages({ locale })) as AppMessages;
  const other: Locale = locale === "pl" ? "en" : "pl";
  const copy = messages.marketing;

  return (
    <MarketingPageView
      copy={copy}
      locale={locale}
      page="not-found"
      alternateHref={`/${other}`}
      island={
        <section className="section legal-body-section">
          <div className="w-layout-blockcontainer main-container w-container">
            <title>{`${copy.notFoundPage.title} - Avably`}</title>
            <div className="body-legal w-richtext" data-marketing-not-found>
              <p>{copy.notFoundPage.description}</p>
            </div>
            <a
              href={`/${locale}`}
              aria-label={copy.notFoundPage.cta}
              className="cta-main accent w-inline-block"
            >
              <div className="button-text-mask">
                <div className="button-text _1">{copy.notFoundPage.cta}</div>
                <div className="button-text _2">{copy.notFoundPage.cta}</div>
              </div>
              <div className="button-bg accent"></div>
            </a>
          </div>
        </section>
      }
    />
  );
}
