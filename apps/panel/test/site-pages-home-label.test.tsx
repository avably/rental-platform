// @vitest-environment jsdom

/**
 * STRONA GŁÓWNA JEST PODPISANA NA LIŚCIE STRON (ADR-161).
 *
 * Po fazie 2 lista pokazuje pod każdym wierszem sam ADRES. Dla „Kontaktu"
 * i „O nas" adres mówi wszystko, ale strona główna ma adres `/` — czyli jedyny
 * wiersz, którego podpis nie niesie ANI JEDNEJ informacji o tym, czym ta strona
 * jest. Dotyczy to pierwszego ekranu, na którym najemca się orientuje.
 *
 * Test trzyma trzy zdania, które psują się osobno:
 *   1. wiersz o pustym adresie MA podpis „Strona główna";
 *   2. wiersz o adresie niepustym go NIE MA (inaczej podpis byłby dekoracją
 *      przyklejoną do każdego wiersza i niczego by nie rozróżniał);
 *   3. adres `/` DALEJ jest widoczny — podpis stoi OBOK niego, a nie zamiast:
 *      operator pyta o adres strony głównej przy przekierowaniach i sitemapie.
 *
 * Obie wersje językowe: podpis bez tłumaczenia byłby polskim napisem na
 * angielskim ekranie, a kontrakt i18n takich braków nie łapie dla wartości,
 * które istnieją w obu plikach z tą samą treścią.
 */
import { cleanup, render, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

vi.mock("@/lib/actions/site", () => ({
  createSite: vi.fn(),
  deleteSite: vi.fn(),
  publishSite: vi.fn(),
  unpublishSite: vi.fn(),
  renameSite: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");

type Row = Parameters<typeof SitePages>[0]["rows"][number];

const HOME: Row = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Strona sklepu",
  live: true,
  slug: "",
  slugPublished: "",
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: "12.08.2026",
  createdAtLabel: "10.08.2026",
};

const KONTAKT: Row = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Kontakt",
  live: false,
  slug: "kontakt",
  slugPublished: null,
  redirectOldSlug: true,
  redirectedFrom: [],
  publishedAtLabel: null,
  createdAtLabel: "11.08.2026",
};

function renderList(locale: "pl" | "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <SitePages rows={[HOME, KONTAKT]} />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("lista stron podpisuje stronę główną (ADR-161)", () => {
  for (const [locale, badge] of [
    ["pl", plMessages.site.pages.homeBadge],
    ["en", enMessages.site.pages.homeBadge],
  ] as const) {
    it(`${locale}: wiersz o pustym adresie dostaje podpis, wiersz z adresem nie`, () => {
      const { container } = renderList(locale);

      const home = container.querySelector<HTMLElement>(`[data-site-page="${HOME.id}"]`)!;
      const kontakt = container.querySelector<HTMLElement>(`[data-site-page="${KONTAKT.id}"]`)!;

      expect(within(home).getByText(badge)).toBeTruthy();
      expect(
        within(kontakt).queryByText(badge),
        "podpis strony głównej stoi przy stronie, która nią nie jest",
      ).toBeNull();

      // Adres nie znika: podpis stoi OBOK, a nie zamiast.
      expect(home.textContent, "adres strony głównej zniknął razem z podpisem").toContain("/");
      expect(kontakt.textContent).toContain("/kontakt");
    });
  }

  it("podpis jest w obu językach INNYM napisem — inaczej jedna wersja jest kopią", () => {
    // Kontrola pozytywna dla pętli wyżej: gdyby ktoś dopisał klucz tylko do
    // jednego pliku i skopiował wartość do drugiego, oba przebiegi przeszłyby
    // po tym samym napisie i nie mierzyłyby tłumaczenia.
    expect(plMessages.site.pages.homeBadge).not.toBe(enMessages.site.pages.homeBadge);
  });
});
