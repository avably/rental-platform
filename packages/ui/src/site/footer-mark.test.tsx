/**
 * ZNAK FIRMY W STOPCE NA PŁÓTNIE (ADR-167) — TEST NA KSZTAŁCIE, KTÓRY ISTNIEJE.
 *
 * ==================== DLACZEGO TEN PLIK W OGÓLE POWSTAJE ====================
 *
 * ADR-160 przyszedł z kompletem testów przełącznika `inFooter` i wszystkie były
 * zielone — bo wszystkie budowały stopkę z `presetContentFor("footer")`, czyli
 * z treści v1. Kreator takiej stopki NIE PRODUKUJE: każda dodawana sekcja
 * przechodzi przez `sectionCanvasFrom` i ląduje w bazie jako płótno v2. Zielona
 * suita pilnowała więc kształtu, którego nie ma ani jeden najemca, a jedyny
 * kształt, który istnieje, nie miał ani jednej asercji.
 *
 * Stopka w KAŻDYM teście w tym pliku powstaje więc TĄ SAMĄ drogą, co w panelu:
 * preset → `sectionCanvasFrom`. Zdjęcie konwersji zamieniłoby ten plik z
 * powrotem w test v1, więc kształt wejścia jest tu sprawdzany z imienia.
 */
import {
  isSectionCanvas,
  presetContentFor,
  sectionCanvasFrom,
  type CanvasElement,
  type SectionCanvas,
} from "@avably/core/site";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection, SiteLogoRender } from "./types";

const BUCKET = "https://przyklad.supabase.co/storage/v1/object/public/site-images";

const ZNAK: SiteLogoRender = {
  src: `${BUCKET}/t/logo/u.png`,
  alt: "Znak firmy",
};

/** Stopka DOKŁADNIE taka, jaką zapisuje kreator: preset przepuszczony przez konwersję. */
function stopkaNaPlotnie(): SectionCanvas {
  const canvas = sectionCanvasFrom("footer", presetContentFor("footer", "pl"));
  // Kontrola wejścia: gdyby konwersja przestała oddawać płótno, cały plik
  // testowałby znowu kształt v1 — i byłby zielony, nie broniąc niczego.
  expect(isSectionCanvas(canvas)).toBe(true);
  expect(canvas.elements.some((element) => element.kind === "image")).toBe(false);
  return canvas;
}

/** Ta sama stopka z WŁASNYM obrazem operatora — element dołożony, nic nie zdjęte. */
function stopkaZObrazem(): SectionCanvas {
  const canvas = stopkaNaPlotnie();
  const wlasny: CanvasElement = {
    id: "footer-image-1",
    kind: "image",
    source: { kind: "storage", path: "t/s/wlasny.png" },
    alt: "Znak wstawiony ręcznie",
    fit: "contain",
    layout: { desktop: { x: 100, y: 12, w: 30, h: 8, z: 1 } },
  } as CanvasElement;
  return { ...canvas, elements: [...canvas.elements, wlasny] };
}

function sekcja(content: SectionCanvas): RenderSection {
  return { id: "s-footer", position: 0, type: "footer", content } as RenderSection;
}

/** Adresy WSZYSTKICH obrazów w stopce — liczymy znaki, a nie ich obecność. */
function obrazyStopki(container: HTMLElement): string[] {
  const footer = container.querySelector("footer");
  expect(footer).not.toBeNull();
  return [...footer!.querySelectorAll("img")].map((img) => img.getAttribute("src") ?? "");
}

describe("ADR-167 — przełącznik znaku działa na stopce, którą najemca ma", () => {
  it("ZNAK WŁĄCZONY: stopka na płótnie dostaje znak (dokładnie jeden)", () => {
    const { container } = render(
      <SiteRenderer sections={[sekcja(stopkaNaPlotnie())]} footerLogo={ZNAK} />,
    );
    expect(obrazyStopki(container)).toEqual([ZNAK.src]);
  });

  it("ZNAK WYŁĄCZONY: ta sama stopka bez znaku nie ma ANI JEDNEGO obrazu", () => {
    // Druga noga dowodu. Bez niej przechodziłby też render, który rysuje znak
    // ZAWSZE — a to jest wada bliźniaczo podobna do naprawianej, tylko w drugą
    // stronę: przełącznik, którego nie da się zgasić.
    const { container } = render(
      <SiteRenderer sections={[sekcja(stopkaNaPlotnie())]} footerLogo={null} />,
    );
    expect(obrazyStopki(container)).toEqual([]);
  });

  it("znak stoi WEWNĄTRZ landmarku stopki, a nie obok niego", () => {
    // `contentinfo` jest jedynym miejscem, w którym czytnik ekranu szuka danych
    // firmy. Znak doklejony za `</footer>` byłby w dokumencie i poza rolą.
    const { container } = render(
      <SiteRenderer sections={[sekcja(stopkaNaPlotnie())]} footerLogo={ZNAK} />,
    );
    const mark = container.querySelector("[data-footer-mark] img");
    expect(mark).not.toBeNull();
    expect(mark!.closest("footer")).not.toBeNull();
    expect(mark).toHaveAttribute("alt", ZNAK.alt);
  });

  it("STOPKA Z WŁASNYM OBRAZEM: znak NIE wchodzi — obraz zostaje jeden, operatora", () => {
    // `siteImageBase` jest tu WARUNKIEM DOWODU, a nie ozdobą: bez adresu bucketa
    // element obrazu rysuje kafel zastępczy i „jeden obraz zamiast dwóch"
    // wychodziłoby z braku obrazu w ogóle.
    const { container } = render(
      <SiteRenderer
        sections={[sekcja(stopkaZObrazem())]}
        footerLogo={ZNAK}
        siteImageBase={BUCKET}
      />,
    );
    const obrazy = obrazyStopki(container);
    expect(obrazy).toHaveLength(1);
    expect(obrazy[0]).toContain("wlasny.png");
    expect(container.querySelector("[data-footer-mark]")).toBeNull();
  });

  it("ZNAK NIE WCHODZI DO SEKCJI, KTÓRA NIE JEST STOPKĄ", () => {
    // `footerLogo` jedzie przez renderer do KAŻDEJ sekcji listy. Gdyby pas znaku
    // zależał od samego płótna, a nie od typu sekcji, hero z tej samej strony
    // dostałoby drugi znak — i to bez żadnego przełącznika.
    const hero = {
      id: "s-hero",
      position: 0,
      type: "hero",
      content: sectionCanvasFrom("hero", presetContentFor("hero", "pl")),
    } as RenderSection;
    const { container } = render(<SiteRenderer sections={[hero]} footerLogo={ZNAK} />);
    expect(container.querySelector("[data-footer-mark]")).toBeNull();
  });
});
