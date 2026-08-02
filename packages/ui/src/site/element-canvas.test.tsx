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
    return render(<SiteRenderer sections={sections} template="classic" siteImageBase={BASE} />);
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
