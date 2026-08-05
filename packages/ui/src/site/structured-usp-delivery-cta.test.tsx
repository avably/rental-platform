// @vitest-environment jsdom

/**
 * ATUTY, DOSTAWA I WEZWANIE — RENDER (E7, aneks ADR-094).
 *
 * Trzy typy w jednym pliku, bo każdy wnosi DOKŁADNIE JEDNO zdanie, którego nie
 * widzi rdzeń:
 *
 *   1. ATUTY — kafel jest JEDNYM wpisem: znak, tytuł i zdanie stoją razem
 *      i w tej samej liczbie. Rozjazd (znak bez opisu) był zwykłym stanem
 *      płótna i to on jest powodem istnienia tego typu;
 *   2. DOSTAWA — cena OPCJONALNA. Wariant bez kwoty nie ma pokazywać ani zera,
 *      ani kreski: „Odbiór osobisty" bez ceny jest kompletną informacją;
 *   3. WEZWANIE — WARIANT POWIERZCHNI rozstrzyga o kolorach. To jest pinezka
 *      „złe kolory w każdym szablonie" zamknięta u źródła, więc mierzymy, że
 *      trzy warianty dają TRZY RÓŻNE zestawy klas ról — a nie jeden, powtórzony.
 *
 * Wszędzie fikstury RÓŻNICUJĄCE: wpisy mają rozróżnialne treści, więc „są trzy"
 * znaczy „są TE trzy", a nie „coś się narysowało".
 */
import {
  CTA_VARIANTS,
  structuredPresetFor,
  type CtaStructuredContent,
  type DeliveryStructuredContent,
  type UspStructuredContent,
} from "@avably/core/site";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_SITE_LABELS, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

afterEach(cleanup);

function narysuj(content: unknown, money?: { currency: "PLN" | "EUR"; locale: string }) {
  const section = { id: "sekcja", position: 0, type: (content as { type: string }).type, content } as
    unknown as RenderSection;
  return render(
    <SiteRenderer sections={[section]} labels={DEFAULT_SITE_LABELS} {...(money ? { money } : {})} />,
  );
}

// -----------------------------------------------------------------------
// ATUTY
// -----------------------------------------------------------------------

function atuty(count: number, layout: "cards" | "plain" = "cards"): UspStructuredContent {
  return {
    ...(structuredPresetFor("usp", "pl") as UspStructuredContent),
    layout,
    items: Array.from({ length: count }, (_, index) => ({
      icon: (["truck", "clock", "wrench", "headphones"] as const)[index % 4]!,
      title: `Atut ${index + 1}`,
      text: `Zdanie atutu ${index + 1}.`,
    })),
  } as UspStructuredContent;
}

describe("atuty: kafel jest JEDNYM wpisem", () => {
  it.each([1, 3, 4, 7])("%i atutów → tyle samo znaków, tytułów i zdań", (ile) => {
    const { container } = narysuj(atuty(ile));
    expect(container.querySelectorAll("[data-usp-icon]")).toHaveLength(ile);
    expect(container.querySelectorAll("[data-usp-title]")).toHaveLength(ile);
    expect(container.querySelectorAll("[data-usp-text]")).toHaveLength(ile);
    // Zdanie o rozjeździe: znak, tytuł i zdanie należą do TEGO SAMEGO kafla.
    for (let index = 0; index < ile; index += 1) {
      const kafel = container.querySelector(`[data-usp-item="${index}"]`)!;
      expect(within(kafel as HTMLElement).getByText(`Atut ${index + 1}`)).toBeTruthy();
      expect(within(kafel as HTMLElement).getByText(`Zdanie atutu ${index + 1}.`)).toBeTruthy();
      expect(kafel.querySelector("[data-usp-icon]")).toBeTruthy();
    }
  });

  it.each([
    [1, 1],
    [3, 3],
    [4, 2],
    [7, 3],
  ])("%i atutów układa się w %i kolumn — bez dziury w ostatnim rzędzie", (ile, kolumny) => {
    /*
     * AUTO-UKŁAD E6: liczba kolumn wynika z LICZBY wpisów, a nie z kontrolki.
     * Cztery atuty stają w 2 + 2 (a nie 3 + 1), siedem w 3 + 3 + 1 z ostatnim
     * rzędem wypełnionym przez arkusz. Mierzymy liczbę, którą render oddaje
     * arkuszowi — bo to ona rozstrzyga o pustej komórce.
     */
    const { container } = narysuj(atuty(ile));
    const lista = container.querySelector("[data-usp-cards]") as HTMLElement;
    expect(lista.style.getPropertyValue("--site-auto-cols")).toBe(String(kolumny));
  });

  it("tytuł atutu jest NAGŁÓWKIEM, a nie napisem (spis treści czytnika ekranu)", () => {
    narysuj(atuty(2));
    expect(screen.getByRole("heading", { name: "Atut 1", level: 3 })).toBeTruthy();
  });

  it("oba układy rysują tę samą treść — różni je obudowa kafla", () => {
    const { container, unmount } = narysuj(atuty(3, "cards"));
    const zObudowa = container.querySelector('[data-usp-item="0"]')!.className;
    expect(zObudowa, "układ „karty” bez karty").toContain("site-card");
    unmount();

    const { container: drugi } = narysuj(atuty(3, "plain"));
    expect(
      drugi.querySelector('[data-usp-item="0"]')!.className,
      "układ „bez obudowy” rysuje kartę — czyli oba układy są tym samym",
    ).not.toContain("site-card");
    expect(drugi.querySelectorAll("[data-usp-icon]")).toHaveLength(3);
  });
});

// -----------------------------------------------------------------------
// DOSTAWA
// -----------------------------------------------------------------------

function dostawa(layout: "cards" | "list" = "cards"): DeliveryStructuredContent {
  return {
    ...(structuredPresetFor("delivery", "pl") as DeliveryStructuredContent),
    layout,
    intro: "Zdanie wprowadzające.",
    items: [
      { title: "Odbiór osobisty", text: "W magazynie." },
      { title: "Dowóz w mieście", text: "Pod adres.", price_grosze: 12_000 },
      { title: "Dowóz gratis", text: "Do 10 km.", price_grosze: 0 },
    ],
  } as DeliveryStructuredContent;
}

describe("dostawa: cena opcjonalna", () => {
  it.each(["cards", "list"] as const)("%s: karta bez ceny nie pokazuje ani zera, ani kreski", (layout) => {
    const { container } = narysuj(dostawa(layout));
    const ceny = [...container.querySelectorAll("[data-delivery-price]")].map(
      (node) => node.textContent ?? "",
    );
    expect(
      ceny,
      "wariant bez kwoty dostał cenę — „Odbiór osobisty” za 0,00 zł jest ofertą, której nikt nie złożył",
    ).toHaveLength(2);
    expect(ceny[0]).toContain("120,00");
    // ZERO to nie brak: „0,00 zł” przy dowozie do 10 km jest informacją handlową.
    expect(ceny[1]).toContain("0,00");
  });

  it("kwota idzie przez formatter WALUTY sklepu, a nie przez arytmetykę renderu", () => {
    const { container } = narysuj(dostawa(), { currency: "EUR", locale: "en" });
    const ceny = [...container.querySelectorAll("[data-delivery-price]")].map(
      (node) => node.textContent ?? "",
    );
    expect(ceny[0], "cena dostawy nie zna waluty sklepu").toContain("120.00");
    expect(ceny[0]).toMatch(/€|EUR/);
  });

  it("zdanie wprowadzające jest polem SEKCJI — jedno, nie po jednym na wariant", () => {
    const { container } = narysuj(dostawa());
    expect(container.querySelectorAll("[data-delivery-intro]")).toHaveLength(1);
    expect(screen.getByText("Zdanie wprowadzające.")).toBeTruthy();
  });

  it("tytuł wariantu jest NAGŁÓWKIEM (spis treści czytnika ekranu)", () => {
    narysuj(dostawa());
    expect(screen.getByRole("heading", { name: "Odbiór osobisty", level: 3 })).toBeTruthy();
  });
});

// -----------------------------------------------------------------------
// WEZWANIE
// -----------------------------------------------------------------------

function wezwanie(patch: Partial<CtaStructuredContent> = {}): CtaStructuredContent {
  return {
    ...(structuredPresetFor("cta", "pl") as CtaStructuredContent),
    heading: "Zarezerwuj termin",
    text: "Sprawdź dostępność online.",
    items: [{ label: "Zobacz katalog", href: "/store" }],
    ...patch,
  } as CtaStructuredContent;
}

/** Klasy ról, którymi wariant maluje panel, zdanie i przycisk pierwszorzędny. */
function klasyWariantu(container: HTMLElement): string {
  const panel = container.querySelector("[data-cta-panel]")!;
  const zdanie = container.querySelector("[data-cta-text]")!;
  const przycisk = container.querySelector('[data-cta-button="0"]')!;
  return [panel.className, zdanie.className, przycisk.className].join(" | ");
}

describe("wezwanie: wariant powierzchni rozstrzyga o kolorach", () => {
  it.each(["banner", "split"] as const)(
    "%s: trzy warianty dają TRZY RÓŻNE zestawy klas ról",
    (layout) => {
      /*
       * MUTACJA, KTÓRĄ TO PALI: render ignorujący `variant` i malujący zawsze
       * wariantem domyślnym. Wygląda poprawnie na każdym pojedynczym zrzucie
       * i jest dokładnie tą wadą, którą E7 miał zamknąć — bo przywraca „jeden
       * wygląd banera niezależnie od strony".
       */
      const zestawy = CTA_VARIANTS.map((variant) => {
        const { container, unmount } = narysuj(wezwanie({ layout, variant }));
        const klasy = klasyWariantu(container);
        unmount();
        return klasy;
      });
      expect(
        new Set(zestawy).size,
        `układ ${layout}: warianty powierzchni są nierozróżnialne — render ignoruje pole "variant"`,
      ).toBe(CTA_VARIANTS.length);
    },
  );

  it("wariant akcentowy NIE maluje zdania klasą atramentu pasa", () => {
    const { container } = narysuj(wezwanie({ variant: "accent" }));
    expect(
      container.querySelector("[data-cta-text]")!.className,
      "zdanie na wypełnieniu akcentu wzięło kolor policzony dla innego tła",
    ).not.toContain("site-text-muted");
    expect(container.querySelector("[data-cta-panel]")!.className).toContain("site-panel-accent");
    expect(container.querySelector('[data-cta-button="0"]')!.className).toContain(
      "site-cta-on-accent",
    );
  });

  it("wariant bez panelu nie rysuje żadnej obudowy", () => {
    const { container } = narysuj(wezwanie({ variant: "plain" }));
    const panel = container.querySelector("[data-cta-panel]")!.className;
    expect(panel).not.toContain("site-card");
    expect(panel).not.toContain("site-panel-accent");
  });

  it("drugi przycisk jest DRUGORZĘDNY i też zna wariant powierzchni", () => {
    const { container } = narysuj(
      wezwanie({
        variant: "accent",
        items: [
          { label: "Zobacz katalog", href: "/store" },
          { label: "Napisz do nas", href: "#kontakt" },
        ],
      }),
    );
    const drugi = container.querySelector('[data-cta-button="1"]')!.className;
    expect(drugi, "drugi przycisk krzyczy tak samo, jak pierwszy").not.toContain("site-cta-on-accent");
    expect(
      drugi,
      "drugi przycisk na akcencie wziął atrament pasa — kolor policzony dla innego tła",
    ).not.toContain("site-cta-secondary");
  });

  it("adres zewnętrzny dostaje `rel`, wewnętrzny nie", () => {
    narysuj(
      wezwanie({
        items: [
          { label: "Zobacz katalog", href: "/store" },
          { label: "Partner", href: "https://partner.przyklad.test" },
        ],
      }),
    );
    expect(screen.getByRole("link", { name: "Zobacz katalog" }).getAttribute("rel")).toBeNull();
    expect(screen.getByRole("link", { name: "Partner" }).getAttribute("rel")).toContain("noopener");
  });

  it("nagłówek wezwania stoi WEWNĄTRZ panelu — inaczej wypadłby poza wypełnienie", () => {
    const { container } = narysuj(wezwanie({ variant: "accent" }));
    const panel = container.querySelector("[data-cta-panel]")!;
    expect(
      panel.querySelector("[data-cta-heading]"),
      "nagłówek poza panelem akcentowym bierze kolor pasa, a nie kolor etykiety",
    ).toBeTruthy();
  });
});
