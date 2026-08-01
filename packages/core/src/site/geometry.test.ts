/**
 * SILNIK GEOMETRII PŁÓTNA (K2, ADR-084) — testy funkcji czystych.
 *
 * Ten plik broni SEDNA kreatora: czy element ląduje tam, gdzie operator myśli,
 * że go kładzie. Wszystko liczy się w jednostkach siatki, bez DOM-u — więc
 * wynik jest sprawdzalny co do liczby, a nie „na oko na zrzucie ekranu".
 *
 * Uwaga o teście prowadnic: sprawdzamy JEDNOCZEŚNIE geometrię i prowadnicę.
 * Sama prowadnica bez geometrii dowodziłaby, że narysowaliśmy linię; sama
 * geometria bez prowadnicy — że coś się gdzieś przesunęło. Wada, której się
 * boimy, mieszka dokładnie między nimi: linia rysowana tam, gdzie elementu nie
 * ma.
 */
import { describe, expect, it } from "vitest";

import { CANVAS_COLUMNS, type CanvasElement, type Geometry } from "./elements";
import {
  MIN_ELEMENT_UNITS,
  NUDGE_STEP,
  NUDGE_STEP_LARGE,
  bringToFront,
  clampGeometry,
  normalizeLayers,
  nudgeGeometry,
  paintOrder,
  sendToBack,
  snapMove,
  snapResize,
} from "./geometry";

const ROWS = 60;

function box(x: number, y: number, w: number, h: number, z = 0): Geometry {
  return { x, y, w, h, z };
}

/** Sąsiad: pudełko 20 × 10 w lewym górnym rejonie płótna. */
const NEIGHBOUR = box(20, 10, 20, 10);

function context(overrides: Partial<Parameters<typeof snapMove>[3]> = {}) {
  return { rows: ROWS, neighbours: [NEIGHBOUR], snap: true, ...overrides };
}

describe("siatka: pozycja jest zawsze całkowita", () => {
  it("ułamkowe przesunięcie wskaźnika zaokrągla się do jednostki", () => {
    // Bez przyciągania do sąsiadów, żeby zmierzyć SAMO zaokrąglenie: siatka
    // działa niezależnie od tego, czy przyciąganie jest włączone.
    const result = snapMove(box(60, 30, 10, 6), 2.4, -1.6, context({ neighbours: [], snap: false }));
    expect(result.geometry.x).toBe(62);
    expect(result.geometry.y).toBe(28);
  });

  it("wielkość pudełka nie zmienia się przy przesunięciu", () => {
    const result = snapMove(box(60, 30, 11, 7), 3.2, 3.2, context({ neighbours: [], snap: false }));
    expect(result.geometry.w).toBe(11);
    expect(result.geometry.h).toBe(7);
  });
});

describe("prowadnice: krawędzie i środki sąsiadów", () => {
  it("lewa krawędź przyciąga się do lewej krawędzi sąsiada i MELDUJE prowadnicę", () => {
    // Start 19, jedna jednostka od krawędzi sąsiada (x = 20).
    const result = snapMove(box(19, 40, 12, 6), 0, 0, context());
    expect(result.geometry.x).toBe(20);
    const guide = result.guides.find((entry) => entry.axis === "x" && entry.at === 20);
    expect(guide, "brak prowadnicy dla wyrównania, które zaszło").toBeTruthy();
    // Linia obejmuje OBA pudełka: sąsiada (10…20) i przeciągane (40…46).
    expect(guide?.from).toBe(10);
    expect(guide?.to).toBe(46);
  });

  it("środek przyciąga się do środka sąsiada, gdy parzystość szerokości się zgadza", () => {
    // Sąsiad ma środek w 30. Pudełko szerokości 10 (parzystej, jak 20) trafia
    // środkiem w 30 przy x = 25.
    const result = snapMove(box(26, 40, 10, 6), 0, 0, context());
    expect(result.geometry.x).toBe(25);
    expect(result.geometry.x + result.geometry.w / 2).toBe(30);
    expect(result.guides.some((entry) => entry.kind === "center" && entry.at === 30)).toBe(true);
  });

  it("prawa krawędź przyciąga się do prawej krawędzi sąsiada", () => {
    const result = snapMove(box(29, 40, 12, 6), 0, 0, context());
    expect(result.geometry.x + result.geometry.w).toBe(40);
  });

  it("poza zasięgiem NIE przyciąga i nie rysuje prowadnicy", () => {
    // x = 45 leży dalej niż jedna jednostka od KAŻDEGO celu tego sąsiada
    // (krawędzie 20/40 i środek 30, przy trzech zaczepach pudełka).
    const result = snapMove(box(45, 40, 12, 6), 0, 0, context());
    expect(result.geometry.x).toBe(45);
    expect(result.guides.filter((entry) => entry.axis === "x")).toEqual([]);
  });

  it("wyłączone przyciąganie zostawia surową jednostkę i ZERO prowadnic", () => {
    const result = snapMove(box(19, 40, 12, 6), 0, 0, context({ snap: false }));
    expect(result.geometry.x).toBe(19);
    expect(result.guides).toEqual([]);
  });

  it("środek PŁÓTNA jest celem — bez niego trafienie w oś byłoby przypadkiem", () => {
    const half = CANVAS_COLUMNS / 2;
    const result = snapMove(box(half - 10, 40, 20, 6), 1, 0, context({ neighbours: [] }));
    expect(result.geometry.x + result.geometry.w / 2).toBe(half);
    expect(result.guides.some((entry) => entry.kind === "canvas" && entry.at === half)).toBe(true);
  });

  it("oś pionowa działa tak samo jak pozioma", () => {
    const result = snapMove(box(60, 21, 10, 6), 0, 0, context());
    // Sąsiad zaczyna się w y = 10, kończy w 20 — górna krawędź przyciąga się do 20.
    expect(result.geometry.y).toBe(20);
    expect(result.guides.some((entry) => entry.axis === "y" && entry.at === 20)).toBe(true);
  });
});

describe("kolizje z krawędziami płótna", () => {
  it("element nie wychodzi poza prawą krawędź", () => {
    const result = snapMove(box(130, 10, 12, 6), 40, 0, context({ neighbours: [] }));
    expect(result.geometry.x + result.geometry.w).toBeLessThanOrEqual(CANVAS_COLUMNS);
    expect(result.geometry.x).toBe(CANVAS_COLUMNS - 12);
  });

  it("element nie wychodzi poza dolną krawędź ani nad górną", () => {
    expect(snapMove(box(10, 50, 10, 8), 0, 40, context({ neighbours: [] })).geometry.y).toBe(ROWS - 8);
    expect(snapMove(box(10, 4, 10, 8), 0, -40, context({ neighbours: [] })).geometry.y).toBe(0);
  });

  it("clampGeometry przycina pudełko wyższe niż płótno", () => {
    const clamped = clampGeometry(box(0, 0, 200, 500), ROWS);
    expect(clamped.w).toBe(CANVAS_COLUMNS);
    expect(clamped.h).toBe(ROWS);
    expect(clamped.y).toBe(0);
  });
});

describe("zmiana rozmiaru za uchwyt", () => {
  it("uchwyt „e” rusza prawą krawędź, lewa stoi", () => {
    const result = snapResize(box(10, 10, 20, 10), "e", 6, 0, context({ neighbours: [] }));
    expect(result.geometry.x).toBe(10);
    expect(result.geometry.w).toBe(26);
  });

  it("uchwyt „w” rusza lewą krawędź, PRAWA stoi w miejscu", () => {
    const result = snapResize(box(10, 10, 20, 10), "w", 6, 0, context({ neighbours: [] }));
    expect(result.geometry.x).toBe(16);
    expect(result.geometry.x + result.geometry.w).toBe(30);
  });

  it("róg rusza dwiema krawędziami naraz", () => {
    const result = snapResize(box(10, 10, 20, 10), "se", 4, 4, context({ neighbours: [] }));
    expect(result.geometry.w).toBe(24);
    expect(result.geometry.h).toBe(14);
  });

  it("przy minimum krawędź STOI, a pudełko nie zaczyna wędrować", () => {
    const result = snapResize(box(10, 10, 20, 10), "w", 100, 0, context({ neighbours: [] }));
    expect(result.geometry.w).toBe(MIN_ELEMENT_UNITS);
    expect(result.geometry.x + result.geometry.w).toBe(30);
  });

  it("ruszana krawędź przyciąga się do sąsiada i melduje prowadnicę", () => {
    // Prawa krawędź w 39, krawędź sąsiada w 40.
    const result = snapResize(box(10, 40, 29, 6), "e", 0, 0, context());
    expect(result.geometry.x + result.geometry.w).toBe(40);
    expect(result.guides.some((entry) => entry.axis === "x" && entry.at === 40)).toBe(true);
  });

  it("rozmiar nie wychodzi poza płótno", () => {
    const result = snapResize(box(100, 10, 30, 10), "e", 100, 0, context({ neighbours: [] }));
    expect(result.geometry.x + result.geometry.w).toBe(CANVAS_COLUMNS);
  });
});

describe("klawiatura", () => {
  it("strzałka przesuwa o JEDNĄ jednostkę", () => {
    expect(nudgeGeometry(box(10, 10, 8, 8), "right", NUDGE_STEP, ROWS).x).toBe(11);
    expect(nudgeGeometry(box(10, 10, 8, 8), "up", NUDGE_STEP, ROWS).y).toBe(9);
  });

  it("Shift przesuwa o dziesięć", () => {
    expect(nudgeGeometry(box(10, 10, 8, 8), "down", NUDGE_STEP_LARGE, ROWS).y).toBe(20);
  });

  it("krok klawiatury też zatrzymuje się o krawędź", () => {
    expect(nudgeGeometry(box(0, 10, 8, 8), "left", NUDGE_STEP_LARGE, ROWS).x).toBe(0);
  });
});

describe("warstwy", () => {
  function element(id: string, z: number): CanvasElement {
    return {
      id,
      kind: "shape",
      shape: "box",
      fill: "paper",
      layout: { desktop: box(0, 0, 10, 10, z) },
    } as CanvasElement;
  }

  const elements = [element("a", 0), element("b", 1), element("c", 2)];

  it("kolejność malowania idzie po warstwie, nie po kolejności w tablicy", () => {
    const shuffled = [element("a", 2), element("b", 0), element("c", 1)];
    expect(paintOrder(shuffled).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("na wierzch: element ma najwyższą warstwę, reszta zachowuje kolejność", () => {
    const next = bringToFront(elements, "a");
    expect(paintOrder(next).map((item) => item.id)).toEqual(["b", "c", "a"]);
  });

  it("na spód: element ma warstwę 0, reszta idzie w górę", () => {
    const next = sendToBack(elements, "c");
    expect(paintOrder(next).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  it("warstwy zostają ciągiem bez dziur — powtarzane „na wierzch” nie dobija do sufitu", () => {
    let next = elements;
    for (let i = 0; i < 20; i += 1) next = bringToFront(next, "a");
    expect(next.map((item) => item.layout.desktop.z).sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });

  it("normalizacja nie rusza kolejności, gdy warstwy są już ciągiem", () => {
    expect(normalizeLayers(elements).map((item) => item.layout.desktop.z)).toEqual([0, 1, 2]);
  });

  it("nieznany identyfikator nie wywraca listy", () => {
    expect(bringToFront(elements, "brak").map((item) => item.id)).toEqual(["a", "b", "c"]);
  });
});
