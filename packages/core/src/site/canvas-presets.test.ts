/**
 * KONTRAKT KONWERSJI: KAŻDY z dwunastu typów sekcji daje POPRAWNE płótno v2
 * (K2, ADR-084).
 *
 * Kontrakt porównuje typy ZE SOBĄ, a nie każdy osobno. Test „hero się
 * konwertuje" i jedenaście jego kopii przepuściłby typ, który konwertuje się do
 * PUSTEGO płótna albo gubi połowę treści — bo każdy z nich patrzyłby wyłącznie
 * na siebie. Tutaj pytamy o rzeczy WSPÓLNE: czy każdy typ ma elementy, czy
 * każdy niesie CAŁĄ treść źródłową, czy żaden nie wychodzi poza płótno i czy
 * konwersja jest powtarzalna.
 *
 * Zbiór typów bierzemy z `SECTION_TYPES` (lustro CHECK-a w bazie), więc nowy
 * typ sekcji dopisany bez konwersji zapali ten plik, zamiast po cichu
 * renderować się starym rendererem do końca świata.
 */
import { describe, expect, it } from "vitest";

import { sectionCanvasFrom, textRows } from "./canvas-presets";
import {
  CANVAS_COLUMNS,
  MAX_ELEMENTS_PER_SECTION,
  SECTION_MAX_ROWS,
  SECTION_MIN_ROWS,
  isSectionCanvas,
  sectionCanvasSchema,
  type CanvasElement,
} from "./elements";
import { PRESET_LOCALES, SECTION_TYPES, presetContentFor, type SectionType } from "./index";

/** Płótno z presetu danego typu w danym języku — wejście wszystkich testów niżej. */
function canvasFor(type: SectionType, locale = "pl") {
  return sectionCanvasFrom(type, presetContentFor(type, locale));
}

/**
 * WSZYSTKO, co elementy płótna niosą z treści źródłowej — teksty, etykiety,
 * adresy, opisy zdjęć, nazwy ikon. Zbiór jest szeroki celowo: gdyby liczyły się
 * tylko teksty, konwersja mogłaby po cichu zgubić adres przycisku albo ikonę
 * atutu i test nadal świeciłby na zielono.
 */
function payloadOf(elements: CanvasElement[]): string[] {
  return elements.flatMap((element) => {
    switch (element.kind) {
      case "heading":
      case "text":
        return [element.text];
      case "button":
        return [element.label, element.href];
      case "image":
        return element.imagePath ? [element.alt, element.imagePath] : [element.alt];
      case "icon":
        return [element.name];
      default:
        return [];
    }
  });
}

/** Wszystkie stringi z treści v1 — rekurencyjnie, bo sekcje mają tablice bloków. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringsIn);
  return [];
}

describe("konwersja: kontrakt wspólny dla wszystkich dwunastu typów", () => {
  it("lista typów nie jest pusta (kontrola po pustym zbiorze)", () => {
    // Bez tego wszystkie `it.each` niżej przelatywałyby po zerowej liście.
    expect(SECTION_TYPES.length).toBe(12);
  });

  it.each(SECTION_TYPES)("%s: wynik jest ROZPOZNAWANY jako płótno v2", (type) => {
    expect(isSectionCanvas(canvasFor(type))).toBe(true);
  });

  it.each(SECTION_TYPES)("%s: wynik przechodzi schemat treści v2", (type) => {
    const parsed = sectionCanvasSchema.safeParse(canvasFor(type));
    expect(parsed.success ? null : parsed.error.issues, `konwersja ${type} nie spełnia schematu`).toBeNull();
  });

  it.each(SECTION_TYPES)("%s: płótno NIE jest puste", (type) => {
    // Sedno porównania typów ze sobą: typ, który konwertuje się do zera
    // elementów, wygląda w interfejsie jak pusta sekcja bez powodu.
    expect(canvasFor(type).elements.length).toBeGreaterThan(0);
  });

  it.each(SECTION_TYPES)("%s: żaden element nie wychodzi poza płótno", (type) => {
    const canvas = canvasFor(type);
    for (const element of canvas.elements) {
      const box = element.layout.desktop;
      expect(box.x + box.w, `${type}/${element.id} poza prawą krawędzią`).toBeLessThanOrEqual(
        CANVAS_COLUMNS,
      );
      expect(box.y + box.h, `${type}/${element.id} poza dolną krawędzią`).toBeLessThanOrEqual(
        canvas.rows,
      );
    }
  });

  it.each(SECTION_TYPES)("%s: pudełka Z TEKSTEM nie nachodzą na siebie", (type) => {
    /*
     * Wada, którą ta noga zamyka (znaleziona na ŻYWYM sklepie, nie w teście):
     * konwersja liczyła wysokość pudełka gęstością akapitu, więc nagłówek hero
     * w skali `display` łamał się na dwa wiersze i wchodził w tekst pod sobą,
     * a kafle atutów miały stałe odstępy niezależne od długości tytułu.
     *
     * Sprawdzamy WYŁĄCZNIE elementy niosące tekst. Nachodzenie SAMO W SOBIE
     * jest legalne na płótnie — baner sekcji CTA to kształt LEŻĄCY POD swoją
     * treścią i tak ma być; zakaz obejmuje więc treść, a nie tło.
     */
    const boxes = canvasFor(type)
      .elements.filter((element) => ["heading", "text", "button"].includes(element.kind))
      .map((element) => ({ id: element.id, ...element.layout.desktop }));
    expect(boxes.length, `${type}: brak elementów tekstowych do porównania`).toBeGreaterThan(0);

    const kolizje: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        const poziomo = a.x < b.x + b.w && b.x < a.x + a.w;
        const pionowo = a.y < b.y + b.h && b.y < a.y + a.h;
        if (poziomo && pionowo) kolizje.push(`${a.id} × ${b.id}`);
      }
    }
    expect(kolizje, `${type}: elementy tekstowe zachodzą na siebie`).toEqual([]);
  });

  it.each(SECTION_TYPES)("%s: identyfikatory elementów są unikalne", (type) => {
    const ids = canvasFor(type).elements.map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(SECTION_TYPES)("%s: wysokość sekcji mieści się w granicach schematu", (type) => {
    const { rows } = canvasFor(type);
    expect(rows).toBeGreaterThanOrEqual(SECTION_MIN_ROWS);
    expect(rows).toBeLessThanOrEqual(SECTION_MAX_ROWS);
  });

  it.each(SECTION_TYPES)("%s: liczba elementów mieści się w sufcie sekcji", (type) => {
    expect(canvasFor(type).elements.length).toBeLessThanOrEqual(MAX_ELEMENTS_PER_SECTION);
  });

  it.each(SECTION_TYPES)("%s: konwersja jest POWTARZALNA co do bajtu", (type) => {
    // Bez determinizmu nie dałoby się ani porównać wyniku w teście, ani
    // bezpiecznie powtórzyć konwersji przy wygaszaniu v1.
    const content = presetContentFor(type, "pl");
    expect(sectionCanvasFrom(type, content)).toEqual(sectionCanvasFrom(type, content));
  });

  it.each(PRESET_LOCALES)("parytet języków: %s daje tę samą STRUKTURĘ elementów", (locale) => {
    for (const type of SECTION_TYPES) {
      const pl = canvasFor(type, "pl");
      const other = canvasFor(type, locale);
      expect(
        other.elements.map((element) => element.kind),
        `${type}: rodzaje elementów rozjechały się między pl a ${locale}`,
      ).toEqual(pl.elements.map((element) => element.kind));
    }
  });
});

describe("konwersja: treść źródłowa NIE GINIE", () => {
  /**
   * Reguła jest bezwyjątkowa: KAŻDY string z treści v1 musi odnaleźć się na
   * płótnie. Nie ma tu listy „świadomie pominiętych" pól, bo lista wyjątków
   * jest dokładnie tym miejscem, w którym realna utrata treści zamieszkałaby
   * niezauważona — łatwiej dopisać wyjątek niż naprawić konwersję.
   */
  it.each(SECTION_TYPES)("%s: każdy tekst z treści v1 trafia na płótno", (type) => {
    const source = stringsIn(presetContentFor(type, "pl"));
    const rendered = payloadOf(canvasFor(type).elements).join("\n");
    expect(source.length, `${type}: preset nie ma żadnej treści do porównania`).toBeGreaterThan(0);

    for (const text of source) {
      // Etykieta przycisku ma limit 80 znaków — porównujemy przycięty początek,
      // bo to on musi się znaleźć, a nie cały akapit adresu.
      expect(rendered, `${type}: zgubiony tekst „${text}”`).toContain(text.slice(0, 80));
    }
  });

  it("atuty przenoszą IKONY z allowlisty, nie tylko teksty", () => {
    const content = presetContentFor("usp", "pl") as { items: { icon: string }[] };
    const icons = canvasFor("usp")
      .elements.filter((element) => element.kind === "icon")
      .map((element) => (element.kind === "icon" ? element.name : ""));
    expect(icons).toEqual(content.items.map((item) => item.icon));
  });

  it("produkty dostają element KATALOGU — listy z bazy nie da się ułożyć ręcznie", () => {
    expect(canvasFor("products").elements.some((element) => element.kind === "catalog")).toBe(true);
  });

  it("galeria bez zdjęć daje sam nagłówek, a ze zdjęciami — po elemencie na zdjęcie", () => {
    expect(canvasFor("gallery").elements.filter((element) => element.kind === "image")).toEqual([]);
    const withPhotos = sectionCanvasFrom("gallery", {
      heading: "Realizacje",
      items: [
        { imagePath: "t/a.jpg", alt: "Koparka" },
        { imagePath: "t/b.jpg", alt: "Rusztowanie" },
        { imagePath: "t/c.jpg", alt: "Agregat" },
        { imagePath: "t/d.jpg", alt: "Zagęszczarka" },
      ],
    });
    expect(withPhotos.elements.filter((element) => element.kind === "image")).toHaveLength(4);
    // Czwarte zdjęcie schodzi do drugiego rzędu — inaczej wyszłoby poza płótno.
    const boxes = withPhotos.elements
      .filter((element) => element.kind === "image")
      .map((element) => element.layout.desktop);
    expect(boxes[3]?.y).toBeGreaterThan(boxes[0]!.y);
    expect(boxes[3]?.x).toBe(boxes[0]!.x);
  });

  it("baner CTA leży POD swoją treścią — inaczej zasłoniłby nagłówek", () => {
    const canvas = canvasFor("cta");
    const banner = canvas.elements.find((element) => element.kind === "shape");
    const heading = canvas.elements.find((element) => element.kind === "heading");
    expect(banner).toBeTruthy();
    expect(banner!.layout.desktop.z).toBeLessThan(heading!.layout.desktop.z);
  });
});

describe("estymator wysokości pudełka tekstowego", () => {
  it("dłuższy tekst dostaje wyższe pudełko", () => {
    expect(textRows("x".repeat(300))).toBeGreaterThan(textRows("x".repeat(50)));
  });

  it("wąskie pudełko mieści mniej znaków w wierszu, więc rośnie", () => {
    expect(textRows("x".repeat(200), "body", 40)).toBeGreaterThan(
      textRows("x".repeat(200), "body", 120),
    );
  });

  it("krótki tekst nie schodzi poniżej minimum", () => {
    expect(textRows("A", "body", 120, 6)).toBe(6);
  });

  it("skala DECYDUJE o wysokości: ten sam tekst w skali display jest wyższy", () => {
    // To jest wada, przez którą powstały skale (patrz canvas-presets.ts):
    // nagłówek hero liczony gęstością akapitu mieścił się „na papierze"
    // w jednym wierszu, a na stronie łamał się na dwa i wychodził z pudełka.
    const naglowek = "Wypożycz sprzęt bez papierologii";
    expect(textRows(naglowek, "display")).toBeGreaterThan(textRows(naglowek, "body"));
    expect(textRows(naglowek, "display")).toBe(20); // dwa wiersze po 10 jednostek
  });

  it("hero z presetu ma pudełko nagłówka WYŻSZE niż jeden wiersz skali display", () => {
    const hero = canvasFor("hero");
    const heading = hero.elements.find((element) => element.kind === "heading");
    expect(heading?.layout.desktop.h).toBeGreaterThanOrEqual(20);
  });

  it("elementy hero NIE nachodzą na siebie w pionie", () => {
    // Pudełka układają się jedno pod drugim: dolna krawędź poprzedniego nie
    // może wejść w górną krawędź następnego. Dokładnie tego zabrakło w
    // pierwszej wersji konwersji.
    const boxes = canvasFor("hero")
      .elements.map((element) => element.layout.desktop)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i]!.y, `element ${i} zaczyna się nad końcem poprzedniego`).toBeGreaterThanOrEqual(
        boxes[i - 1]!.y + boxes[i - 1]!.h,
      );
    }
  });
});
