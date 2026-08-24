/**
 * KONTRAKT AUTO-UKŁADU MOBILNEGO (K4, ADR-088).
 *
 * Auto-układ jest funkcją czystą i to jest jego cała wartość: liczy się tak
 * samo w panelu i w sklepie, nie zapisuje się do treści i działa wstecz na
 * wszystkim, co tenant już ma. Kontrakt pyta o rzeczy, które muszą być prawdą
 * dla KAŻDEJ sekcji, a nie o wygląd jednej:
 *
 *   1. DETERMINIZM — ta sama treść daje bajtowo ten sam układ;
 *   2. JEDNA KOLUMNA — treść nie stoi obok siebie i nie nachodzi na siebie;
 *   3. KOLEJNOŚĆ CZYTANIA — kafel czyta się w całości, zanim zacznie się
 *      następny (tu ginęła naiwna wersja sortująca po współrzędnych);
 *   4. KOMPLETNOŚĆ — każdy element desktopu ma swoje miejsce na telefonie,
 *      także dodany po latach;
 *   5. PIERWSZEŃSTWO RĘCZNEJ POPRAWKI — i powrót do automatu bez śladu.
 *
 * Zbiór wejść bierzemy z `SECTION_TYPES` (lustro CHECK-a w bazie) oraz
 * z generatora losowych płócien o USTALONYM ziarnie — pierwsze pilnuje realnej
 * treści, drugie szuka przypadków, których nikt nie wymyślił.
 */
import { describe, expect, it } from "vitest";

import { sectionCanvasFrom } from "./canvas-presets";
import { createElement } from "./element-factory";
import {
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_PAD_COLUMNS,
  PALETTE_ELEMENT_KINDS,
  SECTION_MAX_ROWS_MOBILE,
  SECTION_MIN_ROWS,
  type CanvasElement,
  type Geometry,
  type SectionCanvas,
} from "./elements";
import { SECTION_TYPES, presetContentFor, type SectionType } from "./index";
import { mobileLayoutOf } from "./mobile-layout";

function canvasFor(type: SectionType): SectionCanvas {
  return sectionCanvasFrom(type, presetContentFor(type, "pl"));
}

/** Element z ręczną poprawką mobilną — bez mutacji wejścia. */
function withMobile(canvas: SectionCanvas, id: string, mobile: Geometry): SectionCanvas {
  return {
    ...canvas,
    elements: canvas.elements.map((element) =>
      element.id === id
        ? ({ ...element, layout: { ...element.layout, mobile } } as CanvasElement)
        : element,
    ),
  };
}

/**
 * Generator płócien o ustalonym ziarnie. Losowość jest tu NARZĘDZIEM, nie
 * ryzykiem: ciąg jest odtwarzalny co do bitu, więc czerwony wynik da się
 * powtórzyć, a zielony nie jest kwestią szczęścia.
 */
function randomCanvases(count: number): SectionCanvas[] {
  let seed = 20260803;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = <T,>(values: readonly T[]): T => values[Math.floor(next() * values.length)]!;

  return Array.from({ length: count }, (_, canvasIndex) => {
    const elements: CanvasElement[] = [];
    const total = 1 + Math.floor(next() * 8);
    for (let index = 0; index < total; index += 1) {
      // Zbiór rodzajów idzie z REJESTRU palety, nie z listy obok testu:
      // rodzaj dodany albo usunięty (jak `mapLink` w ADR-094) przestawia
      // generator razem z paletą, a nie po tygodniu, gdy ktoś zauważy.
      const kind = pick(PALETTE_ELEMENT_KINDS);
      const w = 4 + Math.floor(next() * 60);
      const h = 4 + Math.floor(next() * 30);
      const geometry: Geometry = {
        x: Math.floor(next() * (CANVAS_COLUMNS - w)),
        y: Math.floor(next() * 120),
        w,
        h,
        z: index,
      };
      elements.push(createElement(kind, `el-${canvasIndex}-${index}`, geometry, "pl"));
    }
    const bottom = elements.reduce(
      (lowest, element) => Math.max(lowest, element.layout.desktop.y + element.layout.desktop.h),
      SECTION_MIN_ROWS,
    );
    return { version: 2, rows: bottom + 4, background: "default", elements } as SectionCanvas;
  });
}

const CASES: [string, SectionCanvas][] = [
  ...SECTION_TYPES.map((type) => [`preset ${type}`, canvasFor(type)] as [string, SectionCanvas]),
  ...randomCanvases(24).map(
    (canvas, index) => [`losowe #${index + 1}`, canvas] as [string, SectionCanvas],
  ),
];

describe("auto-układ mobilny: kontrakt wspólny dla wszystkich płócien", () => {
  it("zbiór wejść nie jest pusty (kontrola po pustym zbiorze)", () => {
    // Bez tego wszystkie `it.each` niżej przelatywałyby po zerowej liście.
    expect(CASES.length).toBe(SECTION_TYPES.length + 24);
    expect(SECTION_TYPES.length).toBe(14);
  });

  it.each(CASES)("%s: układ jest POWTARZALNY co do bajtu", (_name, canvas) => {
    // Bez determinizmu nie da się ani porównać wyniku w teście, ani obiecać,
    // że panel i sklep policzą to samo — a to jest cała teza tego modułu.
    const first = mobileLayoutOf(canvas);
    const second = mobileLayoutOf(canvas);
    expect(first.rows).toBe(second.rows);
    expect(first.boxes).toEqual(second.boxes);
  });

  it.each(CASES)("%s: KAŻDY element desktopu ma swoje miejsce na telefonie", (_name, canvas) => {
    const layout = mobileLayoutOf(canvas);
    const missing = canvas.elements.filter((element) => !layout.boxes[element.id]);
    expect(missing.map((element) => element.id), "element zgubiony przez auto-układ").toEqual([]);
  });

  it.each(CASES)("%s: nic nie wychodzi poza płótno mobilne", (_name, canvas) => {
    const layout = mobileLayoutOf(canvas);
    expect(layout.rows).toBeGreaterThanOrEqual(SECTION_MIN_ROWS);
    expect(layout.rows).toBeLessThanOrEqual(SECTION_MAX_ROWS_MOBILE);
    for (const [id, box] of Object.entries(layout.boxes)) {
      expect(box.x, `${id}: poza lewą krawędzią`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w, `${id}: poza prawą krawędzią`).toBeLessThanOrEqual(CANVAS_COLUMNS);
      expect(box.y + box.h, `${id}: poza dolną krawędzią`).toBeLessThanOrEqual(layout.rows);
    }
  });

  it.each(CASES)("%s: treść stoi w JEDNEJ kolumnie, w pasie treści", (_name, canvas) => {
    // Kształt-podkład obejmuje swoją kartę, więc pas treści liczymy dla treści.
    const layout = mobileLayoutOf(canvas);
    for (const element of canvas.elements) {
      const box = layout.boxes[element.id]!;
      expect(box.x, `${element.id}: przed pasem treści`).toBeGreaterThanOrEqual(CANVAS_PAD_COLUMNS);
      expect(box.x + box.w, `${element.id}: za pasem treści`).toBeLessThanOrEqual(
        CANVAS_PAD_COLUMNS + CANVAS_CONTENT_COLUMNS,
      );
    }
  });

  it.each(CASES)("%s: treść nie nachodzi na siebie w kolumnie", (_name, canvas) => {
    /*
     * Sedno „jednej kolumny": elementy niosące treść idą jeden POD drugim.
     * Kształty są wyłączone, bo kształt-podkład LEŻY POD swoją kartą i tak ma
     * być — ten sam wyjątek, co w kontrakcie konwersji na desktopie.
     */
    const layout = mobileLayoutOf(canvas);
    const boxes = canvas.elements
      .filter((element) => element.kind !== "shape")
      .map((element) => ({ id: element.id, ...layout.boxes[element.id]! }))
      .sort((a, b) => a.y - b.y || a.x - b.x);

    const kolizje: string[] = [];
    for (let index = 1; index < boxes.length; index += 1) {
      const above = boxes[index - 1]!;
      const below = boxes[index]!;
      if (below.y < above.y + above.h) kolizje.push(`${above.id} × ${below.id}`);
    }
    expect(kolizje, "elementy zachodzą na siebie w kolumnie mobilnej").toEqual([]);
  });

  it.each(CASES)("%s: auto-układ NIE MUTUJE treści wejściowej", (_name, canvas) => {
    const before = JSON.stringify(canvas);
    mobileLayoutOf(canvas);
    expect(JSON.stringify(canvas)).toBe(before);
  });
});

describe("kolejność czytania przeżywa zwijanie do kolumny", () => {
  it("kafel atutów czyta się w CAŁOŚCI, zanim zacznie się następny", () => {
    /*
     * WADA, którą ta noga zamyka: sortowanie po (y, x) wygląda na oczywiste
     * i daje kolejność WIERSZAMI — wszystkie ikony, potem wszystkie tytuły,
     * potem wszystkie opisy. Trzy kafle rozprute na dziewięć luźnych pasków,
     * bez jednego czerwonego testu, dopóki ktoś nie spojrzy na telefon.
     */
    const canvas = canvasFor("usp");
    const layout = mobileLayoutOf(canvas);
    const kinds = canvas.elements
      .map((element) => ({ kind: element.kind, y: layout.boxes[element.id]!.y }))
      .sort((a, b) => a.y - b.y)
      .map((entry) => entry.kind);

    // Nagłówek sekcji, a potem powtarzalny wzorzec kafla: ikona → tytuł → opis.
    expect(kinds[0]).toBe("heading");
    const kafle = kinds.slice(1);
    expect(kafle.length % 3, "preset atutów nie składa się z pełnych kafli").toBe(0);
    for (let index = 0; index < kafle.length; index += 3) {
      expect(kafle.slice(index, index + 3), `kafel ${index / 3 + 1} rozprutY`).toEqual([
        "icon",
        "heading",
        "text",
      ]);
    }
  });

  it("baner sekcji CTA zostaje TŁEM swojej treści, a nie osobnym prostokątem", () => {
    const canvas = canvasFor("cta");
    const layout = mobileLayoutOf(canvas);
    const banner = canvas.elements.find((element) => element.kind === "shape")!;
    const tlo = layout.boxes[banner.id]!;

    const tresc = canvas.elements.filter((element) => element.kind !== "shape");
    expect(tresc.length, "preset CTA bez treści do porównania").toBeGreaterThan(0);
    for (const element of tresc) {
      const box = layout.boxes[element.id]!;
      expect(box.y, `${element.id} wyszedł nad baner`).toBeGreaterThanOrEqual(tlo.y);
      expect(box.y + box.h, `${element.id} wyszedł pod baner`).toBeLessThanOrEqual(tlo.y + tlo.h);
    }
  });

  it("element dodany na DESKTOPIE pojawia się w automacie bez niczyjej ręki", () => {
    const canvas = canvasFor("hero");
    const before = mobileLayoutOf(canvas);
    const dodany = createElement("button", "nowy-przycisk", { x: 12, y: 200, w: 30, h: 7, z: 9 }, "pl");
    const after = mobileLayoutOf({
      ...canvas,
      rows: 220,
      elements: [...canvas.elements, dodany],
    });

    expect(after.boxes["nowy-przycisk"], "nowy element nie ma miejsca na telefonie").toBeDefined();
    // Leżał NAJNIŻEJ na desktopie, więc na telefonie ma być ostatni.
    const najnizszy = Math.max(...Object.values(after.boxes).map((box) => box.y));
    expect(after.boxes["nowy-przycisk"]!.y).toBe(najnizszy);
    // …i nie ruszył nikogo, kto był przed nim.
    for (const element of canvas.elements) {
      expect(after.boxes[element.id], `${element.id} przesunął się przez dopisanie na końcu`).toEqual(
        before.boxes[element.id],
      );
    }
  });
});

describe("ręczna poprawka wygrywa z automatem", () => {
  const canvas = canvasFor("hero");
  const target = canvas.elements[1]!;
  const delta: Geometry = { x: 20, y: 400, w: 60, h: 40, z: 3 };

  it("automat sam z siebie NIE odpina żadnego elementu (kontrola negatywna)", () => {
    expect([...mobileLayoutOf(canvas).detached]).toEqual([]);
  });

  it("poprawka zastępuje pudełko z automatu i oznacza element jako odpięty", () => {
    const layout = mobileLayoutOf(withMobile(canvas, target.id, delta));
    expect(layout.boxes[target.id]).toEqual(delta);
    expect([...layout.detached]).toEqual([target.id]);
    // Kontrola pozytywna: automat naprawdę chciał go gdzie indziej.
    expect(mobileLayoutOf(canvas).boxes[target.id]).not.toEqual(delta);
  });

  it("płótno mobilne ROŚNIE, żeby objąć poprawkę wyprowadzoną w dół", () => {
    const layout = mobileLayoutOf(withMobile(canvas, target.id, delta));
    expect(layout.rows).toBeGreaterThanOrEqual(delta.y + delta.h);
  });

  it("poprawka NIE rusza miejsca pozostałych elementów", () => {
    // Automat liczy się dla WSZYSTKICH, a poprawki nakładają się na wynik —
    // dzięki temu skasowanie poprawki oddaje elementowi to samo miejsce.
    const auto = mobileLayoutOf(canvas);
    const zPoprawka = mobileLayoutOf(withMobile(canvas, target.id, delta));
    for (const element of canvas.elements) {
      if (element.id === target.id) continue;
      expect(zPoprawka.boxes[element.id]).toEqual(auto.boxes[element.id]);
    }
  });

  it("zdjęcie poprawki wraca DOKŁADNIE do układu automatycznego", () => {
    const auto = mobileLayoutOf(canvas);
    const wrocone = mobileLayoutOf({
      ...withMobile(canvas, target.id, delta),
      elements: canvas.elements,
    });
    expect(wrocone.boxes).toEqual(auto.boxes);
    expect(wrocone.rows).toBe(auto.rows);
  });

  it("poprawka NIE dotyka geometrii desktopowej", () => {
    const zPoprawka = withMobile(canvas, target.id, delta);
    expect(zPoprawka.elements.map((element) => element.layout.desktop)).toEqual(
      canvas.elements.map((element) => element.layout.desktop),
    );
  });
});
