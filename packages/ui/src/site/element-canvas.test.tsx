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
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import { SECTION_TYPES, presetContentFor, type SectionType } from "@avably/core/site";
import type { RenderSection } from "./types";

const TEMPLATES = ["classic", "bold"] as const;

function renderCanvas(canvas: SectionCanvas, template: (typeof TEMPLATES)[number] = "classic") {
  const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
  return render(<SiteRenderer sections={sections} template={template} />);
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
    // 36 / 144 = 25 %, 72 / 144 = 50 %.
    expect(box!.style.left).toBe("25%");
    expect(box!.style.width).toBe("50%");
  });

  it("oś pionowa też jest PROCENTEM płótna (K2c, ADR-087)", () => {
    const { container } = renderCanvas(singleElement);
    const box = container.querySelector<HTMLElement>('[data-element-id="h1"]');
    // 8 / 40 = 20 %, 12 / 40 = 30 % wysokości płótna o 40 jednostkach.
    expect(box!.style.top).toBe("20%");
    expect(box!.style.height).toBe("30%");
  });

  it("wysokość PŁÓTNA wynika z SZEROKOŚCI — jednostka jest kwadratowa wszędzie", () => {
    const { container } = renderCanvas(singleElement);
    const grid = container.querySelector<HTMLElement>("[data-canvas-grid]");
    // Proporcja 144 : 40 daje wysokość 40 × (szerokość / 144), czyli dokładnie
    // czterdzieści jednostek o boku równym kolumnie — przy KAŻDEJ szerokości.
    // Stała wysokość w pikselach trzymała pion w miejscu, gdy poziom się zwężał.
    expect(grid!.style.aspectRatio).toBe("144 / 40");
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
    expect(top!.style.zIndex).toBe("5");
  });
});

describe("kontrakt: konwersja KAŻDEGO typu renderuje się w OBU szablonach", () => {
  it("lista typów nie jest pusta (kontrola po pustym zbiorze)", () => {
    expect(SECTION_TYPES.length).toBe(12);
  });

  const combinations = SECTION_TYPES.flatMap((type) =>
    TEMPLATES.map((template) => [type, template] as const),
  );

  it.each(combinations)("%s w szablonie %s rysuje wszystkie swoje elementy", (type, template) => {
    const canvas = sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl"));
    const { container } = renderCanvas(canvas, template);
    const drawn = container.querySelectorAll("[data-element-id]");
    // Sedno porównania typów ze sobą: liczba narysowanych pudełek musi zgadzać
    // się z liczbą elementów płótna. Typ, który gubi element w rendererze
    // (brak gałęzi w przełączniku), wypada tu z szeregu.
    expect(drawn.length, `${type}/${template}: narysowano ${drawn.length} z ${canvas.elements.length}`).toBe(
      canvas.elements.length,
    );
  });

  it.each(combinations)("%s w szablonie %s niesie widoczny tekst", (type, template) => {
    const canvas = sectionCanvasFrom(type as SectionType, presetContentFor(type as SectionType, "pl"));
    const { container } = renderCanvas(canvas, template);
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
    const { container } = render(<SiteRenderer sections={sections} template="classic" />);
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
    const { container } = render(<SiteRenderer sections={sections} template="bold" />);
    expect(container.querySelectorAll("[data-canvas-grid]")).toHaveLength(1);
    expect(container.textContent).toContain("Cennik v1");
  });
});
