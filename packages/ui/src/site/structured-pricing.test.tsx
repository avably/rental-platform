/**
 * CENNIK STRUKTURALNY — KONTRAKT RENDERU (E6, aneks ADR-094).
 *
 * Cztery rzeczy, których nie widać w typach, a każda kosztuje pieniądze:
 *
 *   1. KWOTĘ SKŁADA FORMATTER PROJEKTU. „120,00 zł” to nie jest `grosze / 100`
 *      z kropką — separator dziesiętny, odstęp tysięcy i pozycja symbolu są
 *      własnością LOCALE, a nie naszej arytmetyki. Własne dzielenie wygląda
 *      w kodzie niewinnie i pokazuje angielskiemu klientowi „1299.5 zł”.
 *   2. PRZEDROSTEK „OD” JEST DECYZJĄ NAJEMCY. Cena wyjściowa pokazana jako
 *      dokładna jest ofertą, której nikt nie złożył — i odwrotnie.
 *   3. JEDNOSTKA IDZIE Z JĘZYKA STRONY, nie z treści. Najemca wybiera ją ze
 *      słownika, więc sklep po angielsku nie ma prawa pokazać „doba”.
 *   4. AUTO-UKŁAD NIE ZOSTAWIA DZIUR ANI NIE TNIE. Sprawdzane na CZTERECH
 *      licznościach (1, 3, 4, 7), bo fikstura jednej liczności nie odróżnia
 *      układu, który się dostosowuje, od takiego, który akurat pasuje —
 *      lekcja z E3.
 */
import {
  PRICING_CATALOG_HREF,
  PRICING_UNITS,
  structuredPresetFor,
  withStructuredLayout,
  type PricingStructuredContent,
  type PricingStructuredItem,
} from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, DEFAULT_SITE_MONEY, SiteRenderer } from "./site-renderer";
import type { RenderSection, SiteMoney } from "./types";

afterEach(cleanup);

const L = DEFAULT_SITE_LABELS;

/** Etykiety sklepu ANGIELSKIEGO — druga oś dowodu „jednostka z języka strony”. */
const L_EN = {
  ...L,
  pricingFrom: "from",
  pricingUnits: { hour: "hour", day: "day", week: "week", month: "month", piece: "piece" },
  pricingCatalog: "See the full catalog",
} as typeof L;

const EURO: SiteMoney = { currency: "EUR", locale: "en" };

function cennik(patch: Partial<PricingStructuredContent> = {}): PricingStructuredContent {
  const preset = structuredPresetFor("pricing", "pl") as PricingStructuredContent;
  return { ...preset, ...patch } as PricingStructuredContent;
}

function pokaz(
  content: PricingStructuredContent,
  money: SiteMoney = DEFAULT_SITE_MONEY,
  labels = L,
) {
  const sections = [{ id: "c1", position: 0, type: "pricing", content }] as unknown as RenderSection[];
  return render(<SiteRenderer sections={sections} labels={labels} money={money} />);
}

/** Pozycje o zadanej LICZNOŚCI — nazwy różne, żeby dało się je rozróżnić. */
function pozycje(ile: number): PricingStructuredItem[] {
  return Array.from({ length: ile }, (_, index) => ({
    name: `Pozycja numer ${index + 1}`,
    price_grosze: (index + 1) * 1_000,
    unit: "day" as const,
    mode: "exact" as const,
  }));
}

describe("KWOTA idzie przez formatter projektu, nie przez dzielenie przez sto", () => {
  it("PLN/pl: zapis polski — przecinek dziesiętny i symbol po kwocie", () => {
    pokaz(cennik({ items: [{ name: "Namiot", price_grosze: 129_950, unit: "day", mode: "exact" }] }));
    const cena = screen.getByText(/129/);

    /*
     * Sedno: mutacja „price_grosze / 100 + ' zł'” dałaby tu „1299.5 zł”.
     * Sprawdzamy więc CZĘŚCI SKŁADOWE zapisu, a nie sam fakt, że coś się
     * wypisało: część dziesiętną z PRZECINKIEM i dwoma miejscami po nim.
     */
    expect(cena.textContent, "kwota bez przecinka dziesiętnego — to nie jest zapis `pl`").toMatch(
      /1[\s ]?299,50/,
    );
    expect(cena.textContent, "kwota zaokrąglona w dół — zgubione grosze").not.toContain("1299.5");
    expect(cena.textContent, "brak jednostki przy cenie").toContain(L.pricingUnits.day);
  });

  it("EUR/en: TA SAMA treść, inny zapis i inna waluta", () => {
    pokaz(
      cennik({ items: [{ name: "Marquee", price_grosze: 129_950, unit: "day", mode: "exact" }] }),
      EURO,
      L_EN,
    );
    const cena = screen.getByText(/1,299\.50/);

    // Kropka dziesiętna i przecinek tysięcy — dokładna odwrotność zapisu `pl`.
    // Gdyby render miał własną arytmetykę, OBA testy pokazywałyby to samo.
    expect(cena.textContent).toContain("1,299.50");
    expect(cena.textContent, "waluta wzięta ze stałej, a nie z warstwy danych").not.toContain("zł");
    expect(cena.textContent, "jednostka po polsku w sklepie angielskim").not.toContain("doba");
    expect(cena.textContent).toContain("day");
  });

  it("KAŻDA jednostka słownika ma nazwę z języka strony (pętla po REJESTRZE)", () => {
    expect(PRICING_UNITS.length, "pusty słownik jednostek — pętla niżej nic nie broni").toBeGreaterThan(0);
    for (const unit of PRICING_UNITS) {
      cleanup();
      pokaz(cennik({ items: [{ name: "Pozycja", price_grosze: 5_000, unit, mode: "exact" }] }));
      const komorka = document.querySelector("[data-pricing-price]")!;
      expect(
        komorka.textContent,
        `jednostka „${unit}” nie pokazała nazwy z etykiet — operator zobaczy klucz albo pustkę`,
      ).toContain(L.pricingUnits[unit]);
    }
  });
});

describe("PRZEDROSTEK „od” jest decyzją najemcy, nie ozdobą", () => {
  it("mode „from” dokłada przedrostek, „exact” go NIE dokłada", () => {
    pokaz(
      cennik({
        items: [
          { name: "Wyjściowa", price_grosze: 6_000, unit: "day", mode: "from" },
          { name: "Dokładna", price_grosze: 6_000, unit: "day", mode: "exact" },
        ],
      }),
    );
    const [wyjsciowa, dokladna] = Array.from(document.querySelectorAll("[data-pricing-price]"));

    expect(wyjsciowa!.textContent, "cena wyjściowa bez „od” — oferta, której nikt nie złożył").toContain(
      L.pricingFrom,
    );
    expect(
      dokladna!.textContent,
      "cena dokładna z „od” — oferta luźniejsza, niż najemca zamierzał",
    ).not.toContain(`${L.pricingFrom} `);
  });
});

describe("ODNOŚNIK DO KATALOGU — istnieje, prowadzi pod właściwy adres i da się go zdjąć", () => {
  it("włączony: odnośnik z NAZWĄ prowadzi do katalogu", () => {
    pokaz(cennik({ showCatalogLink: true }));
    const link = screen.getByRole("link", { name: L.pricingCatalog });
    // Patrz `structured-products.test.tsx`: adres ze stałej rdzenia (ADR-186),
    // a nie z literału, który przeżyłby przeniesienie katalogu na własną stronę.
    expect(link.getAttribute("href")).toBe(PRICING_CATALOG_HREF);
    expect(PRICING_CATALOG_HREF, "odnośnik znów prowadzi na stronę główną").not.toBe("/store");
  });

  it("wyłączony: odnośnika NIE MA (przełącznik nie jest ozdobą)", () => {
    pokaz(cennik({ showCatalogLink: false }));
    expect(screen.queryByRole("link", { name: L.pricingCatalog })).toBeNull();
  });
});

describe("AUTO-UKŁAD: żadna liczność nie zostawia dziury ani nie ucina wpisu", () => {
  const LICZNOSCI = [1, 3, 4, 7];

  it.each(LICZNOSCI)("karty przy %i wpisach: tyle kafli, ile pozycji", (ile) => {
    pokaz(withStructuredLayout(cennik({ items: pozycje(ile) }), "cards"));
    const kafle = document.querySelectorAll("[data-pricing-card]");
    expect(
      kafle.length,
      `${ile} pozycji dało ${kafle.length} kafli — układ dokłada puste albo ucina treść`,
    ).toBe(ile);
    // Treść KAŻDEJ pozycji jest na ekranie — „nie tnie” dotyczy też ostatniej.
    for (let index = 0; index < ile; index += 1) {
      expect(screen.getByText(`Pozycja numer ${index + 1}`)).toBeTruthy();
    }
  });

  it.each(LICZNOSCI)("tabela przy %i wpisach: tyle wierszy, ile pozycji", (ile) => {
    pokaz(withStructuredLayout(cennik({ items: pozycje(ile) }), "table"));
    expect(document.querySelectorAll("[data-pricing-row]").length).toBe(ile);
  });

  it.each(LICZNOSCI)(
    "przy %i wpisach rząd wypełniają WPISY — pas zawija i rośnie, a nie stoi w stałych torach",
    (ile) => {
      pokaz(withStructuredLayout(cennik({ items: pozycje(ile) }), "cards"));
      const lista = document.querySelector<HTMLElement>("[data-pricing-cards]")!;

      /*
       * MUTACJA, KTÓRĄ TO PALI: siatka o stałej liczbie torów
       * (`grid-cols-3`). Przy 4 i 7 wpisach ostatni rząd ma wtedy puste
       * komórki — czego jsdom nie zmierzy, bo nie liczy układu. Mierzymy więc
       * REGUŁĘ: pas zawijany, w którym wpisom wolno rosnąć, wypełnia każdy
       * rząd z konstrukcji, niezależnie od liczby wpisów.
       */
      expect(lista.className, "kontener nie jest pasem zawijanym").toContain("site-auto-grid");
      expect(
        lista.className,
        "wrócił stały tor siatki — ostatni rząd zostawi puste komórki",
      ).not.toMatch(/(^|\s)grid-cols-\d/);

      const kolumny = lista.style.getPropertyValue("--site-auto-cols");
      expect(kolumny, "liczba kolumn nie trafiła do arkusza").not.toBe("");
      expect(
        Number(kolumny),
        `${ile} wpisów w ${kolumny} kolumnach — więcej torów niż wpisów zostawia pustkę w JEDYNYM rzędzie`,
      ).toBeLessThanOrEqual(ile);
    },
  );

  it("cztery wpisy stają w RÓWNYCH dwóch rzędach, a nie w 3 + 1", () => {
    pokaz(withStructuredLayout(cennik({ items: pozycje(4) }), "cards"));
    const lista = document.querySelector<HTMLElement>("[data-pricing-cards]")!;
    expect(
      lista.style.getPropertyValue("--site-auto-cols"),
      "cztery pozycje w trzech kolumnach — ostatni rząd to jeden kafel i dwie trzecie pustki",
    ).toBe("2");
  });

  it("KAŻDY kafel ma te same klasy — zero wyjątków dla „ostatniego przy nieparzystej”", () => {
    pokaz(withStructuredLayout(cennik({ items: pozycje(7) }), "cards"));
    const klasy = new Set(
      Array.from(document.querySelectorAll("[data-pricing-card]")).map((kafel) => kafel.className),
    );
    expect(
      klasy.size,
      "kafle różnią się klasami — układ ma gałąź po numerze wpisu, czyli wróci przy innej liczbie",
    ).toBe(1);
  });
});

describe("TABELA jest tabelą danych, a nie siatką napisów", () => {
  it("nazwa pozycji jest NAGŁÓWKIEM WIERSZA (czytnik zapowie ją przy cenie)", () => {
    pokaz(withStructuredLayout(cennik({ items: pozycje(3) }), "table"));
    const wiersze = screen.getAllByRole("row");
    expect(wiersze.length).toBe(3);
    for (const wiersz of wiersze) {
      expect(
        within(wiersz).getByRole("rowheader"),
        "wiersz bez nagłówka — czytnik ekranu odczyta ciąg napisów bez znaczenia",
      ).toBeTruthy();
    }
  });
});

describe("PRZEŁĄCZNIK UKŁADU JEST BEZSTRATNY NA REALNEJ TREŚCI", () => {
  it("tabela → karty → tabela oddaje treść co do klucza", () => {
    const wejscie = cennik({
      items: [
        { name: "Namiot 5 × 10 m", price_grosze: 90_000, unit: "day", mode: "from", note: "Z montażem" },
        { name: "Krzesło", price_grosze: 800, unit: "piece", mode: "exact" },
      ],
      footnote: "Ceny netto.",
    });
    const tam = withStructuredLayout(wejscie, "cards");
    const zPowrotem = withStructuredLayout(tam, "table");
    expect(zPowrotem).toEqual(wejscie);
  });

  it("OBA układy pokazują tę samą treść — przełączenie nie gubi pozycji ani notek", () => {
    const tresc = cennik({ items: pozycje(5), footnote: "Ceny netto." });
    for (const layout of ["table", "cards"] as const) {
      cleanup();
      pokaz(withStructuredLayout(tresc, layout));
      for (let index = 0; index < 5; index += 1) {
        expect(
          screen.getByText(`Pozycja numer ${index + 1}`),
          `układ „${layout}” zgubił pozycję ${index + 1}`,
        ).toBeTruthy();
      }
      expect(screen.getByText("Ceny netto."), `układ „${layout}” zgubił przypis sekcji`).toBeTruthy();
    }
  });
});
