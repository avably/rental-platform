/**
 * KONTRAKT REGUŁ RENDERU PŁÓTNA (ADR-274).
 *
 * Trzy obietnice, których nie widać ani w schemacie treści, ani w auto-układzie:
 *
 *   1. TREŚĆ NIE DA SIĘ ZASŁONIĆ. Dekoracja maluje się pod napisem NIEZALEŻNIE
 *      od tego, co zapisano w `z` — bo `z` jest liczbą operatora, a nie rolą.
 *   2. WYSOKOŚĆ SEKCJI ROŚNIE Z TREŚCIĄ, ale WYŁĄCZNIE poniżej szerokości
 *      projektowej: przy niej rozciągnięcie jest równe jeden z konstrukcji,
 *      więc desktop zostaje dokładnie taki, jaki zaprojektował najemca.
 *   3. RUSZTOWANIE KREATORA NIE JEST TREŚCIĄ — kafel bez zdjęcia i zdanie
 *      z palety nie jadą do klienta.
 *
 * Wejściem jest komplet presetów (lustro tego, co naprawdę leży w bazie), a nie
 * jedno wymyślone płótno: reguła, która działa na przykładzie i nie działa na
 * sekcji CTA, jest gorsza niż brak reguły.
 */
import { describe, expect, it } from "vitest";

import {
  CANVAS_MAX_STRETCH,
  canvasStretchAt,
  isContentElement,
  isEmptyImageElement,
  isPublishableElement,
  isStarterCopyElement,
  renderLayerZ,
} from "./canvas-render";
import { sectionCanvasFrom } from "./canvas-presets";
import { createElement } from "./element-factory";
import {
  CANVAS_DESIGN_WIDTH_PX,
  MOBILE_DESIGN_WIDTH_PX,
  canvasElementSchema,
  sizeOf,
  type CanvasElement,
  type SectionCanvas,
} from "./elements";
import { SECTION_TYPES, presetContentFor, type SectionType } from "./index";
import { scaleOfElement, textHeightUnitsAt } from "./text-metrics";

const PRESETY: [string, SectionCanvas][] = SECTION_TYPES.map((type) => [
  type,
  sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl")),
]);

/** Płótno z audytu `/audyt-c`: dekoracja z WYŻSZĄ warstwą niż komplet treści. */
const zaslonieteHero: SectionCanvas = {
  version: 2,
  rows: 65,
  background: "default",
  elements: [
    {
      id: "naglowek",
      kind: "heading",
      level: 1,
      align: "left",
      text: "Wypożycz sprzęt bez papierologii",
      layout: { desktop: { x: 12, y: 14, w: 120, h: 20, z: 0 } },
    },
    {
      id: "lead",
      kind: "text",
      variant: "lead",
      align: "left",
      text: "Rezerwacja online, odbiór na miejscu albo z dostawą — wszystko w jednym miejscu.",
      layout: { desktop: { x: 12, y: 37, w: 120, h: 8, z: 0 } },
    },
    {
      id: "cta",
      kind: "button",
      label: "Zobacz katalog",
      href: "/katalog",
      variant: "solid",
      align: "left",
      size: { w: "hug", h: "hug" },
      layout: { desktop: { x: 12, y: 48, w: 30, h: 7, z: 0 } },
    },
    {
      id: "zdjecie",
      kind: "image",
      alt: "Kadr z placu budowy",
      fit: "cover",
      source: { kind: "storage", path: "tenant/hero.jpg" },
      layout: { desktop: { x: 12, y: 29, w: 48, h: 36, z: 5 } },
    },
    {
      id: "ksztalt",
      kind: "shape",
      shape: "box",
      fill: "paper",
      layout: { desktop: { x: 80, y: 39, w: 40, h: 12, z: 7 } },
    },
  ],
} as SectionCanvas;

describe("pasmo treści maluje się NAD pasmem dekoracji", () => {
  it("zbiór wejść nie jest pusty (kontrola po pustym zbiorze)", () => {
    expect(PRESETY.length).toBe(SECTION_TYPES.length);
    expect(SECTION_TYPES.length).toBe(14);
  });

  it("hero z audytu: h1, lead i CTA są NAD zdjęciem i kształtem o wyższym `z`", () => {
    const warstwy = renderLayerZ(zaslonieteHero.elements);
    for (const tresc of ["naglowek", "lead", "cta"]) {
      for (const dekoracja of ["zdjecie", "ksztalt"]) {
        expect(
          warstwy[tresc]!,
          `${tresc} maluje się pod ${dekoracja} — napis zasłonięty przestaje istnieć`,
        ).toBeGreaterThan(warstwy[dekoracja]!);
      }
    }
  });

  it.each(PRESETY)("%s: ŻADNA dekoracja nie stoi nad elementem treści", (_typ, canvas) => {
    const warstwy = renderLayerZ(canvas.elements);
    const nad = canvas.elements.flatMap((element) =>
      isContentElement(element)
        ? canvas.elements
            .filter((inny) => !isContentElement(inny) && warstwy[inny.id]! > warstwy[element.id]!)
            .map((inny) => `${inny.id} nad ${element.id}`)
        : [],
    );
    expect(nad).toEqual([]);
  });

  it.each(PRESETY)("%s: kolejność WEWNĄTRZ pasma zostaje operatora", (_typ, canvas) => {
    /*
     * Reguła przestawia PASMA, a nie ich zawartość: welon nad zdjęciem i karta
     * nad tłem mają dalej działać. Porównujemy więc pary z tego samego pasma.
     */
    const warstwy = renderLayerZ(canvas.elements);
    const rozjazdy: string[] = [];
    for (const a of canvas.elements) {
      for (const b of canvas.elements) {
        if (a.id === b.id) continue;
        if (isContentElement(a) !== isContentElement(b)) continue;
        if (a.layout.desktop.z >= b.layout.desktop.z) continue;
        if (warstwy[a.id]! > warstwy[b.id]!) rozjazdy.push(`${a.id} przeskoczył ${b.id}`);
      }
    }
    expect(rozjazdy).toEqual([]);
  });

  it("zatopione kształty idą pod SPÓD — także pod dekorację o niższym `z`", () => {
    const warstwy = renderLayerZ(zaslonieteHero.elements, new Set(["ksztalt"]));
    for (const inny of ["naglowek", "lead", "cta", "zdjecie"]) {
      expect(warstwy["ksztalt"]!).toBeLessThan(warstwy[inny]!);
    }
  });

  it("warstwy są ciągiem 0…n-1 — mieszczą się w zakresie `z` ze schematu", () => {
    const warstwy = renderLayerZ(zaslonieteHero.elements);
    expect([...Object.values(warstwy)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("wysokość sekcji rośnie z treścią, ale nie na desktopie", () => {
  const desktopBox = (element: CanvasElement) => element.layout.desktop;

  it.each(PRESETY)(
    "%s: przy szerokości PROJEKTOWEJ rozciągnięcia nie ma (desktop bez zmian)",
    (_typ, canvas) => {
      expect(
        canvasStretchAt(canvas.elements, desktopBox, canvas.rows, CANVAS_DESIGN_WIDTH_PX, CANVAS_DESIGN_WIDTH_PX),
      ).toBe(1);
    },
  );

  it("pudełko ZWĘŻONE przez operatora też nie rozciąga desktopu", () => {
    // Mianownik bierze `max(h, potrzeba przy projektowej)`, więc układ, który
    // operator sam sobie ścisnął, zostaje jego układem — poprawiamy patologie
    // wąskiego ekranu, a nie cudze decyzje.
    const ciasne = {
      ...zaslonieteHero,
      elements: zaslonieteHero.elements.map((element) =>
        element.id === "lead"
          ? ({ ...element, layout: { desktop: { ...element.layout.desktop, h: 2 } } } as CanvasElement)
          : element,
      ),
    } as SectionCanvas;
    expect(
      canvasStretchAt(ciasne.elements, desktopBox, ciasne.rows, CANVAS_DESIGN_WIDTH_PX, CANVAS_DESIGN_WIDTH_PX),
    ).toBe(1);
  });

  /** Miejsce elementu: własne pudełko plus pustka pod nim, w tej samej kolumnie. */
  function miejsce(canvas: SectionCanvas, element: CanvasElement): number {
    const box = element.layout.desktop;
    let next = canvas.rows;
    for (const inny of canvas.elements) {
      if (inny.id === element.id) continue;
      const other = inny.layout.desktop;
      if (other.x >= box.x + box.w || box.x >= other.x + other.w) continue;
      if (other.y < box.y + box.h) continue;
      next = Math.min(next, other.y);
    }
    return Math.max(box.h, next - box.y);
  }

  it("hero z audytu przy 640 px: lead przestaje się mieścić — sekcja rośnie", () => {
    const stretch = canvasStretchAt(
      zaslonieteHero.elements,
      desktopBox,
      zaslonieteHero.rows,
      640,
      CANVAS_DESIGN_WIDTH_PX,
    );
    expect(stretch, "sekcja nie urosła, choć tekst się nie mieści").toBeGreaterThan(1);
  });

  it.each([1024, 896, 768, 640])(
    "przy %i px KAŻDY tekst mieści się w swoim miejscu po rozciągnięciu",
    (width) => {
      /*
       * Sedno obietnicy, sprawdzone na płótnie z audytu I na wszystkich
       * presetach: po pomnożeniu wysokości płótna przez współczynnik żaden
       * napis nie wchodzi na to, co pod nim.
       */
      for (const canvas of [zaslonieteHero, ...PRESETY.map(([, c]) => c)]) {
        const stretch = canvasStretchAt(
          canvas.elements,
          desktopBox,
          canvas.rows,
          width,
          CANVAS_DESIGN_WIDTH_PX,
        );
        for (const element of canvas.elements) {
          if (element.kind !== "text" && element.kind !== "heading") continue;
          if (sizeOf(element).h !== "fixed") continue;
          const box = element.layout.desktop;
          const scale = scaleOfElement(element);
          const potrzeba = textHeightUnitsAt(element.text, scale, box.w, width);
          // Miejsce ciaśniejsze od potrzeby JUŻ przy projektowej jest decyzją
          // operatora — rozciągnięcie ma dowieźć tę samą proporcję, nie lepszą.
          const podstawa = Math.max(
            miejsce(canvas, element),
            textHeightUnitsAt(element.text, scale, box.w, CANVAS_DESIGN_WIDTH_PX),
          );
          expect(
            podstawa * stretch + 1e-9,
            `${element.id} @${width}px: tekst wchodzi na element pod sobą`,
          ).toBeGreaterThanOrEqual(potrzeba);
        }
      }
    },
  );

  it("rozciągnięcie rośnie MONOTONICZNIE, gdy płótno się zwęża", () => {
    const przy = (width: number) =>
      canvasStretchAt(zaslonieteHero.elements, desktopBox, zaslonieteHero.rows, width, CANVAS_DESIGN_WIDTH_PX);
    expect(przy(1024)).toBeLessThanOrEqual(przy(896));
    expect(przy(896)).toBeLessThanOrEqual(przy(768));
    expect(przy(768)).toBeLessThanOrEqual(przy(640));
  });

  it("sufit trzyma przy skrajnym zwężeniu — sekcja zostaje sekcją", () => {
    /*
     * Bez sufitu współczynnik rośnie z kwadratem zwężenia: przy 300 px wobec
     * projektowych 1152 px sam wiersz jest 3,4 razy wyższy w jednostkach, a do
     * tego dochodzą złamania. Trzykrotność to granica, za którą „ta sama
     * sekcja" przestaje być tą samą sekcją, a strona zamienia się w rolkę.
     */
    const surowy = canvasStretchAt(zaslonieteHero.elements, desktopBox, zaslonieteHero.rows, 300, CANVAS_DESIGN_WIDTH_PX);
    expect(surowy).toBe(CANVAS_MAX_STRETCH);
    // Kontrola pozytywna: bez sufitu ta sama treść przekracza próg — inaczej
    // asercja wyżej świeciłaby na zielono także dla współczynnika 1,2.
    const lead = zaslonieteHero.elements[1] as CanvasElement & { text: string };
    const box = lead.layout.desktop;
    const bez =
      textHeightUnitsAt(lead.text, scaleOfElement(lead), box.w, 300) /
      Math.max(box.h, textHeightUnitsAt(lead.text, scaleOfElement(lead), box.w, CANVAS_DESIGN_WIDTH_PX));
    expect(bez).toBeGreaterThan(CANVAS_MAX_STRETCH);
  });

  it("płótno mobilne: zwężenie z 390 do 320 px też dokłada wysokości", () => {
    const mobileBox = (element: CanvasElement) => element.layout.desktop;
    expect(
      canvasStretchAt(zaslonieteHero.elements, mobileBox, zaslonieteHero.rows, 320, MOBILE_DESIGN_WIDTH_PX),
    ).toBeGreaterThan(1);
    expect(
      canvasStretchAt(
        zaslonieteHero.elements,
        mobileBox,
        zaslonieteHero.rows,
        MOBILE_DESIGN_WIDTH_PX,
        MOBILE_DESIGN_WIDTH_PX,
      ),
    ).toBe(1);
  });

  it("płótno bez tekstu o jawnej wysokości nie rozciąga się nigdy", () => {
    // Kontrola negatywna: gdyby rozciągnięcie liczyło się z czegokolwiek innego
    // niż łamanie tekstu, ta sekcja też by urosła.
    const same = {
      ...zaslonieteHero,
      elements: zaslonieteHero.elements.filter(
        (element) => element.kind === "image" || element.kind === "shape",
      ),
    } as SectionCanvas;
    expect(canvasStretchAt(same.elements, desktopBox, same.rows, 640, CANVAS_DESIGN_WIDTH_PX)).toBe(1);
  });
});

describe("rusztowanie kreatora nie jest treścią strony (S-50)", () => {
  const geometry = { x: 0, y: 0, w: 20, h: 10, z: 0 };

  it("kafel zdjęcia BEZ zdjęcia nie jest publikowalny", () => {
    const pusty = createElement("image", "pusty", geometry, "pl");
    expect(isEmptyImageElement(pusty)).toBe(true);
    expect(isPublishableElement(pusty)).toBe(false);
  });

  it("kafel ze zdjęciem — jest (kontrola pozytywna)", () => {
    const pelny = {
      ...createElement("image", "pelny", geometry, "pl"),
      source: { kind: "storage", path: "tenant/hero.jpg" },
    } as CanvasElement;
    expect(isPublishableElement(pelny)).toBe(true);
  });

  it("kafel ZWIĄZANY ze zdjęciem sprzętu jest publikowalny mimo braku źródła", () => {
    // Zdjęcie przyjdzie z katalogu przy renderze — brak własnego źródła nie
    // jest tu brakiem treści, tylko sposobem, w jaki ta treść się bierze.
    const zwiazany = canvasElementSchema.parse({
      ...createElement("image", "zwiazany", geometry, "pl"),
      bindings: { source: { record: { kind: "pageProduct" }, field: "image" } },
    });
    expect(isPublishableElement(zwiazany)).toBe(true);
  });

  it("napis ZWIĄZANY z katalogiem nie liczy się jako treść startowa", () => {
    const zwiazany = canvasElementSchema.parse({
      ...createElement("heading", "zwiazany-napis", geometry, "pl"),
      bindings: { text: { record: { kind: "pageProduct" }, field: "name" } },
    });
    expect(isStarterCopyElement(zwiazany)).toBe(false);
    expect(isPublishableElement(zwiazany)).toBe(true);
  });

  it.each(["heading", "text"] as const)(
    "%s z treścią startową palety nie jedzie do klienta — w OBU językach",
    (kind) => {
      for (const locale of ["pl", "en"] as const) {
        const swiezy = createElement(kind, `nowy-${locale}`, geometry, locale);
        expect(isStarterCopyElement(swiezy), `${locale}: ${JSON.stringify(swiezy)}`).toBe(true);
        expect(isPublishableElement(swiezy)).toBe(false);
      }
    },
  );

  it("ten sam element po dopisaniu własnego zdania — publikowalny", () => {
    const napisany = {
      ...createElement("text", "napisany", geometry, "pl"),
      text: "Wypożyczamy sprzęt budowlany w Katowicach od 2009 roku.",
    } as CanvasElement;
    expect(isPublishableElement(napisany)).toBe(true);
  });

  it("przycisk z etykietą startową ZOSTAJE — link jest nawigacją, nie zdaniem", () => {
    // Świadome zawężenie: znikający przycisk zabiera ze strony DROGĘ, a nie
    // tylko napis; z pustym adresem rozprawia się ostrzeżenie publikacji.
    const przycisk = createElement("button", "przycisk", geometry, "pl");
    expect(isPublishableElement(przycisk)).toBe(true);
  });

  it.each(PRESETY)("%s: preset sekcji publikuje się w CAŁOŚCI", (_typ, canvas) => {
    // Kontrola po fałszywie dodatnim: gdyby reguła łapała treść presetów,
    // szablon startowy gubiłby elementy w chwili publikacji.
    const zgubione = canvas.elements.filter((element) => !isPublishableElement(element));
    expect(zgubione.map((element) => element.id)).toEqual([]);
  });
});
