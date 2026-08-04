/**
 * RENDER PŁÓTNA v2 (K2, ADR-084) — kontrakt prezentacyjny.
 *
 * Broni trzech rzeczy, których nie widać w schemacie treści:
 *   1. GEOMETRIA TRAFIA DO CSS — oś pozioma jako procent PŁÓTNA, pionowa jako
 *      piksele jednostki; pomyłka w przeliczeniu wygląda na stronie jak „układ
 *      się rozjechał", a w kodzie jak jedna literówka;
 *   2. KONWERSJA KAŻDEGO Z DWUNASTU TYPÓW RENDERUJE SIĘ W OBU SZABLONACH —
 *      kontrakt pyta typy o to samo i porównuje je ZE SOBĄ, więc typ, który
 *      renderuje pustkę, wypada z szeregu zamiast przechodzić własnym testem;
 *   3. DWUTOROWOŚĆ — ten sam renderer bierze treść v1 i v2, rozstrzygając po
 *      `version`, a nie po typie sekcji.
 */
import { sectionCanvasFrom, type SectionCanvas } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import { SECTION_TYPES, presetContentFor, type SectionType } from "@avably/core/site";
import type { RenderSection } from "./types";

function renderCanvas(canvas: SectionCanvas) {
  const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
  return render(<SiteRenderer sections={sections} />);
}

const singleElement: SectionCanvas = {
  version: 2,
  rows: 40,
  background: "default",
  elements: [
    {
      id: "h1",
      kind: "heading",
      text: "Sprzęt na już",
      level: 1,
      align: "left",
      layout: { desktop: { x: 36, y: 8, w: 72, h: 12, z: 0 } },
    },
  ],
};

describe("geometria elementu trafia do stylu pudełka", () => {
  it("oś pozioma jest PROCENTEM płótna, a nie pikselami", () => {
    const { container } = renderCanvas(singleElement);
    const box = container.querySelector<HTMLElement>('[data-element-id="h1"]');
    expect(box).not.toBeNull();
    // 36 / 144 = 25 %, 72 / 144 = 50 %. Od K4 (ADR-088) współrzędne jadą
    // właściwościami niestandardowymi, bo w jednym drzewie są DWA układy —
    // arkusz podmienia komplet poniżej progu 40 rem.
    expect(box!.style.getPropertyValue("--el-x")).toBe("25%");
    expect(box!.style.getPropertyValue("--el-w")).toBe("50%");
  });

  it("oś pionowa też jest PROCENTEM płótna (K2c, ADR-087)", () => {
    const { container } = renderCanvas(singleElement);
    const box = container.querySelector<HTMLElement>('[data-element-id="h1"]');
    // 8 / 40 = 20 %, 12 / 40 = 30 % wysokości płótna o 40 jednostkach.
    expect(box!.style.getPropertyValue("--el-y")).toBe("20%");
    expect(box!.style.getPropertyValue("--el-h")).toBe("30%");
  });

  it("wysokość PŁÓTNA wynika z SZEROKOŚCI — jednostka jest kwadratowa wszędzie", () => {
    const { container } = renderCanvas(singleElement);
    const grid = container.querySelector<HTMLElement>("[data-canvas-grid]");
    // Proporcja 144 : 40 daje wysokość 40 × (szerokość / 144), czyli dokładnie
    // czterdzieści jednostek o boku równym kolumnie — przy KAŻDEJ szerokości.
    // Stała wysokość w pikselach trzymała pion w miejscu, gdy poziom się zwężał.
    expect(grid!.style.getPropertyValue("--canvas-ratio")).toBe("144 / 40");
    expect(grid!.style.height, "wysokość znowu stoi w pikselach").toBe("");
  });

  it("płótno PRZYCINA zawartość — element nie rozjedzie publicznej strony", () => {
    const { container } = renderCanvas(singleElement);
    const grid = container.querySelector<HTMLElement>("[data-canvas-grid]");
    expect(grid!.className.split(/\s+/)).toContain("overflow-hidden");
    // Własny kontekst układania: warstwa `z` treści tenanta (do 999) nie ma
    // jak przebić się nad interfejs panelu.
    expect(grid!.className.split(/\s+/)).toContain("isolate");
  });
});

describe("warstwy decydują o KOLEJNOŚCI malowania", () => {
  const layered: SectionCanvas = {
    version: 2,
    rows: 40,
    background: "default",
    elements: [
      {
        id: "gora",
        kind: "heading",
        text: "Na wierzchu",
        level: 2,
        align: "left",
        layout: { desktop: { x: 0, y: 0, w: 40, h: 10, z: 5 } },
      },
      {
        id: "dol",
        kind: "shape",
        shape: "box",
        fill: "paper",
        layout: { desktop: { x: 0, y: 0, w: 40, h: 10, z: 1 } },
      },
    ],
  };

  it("element o niższej warstwie rysuje się WCZEŚNIEJ, mimo dalszej pozycji w tablicy", () => {
    const { container } = renderCanvas(layered);
    const ids = [...container.querySelectorAll("[data-element-id]")].map((node) =>
      node.getAttribute("data-element-id"),
    );
    expect(ids).toEqual(["dol", "gora"]);
  });

  it("warstwa trafia do `z-index`, a nie tylko do kolejności w DOM", () => {
    const { container } = renderCanvas(layered);
    const top = container.querySelector<HTMLElement>('[data-element-id="gora"]');
    expect(top!.style.getPropertyValue("--el-z")).toBe("5");
    // Warstwa jest ta sama na obu breakpointach — „na wierzch" znaczy to samo
    // na telefonie, co na desktopie (K4, ADR-088).
    expect(top!.style.getPropertyValue("--el-mz")).toBe("5");
  });
});

describe("kontrakt: konwersja KAŻDEGO typu renderuje się w OBU szablonach", () => {
  it("lista typów nie jest pusta (kontrola po pustym zbiorze)", () => {
    expect(SECTION_TYPES.length).toBe(13);
  });

  // Macierz idzie po TYPACH sekcji; wygląd niesie motyw jako zmienne (ADR-090),
  // więc drugi wymiar „szablon graficzny" zniknął razem z samym pojęciem.
  it.each(SECTION_TYPES)("%s rysuje wszystkie swoje elementy", (type) => {
    const canvas = sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl"));
    const { container } = renderCanvas(canvas);
    const drawn = container.querySelectorAll("[data-element-id]");
    // Sedno porównania typów ze sobą: liczba narysowanych pudełek musi zgadzać
    // się z liczbą elementów płótna. Typ, który gubi element w rendererze
    // (brak gałęzi w przełączniku), wypada tu z szeregu.
    expect(drawn.length, `${type}: narysowano ${drawn.length} z ${canvas.elements.length}`).toBe(
      canvas.elements.length,
    );
  });

  it.each(SECTION_TYPES)("%s niesie widoczny tekst", (type) => {
    const canvas = sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl"));
    const { container } = renderCanvas(canvas);
    // Sekcja bez ani jednego znaku to sekcja, której operator nie rozpozna na
    // płótnie — a taki jest właśnie objaw renderu, który „coś" narysował.
    expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0);
  });
});

describe("dwutorowość: jeden renderer, dwie generacje treści", () => {
  it("treść v1 nadal renderuje się STARYM komponentem sekcji", () => {
    const sections = [
      { id: "s1", position: 0, type: "hero", content: { heading: "Stara sekcja" } },
    ] as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);
    expect(container.textContent).toContain("Stara sekcja");
    // Brak płótna = brak konwersji w locie: sekcje sprzed K2 zostają v1 do
    // chwili, w której ich treść naprawdę przejdzie konwersję.
    expect(container.querySelector("[data-canvas-grid]")).toBeNull();
  });

  it("o wersji decyduje TREŚĆ, nie typ sekcji", () => {
    const canvas = sectionCanvasFrom("pricing", presetContentFor("pricing", "pl"));
    const sections = [
      { id: "s1", position: 0, type: "pricing", content: canvas },
      { id: "s2", position: 1, type: "pricing", content: { heading: "Cennik v1" } },
    ] as RenderSection[];
    const { container } = render(<SiteRenderer sections={sections} />);
    expect(container.querySelectorAll("[data-canvas-grid]")).toHaveLength(1);
    expect(container.textContent).toContain("Cennik v1");
  });
});

/**
 * ZDJĘCIA: DWA ŹRÓDŁA I ZGODNOŚĆ WSTECZ (K3, ADR-086).
 *
 * Render pyta o źródło JEDNĄ funkcją (`normalizeImageSource`), więc to tutaj
 * widać, czy treść sprzed K3 — niosąca gołe `imagePath` — nadal pokazuje
 * zdjęcie. Bez tej nogi wycięcie odczytu starego pola przechodziło przez cały
 * pakiet na zielono (mutacja recenzji PM do PR #156), a najemca, który wgrał
 * zdjęcie przed K3, zobaczyłby pusty kafel.
 */
describe("zdjęcie: skąd render bierze adres", () => {
  const BASE = "https://storage.example.com/site-images";

  function imageCanvas(image: Record<string, unknown>): SectionCanvas {
    return {
      version: 2,
      rows: 40,
      background: "default",
      elements: [
        {
          id: "img1",
          kind: "image",
          alt: "Koparka gąsienicowa",
          fit: "cover",
          layout: { desktop: { x: 0, y: 0, w: 40, h: 20, z: 0 } },
          ...image,
        },
      ] as SectionCanvas["elements"],
    };
  }

  function renderImage(canvas: SectionCanvas) {
    const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
    return render(<SiteRenderer sections={sections} siteImageBase={BASE} />);
  }

  it("treść SPRZED K3 (samo `imagePath`) nadal pokazuje zdjęcie", () => {
    const { container } = renderImage(imageCanvas({ imagePath: "tenant/hero.jpg" }));
    const img = container.querySelector("img");
    expect(img, "element sprzed K3 przestał renderować zdjęcie").not.toBeNull();
    expect(img?.getAttribute("src")).toBe(`${BASE}/tenant/hero.jpg`);
    expect(img?.getAttribute("alt")).toBe("Koparka gąsienicowa");
  });

  it("treść po K3 (`source: storage`) buduje ten sam adres", () => {
    const { container } = renderImage(imageCanvas({ source: { kind: "storage", path: "tenant/hero.jpg" } }));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(`${BASE}/tenant/hero.jpg`);
  });

  it("hotlink idzie WPROST do dostawcy i niesie widoczną atrybucję", () => {
    // Atrybucja jest warunkiem licencji — nie da się wystawić zdjęcia bez niej,
    // bo podpis siedzi w tym samym pudełku co obraz.
    const { container } = renderImage(
      imageCanvas({
        source: {
          kind: "unsplash",
          url: "https://images.example.com/photo.jpg",
          authorName: "Jan Kowalski",
          authorUrl: "https://example.com/@jan?utm_source=avably&utm_medium=referral",
          downloadLocation: "https://api.unsplash.com/photos/abc/download",
        },
      }),
    );
    expect(container.querySelector("img")?.getAttribute("src")).toBe("https://images.example.com/photo.jpg");
    const credit = container.querySelector("[data-image-credit]");
    expect(credit, "hotlink bez atrybucji autora").not.toBeNull();
    expect(credit?.textContent).toContain("Jan Kowalski");
    expect(credit?.querySelector("a")?.getAttribute("href")).toContain("utm_source=avably");
  });

  it("element bez źródła zostaje kafelkiem zastępczym, nie znika z układu", () => {
    const { container } = renderImage(imageCanvas({}));
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-element-id="img1"]')).not.toBeNull();
  });
});

/**
 * PUDEŁKO OBEJMUJE TREŚĆ (K4, ADR-088; decyzja właściciela 2026-08-03).
 *
 * Wymiar `hug` nie ma być liczbą w stylu — ma być `max-content`. To jest cała
 * różnica między „przycisk stoi w pasie na całą szerokość" a „pudełko jest
 * przyciskiem", i tylko w tej drugiej postaci ramka zaznaczenia kreatora może
 * równać się temu, co widać.
 */
describe("wymiar z treści zamiast z geometrii", () => {
  function hugCanvas(size: { w: "fixed" | "hug"; h: "fixed" | "hug" }): SectionCanvas {
    return {
      version: 2,
      rows: 40,
      background: "default",
      elements: [
        {
          id: "cta",
          kind: "button",
          label: "Zobacz katalog",
          href: "#katalog",
          variant: "solid",
          align: "left",
          size,
          layout: { desktop: { x: 12, y: 8, w: 120, h: 7, z: 0 } },
        },
      ] as SectionCanvas["elements"],
    };
  }

  it("wymiar JAWNY nadal jedzie procentem płótna", () => {
    const { container } = renderCanvas(hugCanvas({ w: "fixed", h: "fixed" }));
    const box = container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    expect(box.style.getPropertyValue("--el-w")).toBe(`${(120 / 144) * 100}%`);
    expect(box.style.getPropertyValue("--el-h")).toBe(`${(7 / 40) * 100}%`);
  });

  it("wymiar Z TREŚCI zamienia procent na `max-content` — na OBU breakpointach", () => {
    const { container } = renderCanvas(hugCanvas({ w: "hug", h: "hug" }));
    const box = container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    expect(box.style.getPropertyValue("--el-w")).toBe("max-content");
    expect(box.style.getPropertyValue("--el-h")).toBe("max-content");
    expect(box.style.getPropertyValue("--el-mw")).toBe("max-content");
    expect(box.style.getPropertyValue("--el-mh")).toBe("max-content");
  });

  it("tryb działa PER OŚ — szerokość jawna, wysokość z treści", () => {
    const { container } = renderCanvas(hugCanvas({ w: "fixed", h: "hug" }));
    const box = container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    expect(box.style.getPropertyValue("--el-w")).toBe(`${(120 / 144) * 100}%`);
    expect(box.style.getPropertyValue("--el-h")).toBe("max-content");
  });

  it("pudełko z treści ma SUFIT do prawej krawędzi płótna", () => {
    // Bez sufitu długi napis wyjechałby poza sekcję zamiast się zawinąć —
    // a płótno przycina zawartość, więc ogon zniknąłby bez śladu.
    const { container } = renderCanvas(hugCanvas({ w: "hug", h: "hug" }));
    const box = container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    // x = 12 ze 144 kolumn, więc do prawej krawędzi zostaje 100 − 8,33 %.
    expect(box.style.getPropertyValue("--el-maxw")).toBe(`${100 - (12 / 144) * 100}%`);
  });

  it("przycisk z treści NIE ma owijki rozpychającej go na całe pudełko", () => {
    // `size-full` w pudełku obejmującym treść znaczyłoby „sto procent
    // z wysokości, która wynika ze mnie" — pętla, którą przeglądarka
    // rozstrzyga zerem albo zignorowaniem reguły.
    const hug = renderCanvas(hugCanvas({ w: "hug", h: "hug" }));
    const hugBox = hug.container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    expect(hugBox.querySelector("span")).toBeNull();
    expect(hugBox.firstElementChild?.tagName).toBe("A");

    cleanup();

    const fixed = renderCanvas(hugCanvas({ w: "fixed", h: "fixed" }));
    const fixedBox = fixed.container.querySelector<HTMLElement>('[data-element-id="cta"]')!;
    // Kontrola pozytywna: przy wymiarze jawnym owijka wyrównująca ZOSTAJE.
    expect(fixedBox.firstElementChild?.tagName).toBe("SPAN");
    expect(fixedBox.querySelector("span")!.className.split(/\s+/)).toContain("size-full");
  });
});

/**
 * DRUGI UKŁAD JEST WYLICZANY, NIE ZAPISANY (K4, ADR-088).
 *
 * Renderer nie czeka na to, aż ktoś „zrobi wersję mobilną": liczy ją czystą
 * funkcją z treści desktopowej. Dowód, że tak jest naprawdę, a nie tylko
 * w komentarzu: sekcja BEZ ani jednej zapisanej geometrii mobilnej i tak
 * wystawia komplet współrzędnych mobilnych, i to INNY niż desktopowy.
 */
describe("układ mobilny wychodzi z treści desktopowej", () => {
  it("sekcja bez ręcznych poprawek ma pełny komplet współrzędnych mobilnych", () => {
    const canvas = sectionCanvasFrom("usp", presetContentFor("usp", "pl"));
    expect(
      canvas.elements.every((element) => element.layout.mobile === undefined),
      "preset niesie zapisaną geometrię mobilną — ta noga nie ma czego dowodzić",
    ).toBe(true);

    const { container } = renderCanvas(canvas);
    const boxes = [...container.querySelectorAll<HTMLElement>("[data-element-id]")];
    expect(boxes.length).toBe(canvas.elements.length);
    for (const box of boxes) {
      expect(box.style.getPropertyValue("--el-mx")).not.toBe("");
      expect(box.style.getPropertyValue("--el-my")).not.toBe("");
    }
    // Układ mobilny jest INNY: atuty stoją na desktopie w trzech kolumnach,
    // a na telefonie jeden pod drugim.
    const rozne = boxes.filter(
      (box) => box.style.getPropertyValue("--el-x") !== box.style.getPropertyValue("--el-mx"),
    );
    expect(rozne.length, "układ mobilny jest kopią desktopowego").toBeGreaterThan(0);
  });

  it("RĘCZNA poprawka trafia do współrzędnych mobilnych, a desktopowe zostawia", () => {
    const base = sectionCanvasFrom("hero", presetContentFor("hero", "pl"));
    const target = base.elements[0]!;
    const canvas: SectionCanvas = {
      ...base,
      elements: base.elements.map((element) =>
        element.id === target.id
          ? ({
              ...element,
              layout: { ...element.layout, mobile: { x: 24, y: 30, w: 96, h: 20, z: 0 } },
            } as SectionCanvas["elements"][number])
          : element,
      ),
    };

    const { container } = renderCanvas(canvas);
    const box = container.querySelector<HTMLElement>(`[data-element-id="${target.id}"]`)!;
    expect(box.style.getPropertyValue("--el-mx")).toBe(`${(24 / 144) * 100}%`);
    expect(box.style.getPropertyValue("--el-x")).toBe(
      `${(target.layout.desktop.x / 144) * 100}%`,
    );
  });
});
