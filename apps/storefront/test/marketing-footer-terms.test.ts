/**
 * POZYCJA „REGULAMIN" W STOPCE LP (0070, ADR-141).
 *
 * Regulamin platformy ma dziś w bazie wyłącznie SZKIC (effective_from IS NULL),
 * więc `app.get_platform_terms()` zwraca NULL, a `/[locale]/terms` odpowiada 404
 * — z konstrukcji, nie przez awarię. Sitemapa tę regułę znała
 * (`app/sitemap.xml/route.ts`), stopka NIE: renderowała link bezwarunkowo na
 * każdej stronie marketingowej i wysyłała gościa LP na 404.
 *
 * Bramka pilnuje OBU kierunków, bo każdy z osobna daje się przespać:
 *   - bez obowiązującej wersji odesłania do `/terms` NIE MA (ani adresu, ani
 *     etykiety),
 *   - z obowiązującą wersją JEST — inaczej „naprawa" polegałaby na skasowaniu
 *     linku na zawsze i nikt by tego nie zauważył do dnia startu komercyjnego.
 *
 * ASERCJA NEGATYWNA WYMAGA KOTWICY. „HTML nie zawiera /terms" przechodzi też
 * wtedy, gdy stopka w ogóle się nie wyrenderowała — dlatego każdy taki test
 * najpierw dowodzi, że stopka JEST (kolumna „Firma" + sąsiednia pozycja
 * „Polityka prywatności", widoczna zawsze), a dopiero potem, że regulaminu
 * w niej nie ma.
 */
import { renderToStaticMarkup } from "react-dom/server";
import * as cheerio from "cheerio";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MarketingPageView } from "@/components/marketing/marketing-page-view";
import { getPlatformTerms, type PlatformTermsDocument } from "@/lib/legal/platform-terms";
import { marketingLinks, PUBLIC_PAGES, renderMarketingPage } from "@/lib/marketing/template";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

vi.mock("@/lib/legal/platform-terms", () => ({ getPlatformTerms: vi.fn() }));

const OBOWIAZUJACY: PlatformTermsDocument = {
  version_id: "11111111-1111-4111-8111-111111111111",
  version_no: 1,
  version_label: "v1",
  title_pl: "Regulamin świadczenia usługi Avably",
  body_pl: "Treść PL.",
  title_en: "Avably Terms of Service",
  body_en: "Body EN.",
  sha256_pl: "0123456789abcdef".repeat(4),
  sha256_en: "fedcba9876543210".repeat(4),
  published_at: "2026-08-11T10:00:00.000Z",
  effective_from: "2026-08-12T00:00:00.000Z",
};

const LOCALE = [
  ["pl", pl, "Polityka prywatności", "Regulamin"],
  ["en", en, "Privacy Policy", "Terms of Service"],
] as const;

function renderujSzablon(page: (typeof PUBLIC_PAGES)[number], locale: "pl" | "en", terms: boolean) {
  const messages = locale === "pl" ? pl : en;
  return renderMarketingPage(
    page,
    { ...messages.marketing, ...marketingLinks(locale) },
    { terms },
  );
}

describe("stopka marketingowa a regulamin platformy — poziom szablonu", () => {
  it("bez obowiązującej wersji żadna strona publiczna nie linkuje /terms", () => {
    for (const page of PUBLIC_PAGES) {
      for (const [locale, , etykietaPrywatnosci, etykietaRegulaminu] of LOCALE) {
        const html = renderujSzablon(page, locale, false);

        // KOTWICA: stopka jest na stronie (kolumna firmowa + pozycja obok).
        expect(html, `${page}/${locale}: zniknęła kolumna firmowa stopki`).toContain(
          `<a href="/${locale}/privacy" class="footer-link">${etykietaPrywatnosci}</a>`,
        );

        expect(html, `${page}/${locale}: stopka wciąż linkuje /terms`).not.toContain(
          `/${locale}/terms`,
        );
        expect(html, `${page}/${locale}: została etykieta regulaminu`).not.toContain(
          `class="footer-link">${etykietaRegulaminu}</a>`,
        );
      }
    }
  });

  it("z obowiązującą wersją pozycja wraca na każdą stronę publiczną", () => {
    for (const page of PUBLIC_PAGES) {
      for (const [locale, , , etykietaRegulaminu] of LOCALE) {
        expect(
          renderujSzablon(page, locale, true),
          `${page}/${locale}: brak pozycji regulaminu mimo obowiązującej wersji`,
        ).toContain(`<a href="/${locale}/terms" class="footer-link">${etykietaRegulaminu}</a>`);
      }
    }
  });
});

describe("stopka marketingowa a regulamin platformy — okablowanie widoku", () => {
  beforeEach(() => {
    vi.mocked(getPlatformTerms).mockReset();
  });

  async function renderujWidok(): Promise<string> {
    return renderToStaticMarkup(
      await MarketingPageView({ copy: pl.marketing, locale: "pl", page: "home" }),
    );
  }

  it("get_platform_terms → null: stopka jest, pozycji regulaminu w niej nie ma", async () => {
    vi.mocked(getPlatformTerms).mockResolvedValue(null);

    const html = await renderujWidok();

    expect(html, "stopka w ogóle się nie wyrenderowała — asercja negatywna byłaby pusta").toContain(
      `<a href="/pl/privacy" class="footer-link">${pl.marketing.footer.privacy}</a>`,
    );
    expect(html).toContain(pl.marketing.footer.columnCompany);
    expect(html, "widok linkuje /terms mimo braku obowiązującej wersji").not.toContain("/pl/terms");
    expect(html).not.toContain(`class="footer-link">${pl.marketing.footer.terms}</a>`);
  });

  it("get_platform_terms → wersja obowiązująca: pozycja regulaminu wraca", async () => {
    vi.mocked(getPlatformTerms).mockResolvedValue(OBOWIAZUJACY);

    expect(await renderujWidok()).toContain(
      `<a href="/pl/terms" class="footer-link">${pl.marketing.footer.terms}</a>`,
    );
  });

  it("odczyt regulaminu rzucający wyjątkiem zabiera link, nie stronę wejściową", async () => {
    vi.mocked(getPlatformTerms).mockRejectedValue(new Error("brak konfiguracji bazy"));

    const html = await renderujWidok();

    expect(html).toContain(pl.marketing.footer.columnCompany);
    expect(html).not.toContain("/pl/terms");
  });

  it("wydziela główną treść i zachowuje podstronę przy zmianie języka", async () => {
    vi.mocked(getPlatformTerms).mockResolvedValue(null);

    const html = renderToStaticMarkup(
      await MarketingPageView({ copy: pl.marketing, locale: "pl", page: "pricing" }),
    );
    const $ = cheerio.load(html);

    expect($("main#main-content")).toHaveLength(1);
    expect($("main#main-content .navigation-master")).toHaveLength(0);
    expect($("main#main-content .footer-component")).toHaveLength(0);
    expect($("a[href='#main-content']").text()).toBe("Przejdź do treści");
    expect($(".w-nav-button").first().attr("aria-label")).toBe("Nawigacja");

    const maskowane = $("a:has(.button-text-mask)");
    expect(maskowane.length).toBeGreaterThan(0);
    maskowane.each((_, element) => {
      const link = $(element);
      expect(link.attr("aria-label")).toBe(link.find(".button-text").first().text().trim());
    });

    const linkiJezykowe = $("a[hreflang='en']")
      .map((_, element) => $(element).attr("href"))
      .get();
    expect(linkiJezykowe.length).toBeGreaterThan(0);
    expect(new Set(linkiJezykowe)).toEqual(new Set(["/en/pricing"]));
  });

  it("pozwala zachować numer archiwalnej wersji regulaminu przy zmianie języka", async () => {
    vi.mocked(getPlatformTerms).mockResolvedValue(OBOWIAZUJACY);

    const html = renderToStaticMarkup(
      await MarketingPageView({
        alternateHref: "/en/terms/w/7",
        copy: pl.marketing,
        locale: "pl",
        page: "terms",
      }),
    );
    const $ = cheerio.load(html);
    const linkiJezykowe = $("a[hreflang='en']")
      .map((_, element) => $(element).attr("href"))
      .get();

    expect(new Set(linkiJezykowe)).toEqual(new Set(["/en/terms/w/7"]));
  });
});
