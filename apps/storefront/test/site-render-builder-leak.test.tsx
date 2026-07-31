/**
 * WARSTWA EDYCYJNA KREATORA NIE WYCIEKA DO PUBLICZNEGO RENDERU (K1, ADR-083).
 *
 * Kreator i sklep dzielą JEDEN renderer (`SiteRenderer`) — to jest decyzja
 * architektoniczna, nie oszczędność: dwa renderery znaczyłyby dwa źródła prawdy
 * o wyglądzie sekcji i płótno przestałoby być dowodem na to, co zobaczy klient.
 * Cena tej decyzji jest dokładnie jedna i mieszka w tym pliku: skoro renderer
 * jest wspólny, ktoś kiedyś może wnieść do niego obrys, pasek narzędzi albo
 * uchwyt przeciągania — i wystawić je anonimowemu odwiedzającemu.
 *
 * Kontrakt stoi po stronie SKLEPU, a nie panelu, bo to sklep jest stroną
 * poszkodowaną. Broni dwóch rzeczy naraz:
 *   1. WYNIKU — render wywołany tak, jak robi to storefront (bez `sectionWrapper`),
 *      nie zawiera ANI JEDNEGO znacznika warstwy edycyjnej;
 *   2. SPOSOBU — źródła sklepu nigdzie nie podają własnej owijki sekcji, więc
 *      nie ma czym tej warstwy wnieść nawet przypadkiem.
 *
 * Dowód mutacyjny (opis w raporcie): dołożenie owijki kreatora do renderu
 * sklepu — albo wpisanie paska narzędzi w DOMYŚLNĄ owijkę `SiteRenderer` —
 * zapala ten plik na czerwono.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SiteRenderer, type RenderSection } from "@avably/ui";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/** Znaczniki, którymi kreator opisuje SWOJĄ warstwę (patrz builder-canvas). */
const BUILDER_LAYER_MARKERS = [
  "data-canvas-section",
  "data-section-toolbar",
  "data-section-outline",
  "data-section-hidden",
  "data-insert-slot",
  "data-insert-at",
  "data-drag-handle",
  "data-add-section-tile",
  "data-builder",
] as const;

const sections: RenderSection[] = [
  {
    id: "s1",
    position: 0,
    type: "hero",
    content: { heading: "Sprzęt na już", subheading: "Rezerwacja online.", ctaText: "Katalog", ctaHref: "#produkty" },
  },
  { id: "s2", position: 1, type: "pricing", content: { heading: "Warunki cenowe", note: "Doba od 8:00." } },
  { id: "s3", position: 2, type: "faq", content: { heading: "Pytania", items: [{ q: "Jak rezerwować?", a: "Online." }] } },
] as RenderSection[];

/** Render DOKŁADNIE taki, jaki robi trasa sklepu: bez własnej owijki sekcji. */
const html = renderToStaticMarkup(<SiteRenderer sections={sections} template="classic" />);

describe("publiczny render strony sklepu nie niesie warstwy edycyjnej", () => {
  it("fixture naprawdę coś renderuje", () => {
    // Kontrola po pustym zbiorze: wszystkie asercje `not.toContain` niżej
    // przelatywałyby na pustym stringu i broniły niczego.
    expect(html.length).toBeGreaterThan(200);
    expect(html).toContain("Sprzęt na już");
    expect(html).toContain("Warunki cenowe");
  });

  it("w renderze nie ma ANI JEDNEGO znacznika warstwy kreatora", () => {
    for (const marker of BUILDER_LAYER_MARKERS) {
      expect(html, `warstwa kreatora w publicznym renderze: ${marker}`).not.toContain(marker);
    }
  });

  it("domyślna owijka to SAMA kotwica sekcji — nic poza nią", () => {
    // Kotwica zostaje (po niej podgląd i płótno znajdują sekcję w dokumencie),
    // ale jest jedyną rzeczą, którą renderer dokłada od siebie.
    expect([...html.matchAll(/data-section-id="/g)]).toHaveLength(sections.length);
    for (const section of sections) {
      expect(html).toContain(`data-section-id="${section.id}"`);
    }
  });

  it("źródła sklepu nie podają rendererowi własnej owijki sekcji", () => {
    const storePage = readFileSync(resolve(process.cwd(), "app/(tenant)/store/page.tsx"), "utf8");
    // Martwa kotwica → czerwone: plik musi naprawdę renderować stronę sklepu.
    expect(storePage).toContain("SiteRenderer");
    expect(storePage, "sklep podaje własną owijkę sekcji").not.toContain("sectionWrapper");
  });
});
