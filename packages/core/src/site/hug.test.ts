/**
 * KONTRAKT PUDEŁKA OBEJMUJĄCEGO TREŚĆ (K4, ADR-088; decyzja właściciela
 * 2026-08-03).
 *
 * Do K3 każdy element był prostokątem z geometrii, więc przycisk o etykiecie
 * „Zobacz katalog" zajmował pas na całą szerokość pasa treści, a ramka
 * zaznaczenia obejmowała głównie pustkę wokół napisu. Od K4 wymiar jest ALBO
 * jawny, ALBO wynika z treści — i to drugie jest stanem, w którym element się
 * RODZI.
 *
 * Ten plik pilnuje strony modelowej (fabryka, konwersja, szacunek rozmiaru);
 * stronę wizualną — że pudełko na stronie naprawdę obejmuje treść, a ramka
 * kreatora równa się temu pudełku — dowodzą kontrakty renderu i płótna
 * (`element-canvas.test.tsx`, `canvas-mobile.test.tsx`).
 */
import { describe, expect, it } from "vitest";

import { sectionCanvasFrom } from "./canvas-presets";
import { createElement, defaultSizeOf } from "./element-factory";
import {
  CANVAS_CONTENT_COLUMNS,
  HUG_KINDS,
  PALETTE_ELEMENT_KINDS,
  sizeOf,
  supportsHug,
  withSize,
  type CanvasElement,
} from "./elements";
import { SECTION_TYPES, presetContentFor, type SectionType } from "./index";
import { hugBox } from "./text-metrics";

const GEOMETRY = { x: 0, y: 0, w: 20, h: 8, z: 0 } as const;

describe("nowy element z palety rodzi się w trybie `hug`", () => {
  it("lista rodzajów palety nie jest pusta (kontrola po pustym zbiorze)", () => {
    // Liczby zeszły o jeden w ADR-094 (E1): martwy element `mapLink` wypadł
    // z palety i z rodzajów obejmujących treść.
    expect(PALETTE_ELEMENT_KINDS.length).toBe(6);
    expect(HUG_KINDS.length).toBe(4);
  });

  it.each(PALETTE_ELEMENT_KINDS)("%s: tryb wymiaru zgadza się ze wsparciem rodzaju", (kind) => {
    const size = sizeOf(createElement(kind, "nowy", { ...GEOMETRY }, "pl"));
    if (supportsHug(kind)) {
      expect(size, `${kind} rodzi się z wymiarem jawnym zamiast z treści`).toEqual({
        w: "hug",
        h: "hug",
      });
    } else {
      // Zdjęcie, kształt i katalog nie mają rozmiaru naturalnego — patrz
      // `HUG_KINDS`. Wpuszczenie ich w `hug` dałoby pudełko o zerowym boku.
      expect(size).toEqual({ w: "fixed", h: "fixed" });
    }
  });

  it("przycisk NIE zajmuje pasa na całą szerokość — to jest sedno decyzji", () => {
    const size = defaultSizeOf("button", "pl");
    // Pas treści ma 120 kolumn; przycisk startowy ma być wielokrotnie węższy.
    expect(size.w).toBeLessThan(CANVAS_CONTENT_COLUMNS / 2);
    expect(size.w).toBeGreaterThan(0);
  });

  it("ikona zostaje kwadratem, a nie banerem", () => {
    const size = defaultSizeOf("icon", "pl");
    expect(size.w).toBe(size.h);
    expect(size.w).toBeLessThan(CANVAS_CONTENT_COLUMNS / 4);
  });

  it("rozmiar startowy rodzaju z `hug` idzie z SZACUNKU TREŚCI, nie ze stałej", () => {
    // Kontrola pozytywna dla całego mechanizmu: gdyby fabryka podawała stałą,
    // dłuższa etykieta dałaby to samo pudełko.
    const krotki = hugBox(createElement("button", "a", { ...GEOMETRY }, "pl"))!;
    const dlugi = hugBox({
      ...createElement("button", "b", { ...GEOMETRY }, "pl"),
      label: "Zarezerwuj sprzęt budowlany na weekend",
    } as CanvasElement)!;
    expect(dlugi.w).toBeGreaterThan(krotki.w);
  });
});

describe("szacunek pudełka: deterministyczny i skończony", () => {
  const przyklady: CanvasElement[] = PALETTE_ELEMENT_KINDS.map((kind) =>
    createElement(kind, `el-${kind}`, { ...GEOMETRY }, "pl"),
  );

  it.each(przyklady.map((element) => [element.kind, element] as const))(
    "%s: dwa wywołania dają ten sam wynik",
    (_kind, element) => {
      expect(hugBox(element)).toEqual(hugBox(element));
    },
  );

  it.each(przyklady.map((element) => [element.kind, element] as const))(
    "%s: rodzaj bez rozmiaru naturalnego oddaje `null`, reszta — pudełko dodatnie",
    (kind, element) => {
      const box = hugBox(element);
      if (!supportsHug(kind)) {
        expect(box, `${kind} udaje, że ma rozmiar naturalny`).toBeNull();
        return;
      }
      expect(box).not.toBeNull();
      expect(box!.w).toBeGreaterThan(0);
      expect(box!.h).toBeGreaterThan(0);
    },
  );

  it("węższe płótno daje pudełko o WIĘKSZEJ liczbie jednostek", () => {
    // Jednostka siatki jest ułamkiem szerokości płótna, więc ten sam napis
    // zajmuje na telefonie więcej jednostek, choć mniej pikseli.
    const przycisk = createElement("button", "b", { ...GEOMETRY }, "pl");
    expect(hugBox(przycisk, 390)!.h).toBeGreaterThan(hugBox(przycisk, 1152)!.h);
  });
});

describe("konwersja dwunastu typów: przyciski i ikony obejmują treść", () => {
  it.each(SECTION_TYPES)("%s: żaden przycisk ani ikona nie jest pasem", (type) => {
    const canvas = sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl"));
    const male = canvas.elements.filter(
      (element) => element.kind === "button" || element.kind === "icon",
    );
    for (const element of male) {
      expect(sizeOf(element), `${type}/${element.id}: wymiar jawny zamiast z treści`).toEqual({
        w: "hug",
        h: "hug",
      });
      expect(
        element.layout.desktop.w,
        `${type}/${element.id}: pudełko szerokie jak pas treści`,
      ).toBeLessThan(CANVAS_CONTENT_COLUMNS);
    }
  });

  it("baner CTA nadal ma przycisk NA ŚRODKU, choć pudełko jest wąskie", () => {
    const canvas = sectionCanvasFrom("cta", presetContentFor("cta", "pl"));
    const banner = canvas.elements.find((element) => element.kind === "shape")!.layout.desktop;
    const button = canvas.elements.find((element) => element.kind === "button")!.layout.desktop;
    const srodekBaneru = banner.x + banner.w / 2;
    const srodekPrzycisku = button.x + button.w / 2;
    // Zaokrąglenie do jednostki siatki — pół kolumny to dopuszczalny błąd.
    expect(Math.abs(srodekBaneru - srodekPrzycisku)).toBeLessThanOrEqual(1);
  });
});

describe("przełączanie trybu wymiaru", () => {
  it("`withSize` nie rusza rodzajów bez wsparcia dla `hug`", () => {
    const obraz = createElement("image", "img", { ...GEOMETRY }, "pl");
    expect(sizeOf(withSize(obraz, { w: "hug", h: "hug" }))).toEqual({ w: "fixed", h: "fixed" });
  });

  it("tryb da się ustawić PER OŚ — akapit o jawnej szerokości i wysokości z treści", () => {
    const tekst = withSize(createElement("text", "t", { ...GEOMETRY }, "pl"), {
      w: "fixed",
      h: "hug",
    });
    expect(sizeOf(tekst)).toEqual({ w: "fixed", h: "hug" });
  });

  it("`withSize` nie mutuje wejścia", () => {
    const element = createElement("heading", "h", { ...GEOMETRY }, "pl");
    const before = JSON.stringify(element);
    withSize(element, { w: "fixed", h: "fixed" });
    expect(JSON.stringify(element)).toBe(before);
  });
});
