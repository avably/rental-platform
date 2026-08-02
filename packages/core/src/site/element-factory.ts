/**
 * NOWY ELEMENT Z PALETY (K3, ADR-086) — treść startowa i rozmiar domyślny.
 *
 * Element upuszczony na płótno musi być OD RAZU widoczny i sensowny: pusty
 * nagłówek to niewidzialne pudełko, którego operator nie znajdzie ani okiem,
 * ani kliknięciem. Każdy rodzaj rodzi się więc z przykładową treścią (jak
 * sekcje z presetów, ADR-082) i z rozmiarem dobranym do swojej skali — nagłówek
 * jest szeroki i wysoki, ikona kwadratowa, odstęp niski.
 *
 * Teksty startowe są DANYMI tenanta, nie kluczami i18n (ta sama zasada co
 * presety sekcji), więc mieszkają tu w dwóch językach z parytetem struktury.
 */
import {
  CANVAS_COLUMNS,
  type CanvasElement,
  type Geometry,
  type PaletteElementKind,
} from "./elements";
import { PRESET_LOCALES, type PresetLocale } from "./presets";

/** Rozmiar startowy pudełka w jednostkach siatki — dobrany do skali rodzaju. */
const DEFAULT_SIZE: Record<PaletteElementKind, { w: number; h: number }> = {
  heading: { w: 60, h: 10 },
  text: { w: 60, h: 9 },
  button: { w: 30, h: 7 },
  image: { w: 48, h: 36 },
  icon: { w: 6, h: 6 },
  shape: { w: 40, h: 12 },
  mapLink: { w: 48, h: 10 },
};

const COPY: Record<PresetLocale, Record<PaletteElementKind, string>> = {
  pl: {
    heading: "Nowy nagłówek",
    text: "Kliknij, żeby napisać własny tekst.",
    button: "Przycisk",
    image: "Zdjęcie",
    icon: "Ikona",
    shape: "Kształt",
    mapLink: "ul. Przykładowa 1, 00-001 Warszawa",
  },
  en: {
    heading: "New heading",
    text: "Click to write your own text.",
    button: "Button",
    image: "Photo",
    icon: "Icon",
    shape: "Shape",
    mapLink: "1 Example St, 00-001 Warsaw",
  },
};

function copyFor(locale: string): Record<PaletteElementKind, string> {
  return (PRESET_LOCALES as readonly string[]).includes(locale)
    ? COPY[locale as PresetLocale]
    : COPY.pl;
}

/** Rozmiar startowy rodzaju — potrzebny płótnu, żeby policzyć miejsce upuszczenia. */
export function defaultSizeOf(kind: PaletteElementKind): { w: number; h: number } {
  return DEFAULT_SIZE[kind];
}

/**
 * Nowy element danego rodzaju, gotowy do wstawienia na płótno. Geometrię podaje
 * wołający (zna miejsce upuszczenia i wynik przyciągania), identyfikator też —
 * bo to on odpowiada za jego unikalność w sekcji.
 */
export function createElement(
  kind: PaletteElementKind,
  id: string,
  geometry: Geometry,
  locale = "pl",
): CanvasElement {
  const text = copyFor(locale)[kind];
  const layout = { desktop: geometry };

  switch (kind) {
    case "heading":
      return { id, layout, kind: "heading", text, level: 2, align: "left" };
    case "text":
      return { id, layout, kind: "text", text, variant: "body", align: "left" };
    case "button":
      // Kotwica, a nie adres zewnętrzny: przycisk ma prowadzić w obrębie
      // strony, dopóki operator nie wskaże celu.
      return { id, layout, kind: "button", label: text, href: "#", variant: "solid", align: "left" };
    case "image":
      // BEZ źródła — element jest kafelkiem zastępczym do chwili wyboru
      // zdjęcia w pickerze. `alt` wymagany od początku (dostępność).
      return { id, layout, kind: "image", alt: text, fit: "cover" };
    case "icon":
      return { id, layout, kind: "icon", name: "sparkles", tone: "accent" };
    case "shape":
      return { id, layout, kind: "shape", shape: "box", fill: "paper" };
    case "mapLink":
      return {
        id,
        layout,
        kind: "mapLink",
        address: text,
        url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text)}`,
        align: "left",
      };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/**
 * Miejsce dla nowego elementu, gdy operator KLIKNĄŁ kafel zamiast go
 * przeciągnąć. Szukamy pierwszego wolnego pasa POD wszystkim, co już leży na
 * płótnie — kładzenie w lewym górnym rogu przykrywałoby istniejącą treść, a
 * operator musiałby odsuwać nowy element, zanim cokolwiek z nim zrobi.
 */
export function freeSpotFor(
  kind: PaletteElementKind,
  elements: readonly CanvasElement[],
  rows: number,
): Geometry {
  const size = defaultSizeOf(kind);
  const bottom = elements.reduce(
    (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
    0,
  );
  const x = Math.max(0, Math.min(12, CANVAS_COLUMNS - size.w));
  const y = Math.max(0, Math.min(bottom + 2, Math.max(0, rows - size.h)));
  const z = elements.length;
  return { x, y, w: size.w, h: size.h, z };
}
