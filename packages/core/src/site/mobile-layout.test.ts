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
import { isContentElement, renderLayerZ } from "./canvas-render";
import {
  CANVAS_COLUMNS,
  CANVAS_CONTENT_COLUMNS,
  CANVAS_PAD_COLUMNS,
  MOBILE_DESIGN_WIDTH_PX,
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

/**
 * TREŚĆ NIE ZNIKA NA TELEFONIE (ADR-274, audyt UX 2026-08-25).
 *
 * Na produkcji (`/audyt-c`) sekcja hero przy 390 px była PUSTA: widać było
 * wyłącznie biały prostokąt. Przyczyną nie było zgubienie elementów — każdy
 * z nich miał swoje pudełko, a kontrakt „KAŻDY element ma miejsce" świecił na
 * zielono. Przyczyną było to, że kształt DOTYKAJĄCY rogiem akapitu został
 * uznany za podkład CAŁEJ nierozdzielnej grupy, dostał jej wysokość i — mając
 * najwyższe zapisane `z` — przykrył komplet treści.
 *
 * Stąd dwie nogi: reguła podkładu wymaga OBJĘCIA, a nie dotknięcia, a to, co
 * automat uzna za podkład, render zatapia pod treścią.
 */
describe("kształt nie zasłania treści, którą tylko musnął", () => {
  const musnietyLead: SectionCanvas = {
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
        // Zahacza o lead prawym końcem — i NIC poza tym.
        layout: { desktop: { x: 80, y: 39, w: 40, h: 12, z: 7 } },
      },
    ],
  } as SectionCanvas;

  it("kształt, który tylko NACHODZI, nie zostaje podkładem", () => {
    const layout = mobileLayoutOf(musnietyLead);
    expect(layout.backdrops.has("ksztalt"), "muśnięcie wystarczyło za objęcie").toBe(false);
  });

  it("…więc nie rozciąga się na całą sekcję", () => {
    // Kontrola ILOŚCIOWA: podkład dostawał wysokość CAŁEJ grupy, czyli prawie
    // całe płótno. Zwykły element bierze tyle, ile ma na desktopie.
    const layout = mobileLayoutOf(musnietyLead);
    expect(layout.boxes["ksztalt"]!.h).toBeLessThan(layout.rows / 2);
  });

  it("kształt, który OBEJMUJE treść, podkładem zostaje (kontrola pozytywna)", () => {
    const karta = {
      ...musnietyLead,
      elements: musnietyLead.elements.map((element) =>
        element.id === "ksztalt"
          ? ({
              ...element,
              layout: { desktop: { x: 8, y: 10, w: 128, h: 40, z: 7 } },
            } as CanvasElement)
          : element,
      ),
    } as SectionCanvas;
    const layout = mobileLayoutOf(karta);
    expect(layout.backdrops.has("ksztalt")).toBe(true);
  });

  it("ręczna poprawka odbiera rolę podkładu — pudełko wraca do operatora", () => {
    const karta = {
      ...musnietyLead,
      elements: musnietyLead.elements.map((element) =>
        element.id === "ksztalt"
          ? ({
              ...element,
              layout: {
                desktop: { x: 8, y: 10, w: 128, h: 40, z: 7 },
                mobile: { x: 12, y: 4, w: 60, h: 20, z: 7 },
              },
            } as CanvasElement)
          : element,
      ),
    } as SectionCanvas;
    const layout = mobileLayoutOf(karta);
    expect(layout.backdrops.has("ksztalt")).toBe(false);
    expect(layout.detached.has("ksztalt")).toBe(true);
  });

  it("podkład NIE przykrywa zdjęcia, które leży w tej samej karcie", () => {
    /*
     * Osobna noga, bo ogólny niezmiennik niżej pyta o TREŚĆ CZYTELNĄ, a ta jest
     * nad dekoracją z definicji pasma. Zatopienie podkładu rozstrzyga kolizję
     * WEWNĄTRZ dekoracji: kafel z wysokim `z` obejmuje na telefonie CAŁĄ grupę,
     * więc bez zatopienia zasłania zdjęcie, które podkłada — a zdjęcie w karcie
     * opinii jest tam całą treścią wizualną.
     */
    const karta: SectionCanvas = {
      version: 2,
      rows: 60,
      background: "default",
      elements: [
        {
          id: "kafel",
          kind: "shape",
          shape: "box",
          fill: "paper",
          layout: { desktop: { x: 8, y: 8, w: 128, h: 44, z: 9 } },
        },
        {
          id: "portret",
          kind: "image",
          alt: "Klient przy odbiorze sprzętu",
          fit: "cover",
          source: { kind: "storage", path: "tenant/opinia.jpg" },
          layout: { desktop: { x: 12, y: 12, w: 40, h: 30, z: 1 } },
        },
        {
          id: "opinia",
          kind: "text",
          variant: "body",
          align: "left",
          text: "Sprzęt przyjechał na budowę o siódmej rano, dokładnie jak umówiliśmy.",
          layout: { desktop: { x: 56, y: 12, w: 72, h: 12, z: 2 } },
        },
      ],
    } as SectionCanvas;

    const layout = mobileLayoutOf(karta);
    expect(layout.backdrops.has("kafel"), "kafel nie został uznany za podkład").toBe(true);
    const warstwy = renderLayerZ(karta.elements, layout.backdrops);
    expect(
      warstwy["portret"]!,
      "podkład karty maluje się nad zdjęciem, które podkłada",
    ).toBeGreaterThan(warstwy["kafel"]!);

    // Kontrola negatywna: BEZ zatopienia ten sam kafel jest na wierzchu.
    const bez = renderLayerZ(karta.elements);
    expect(bez["portret"]!).toBeLessThan(bez["kafel"]!);
  });

  it.each(CASES)("%s: nic z dekoracji nie stoi NAD treścią na telefonie", (_name, canvas) => {
    /*
     * Niezmiennik całego modelu: po nałożeniu warstw renderu (z zatopieniem
     * podkładów) żaden element przecinający pudełko TREŚCI nie ma od niej
     * wyższej warstwy. Sprawdzamy w geometrii MOBILNEJ, bo to ona jest tu
     * wynalazkiem automatu.
     */
    const layout = mobileLayoutOf(canvas);
    const warstwy = renderLayerZ(canvas.elements, layout.backdrops);
    const nad: string[] = [];
    for (const element of canvas.elements) {
      if (!isContentElement(element)) continue;
      const box = layout.boxes[element.id]!;
      for (const inny of canvas.elements) {
        if (inny.id === element.id) continue;
        const other = layout.boxes[inny.id]!;
        const przecina =
          box.x < other.x + other.w &&
          other.x < box.x + box.w &&
          box.y < other.y + other.h &&
          other.y < box.y + box.h;
        if (przecina && warstwy[inny.id]! > warstwy[element.id]!) {
          nad.push(`${inny.id} przykrywa ${element.id}`);
        }
      }
    }
    expect(nad).toEqual([]);
  });
});

/**
 * RYTM KOLUMNY MOBILNEJ (ADR-274) — odstęp z projektu, nie ze stałej.
 *
 * Cztery linie kontaktu w stopce stoją na desktopie 8 px od siebie; auto-układ
 * dawał każdej parze 24 px plus zapas estymatora i stopka rozjeżdżała się na
 * dziury po 45–80 px (audyt UX 2026-08-25). Odstęp bierze się teraz z przerwy
 * W PROJEKCIE, przeliczonej na rozmiar fizyczny i zaciśniętej widełkami.
 */
describe("kolumna mobilna trzyma rytm projektu", () => {
  /*
   * Górne widełki odstępu w pikselach płótna projektowego. 32 px to wartość
   * z modułu; przerwa jest liczona w CAŁYCH jednostkach siatki, więc próg to
   * pierwsza jednostka, która 32 px obejmuje (na 390 px: 12 × 2,708 = 32,5 px).
   */
  const UNIT = MOBILE_DESIGN_WIDTH_PX / CANVAS_COLUMNS;
  const PROG = Math.ceil(32 / UNIT) * UNIT + 1e-6;

  /**
   * PUSTKI W KOLUMNIE, w pikselach płótna projektowego (390 px).
   *
   * Liczymy przerwy między ZLANYMI zakresami pionowymi, a nie między kolejnymi
   * pudełkami. Różnica jest istotna dla karty: jej podkład obejmuje własny
   * rozstaw wewnętrzny, więc odległość od ostatniego zdania w kafelku do
   * pierwszego w następnym NIE jest dziurą — dziurą jest dopiero odstęp między
   * kafelkami. Liczenie „pudełko po pudełku" oskarżałoby układ o pustkę, którą
   * widać jako tło karty.
   */
  function przerwy(canvas: SectionCanvas): number[] {
    const layout = mobileLayoutOf(canvas);
    const unit = MOBILE_DESIGN_WIDTH_PX / CANVAS_COLUMNS;
    const zakresy = canvas.elements
      .map((element) => layout.boxes[element.id]!)
      .map((box) => [box.y, box.y + box.h] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const zlane: [number, number][] = [];
    for (const zakres of zakresy) {
      const ostatni = zlane[zlane.length - 1];
      if (ostatni && zakres[0] <= ostatni[1]) ostatni[1] = Math.max(ostatni[1], zakres[1]);
      else zlane.push([...zakres]);
    }
    const out: number[] = [];
    for (let index = 1; index < zlane.length; index += 1) {
      out.push((zlane[index]![0] - zlane[index - 1]![1]) * unit);
    }
    return out;
  }

  it("stopka: ŻADNA przerwa nie przekracza górnych widełek", () => {
    const gaps = przerwy(canvasFor("footer"));
    expect(gaps.length, "stopka bez par do porównania").toBeGreaterThan(4);
    const zaSzerokie = gaps.filter((gap) => gap > PROG);
    expect(zaSzerokie, `dziury w stopce: ${gaps.map((g) => g.toFixed(0)).join(", ")}`).toEqual([]);
  });

  it("stopka: linie kontaktu stoją CIAŚNIEJ niż domyślny odstęp grup", () => {
    // Kontrola kierunku: gdyby reguła oddawała stałą, ta noga byłaby czerwona.
    const gaps = przerwy(canvasFor("footer"));
    expect(Math.min(...gaps)).toBeLessThan(24);
  });

  it.each(CASES)("%s: przerwy w kolumnie mieszczą się w widełkach", (_name, canvas) => {
    for (const gap of przerwy(canvas)) {
      expect(gap).toBeGreaterThanOrEqual(0);
      expect(gap).toBeLessThanOrEqual(PROG);
    }
  });
});

/**
 * SUFIT WYSOKOŚCI NIE WYRZUCA TREŚCI POZA KADR (ADR-274).
 *
 * `Math.min(SECTION_MAX_ROWS_MOBILE, …)` nie ściskał sekcji — obcinał płótno,
 * a elementy stojące na współrzędnych procentowych wypadały poza nie i ginęły
 * pod `overflow: hidden`. Sekcja wysoka jest widoczna; treść usunięta z kadru
 * nie jest.
 */
describe("wysokie płótno mobilne nie gubi dolnych elementów", () => {
  const wysokie: SectionCanvas = {
    version: 2,
    rows: 240,
    background: "default",
    elements: Array.from({ length: 60 }, (_, index) =>
      createElement(
        "text",
        `akapit-${index}`,
        { x: 12, y: index * 4, w: 120, h: 3, z: index },
        "pl",
      ),
    ).map((element) => ({
      ...element,
      size: { w: "fixed", h: "fixed" },
      text:
        "Wypożyczamy sprzęt budowlany na dobę, tydzień albo cały etap budowy — z dowozem na plac, " +
        "przeglądem po każdym zwrocie i fakturą VAT wystawianą tego samego dnia, bez papierologii.",
    })) as SectionCanvas["elements"],
  };

  it("automat przekracza dawny sufit (kontrola pozytywna wejścia)", () => {
    expect(mobileLayoutOf(wysokie).rows).toBeGreaterThan(SECTION_MAX_ROWS_MOBILE);
  });

  it("…i mimo to KAŻDE pudełko mieści się w płótnie", () => {
    const layout = mobileLayoutOf(wysokie);
    const poza = Object.entries(layout.boxes)
      .filter(([, box]) => box.y + box.h > layout.rows)
      .map(([id]) => id);
    expect(poza, "elementy wypchnięte poza kadr sufitem wysokości").toEqual([]);
  });
});
