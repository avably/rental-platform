/**
 * PRIORYTET POBIERANIA IDZIE ZA MIEJSCEM NA STRONIE (S-39 audytu 2026-08-25).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Priorytety były przypisane do RODZAJU sekcji: zdjęcie płótna zawsze leniwe
 * (także hero nad zgięciem), pierwsza karta sprzętu zawsze łapczywa
 * z `fetchPriority="high"` (także 1200 px niżej). Obie wady na jednej stronie
 * dają dokładnie odwrotny efekt niż zamierzony: element LCP czeka, a obraz spod
 * zgięcia dostaje pierwszeństwo w paśmie.
 *
 * ==================== MUTACJE, KTÓRE MAJĄ TU SPŁONĄĆ ====================
 *
 *   1. `imagePriority` nie dociera do płótna → hero znów leniwe (test 1),
 *   2. warunek karty wraca do samego `index === 0` → karta pod hero znów
 *      `high` (test 1, asercja negatywna),
 *   3. priorytet rozlewa się na WIĘCEJ niż jeden obraz (test 4),
 *   4. reguła oddaje priorytet sekcji, która NIE jest pierwsza z obrazem
 *      (testy 2 i 3),
 *   5. sekcja bez zdjęć „zjada" priorytet i nie dostaje go nikt (test 3).
 *
 * Asercje idą po HTML-u, nie po propsach: `loading` i `fetchPriority` są
 * atrybutami, na które patrzy przeglądarka, a nie polami, które ktoś przekazał.
 */
import { presetContentFor, type SectionCanvas } from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { priorityImageSectionId, sectionImagePaint } from "./image-priority";
import { SiteRenderer } from "./site-renderer";
import type { RenderSection, StorefrontProduct } from "./types";

const BASE = "https://example.supabase.co/storage/v1/object/public/site-images";

const produkt = (id: string, imageUrl: string | null): StorefrontProduct =>
  ({
    id,
    name: `Sprzęt ${id}`,
    priceLabel: "od 100,00 zł",
    imageUrl,
    imageAlt: `Sprzęt ${id}`,
    description: null,
    href: `/produkt/${id}`,
  }) as StorefrontProduct;

/** Płótno v2 ze zdjęciem ze Storage — kształt, w którym kreator zapisuje hero. */
function canvasZeZdjeciem(): SectionCanvas {
  return {
    version: 2,
    rows: 12,
    background: "default",
    elements: [
      {
        id: "el-img",
        kind: "image",
        source: { kind: "storage", path: "t/hero.webp" },
        alt: "",
        fit: "cover",
        layout: { desktop: { x: 0, y: 0, w: 24, h: 12, z: 0 } },
      },
      {
        id: "el-head",
        kind: "heading",
        level: 1,
        text: "Wynajmij sprzęt",
        align: "left",
        layout: { desktop: { x: 2, y: 4, w: 12, h: 2, z: 1 } },
      },
    ],
  } as unknown as SectionCanvas;
}

const heroCanvas = (id = "s-hero"): RenderSection =>
  ({ id, position: 0, type: "hero", content: canvasZeZdjeciem() }) as RenderSection;

const produktyV1 = (id = "s-products"): RenderSection =>
  ({ id, position: 1, type: "products", content: presetContentFor("products", "pl") }) as RenderSection;

const faq = (id = "s-faq"): RenderSection =>
  ({ id, position: 0, type: "faq", content: presetContentFor("faq", "pl") }) as RenderSection;

function render(sections: RenderSection[], products: StorefrontProduct[]): string {
  return renderToStaticMarkup(
    <SiteRenderer sections={sections} products={products} siteImageBase={BASE} />,
  );
}

/** Atrybuty każdego `<img>` w kolejności dokumentu. */
function obrazy(html: string): { src: string; loading: string; priority: string }[] {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((match) => {
    const tag = match[0];
    // React 19 wypisuje `fetchPriority` wielbłądem — dopasowanie bez względu
    // na wielkość liter, żeby test nie mierzył konwencji serializatora.
    const attr = (name: string) => new RegExp(`${name}="([^"]*)"`, "i").exec(tag)?.[1] ?? "";
    return { src: attr("src"), loading: attr("loading"), priority: attr("fetchpriority") };
  });
}

describe("pierwszy obraz strony dostaje priorytet", () => {
  it("hero z płótna NAD sekcją sprzętu: hero łapczywe, karta leniwa", () => {
    const html = render([heroCanvas(), produktyV1()], [produkt("p1", `${BASE}/p1.webp`)]);
    const lista = obrazy(html);

    expect(lista.length, "render bez obrazów — asercje po pustym zbiorze").toBeGreaterThanOrEqual(2);

    const hero = lista.find((img) => img.src.includes("hero.webp"));
    const karta = lista.find((img) => img.src.includes("p1.webp"));

    expect(hero, "zdjęcie hero nie wyrenderowało się").toBeDefined();
    expect(hero!.loading, "hero nad zgięciem dalej leniwe — element LCP czeka").toBe("eager");
    expect(hero!.priority).toBe("high");

    expect(karta, "karta sprzętu nie wyrenderowała się").toBeDefined();
    expect(karta!.loading, "karta 1200 px niżej dalej łapczywa").toBe("lazy");
    expect(karta!.priority, "karta pod zgięciem zabiera pasmo obrazowi na ekranie").toBe("");
  });

  it("sekcja sprzętu PIERWSZA: to jej karta dostaje priorytet", () => {
    const html = render([produktyV1("s-products")], [produkt("p1", `${BASE}/p1.webp`)]);
    const karta = obrazy(html).find((img) => img.src.includes("p1.webp"));

    expect(karta).toBeDefined();
    expect(karta!.loading).toBe("eager");
    expect(karta!.priority).toBe("high");
  });

  it("sekcja BEZ obrazów nie zabiera priorytetu sekcji pod sobą", () => {
    const html = render([faq(), produktyV1()], [produkt("p1", `${BASE}/p1.webp`)]);
    const karta = obrazy(html).find((img) => img.src.includes("p1.webp"));

    expect(karta).toBeDefined();
    expect(karta!.loading, "FAQ zjadło priorytet pierwszego obrazu").toBe("eager");
  });

  it("priorytet dostaje DOKŁADNIE JEDEN obraz na stronie", () => {
    const html = render(
      [heroCanvas(), produktyV1()],
      [produkt("p1", `${BASE}/p1.webp`), produkt("p2", `${BASE}/p2.webp`)],
    );

    const zPriorytetem = obrazy(html).filter((img) => img.priority === "high");
    expect(zPriorytetem, "priorytet rozlał się na kilka obrazów").toHaveLength(1);
  });

  it("strona bez ani jednego obrazu nie wystawia priorytetu nikomu", () => {
    const html = render([faq(), produktyV1()], [produkt("p1", null)]);

    expect(obrazy(html).filter((img) => img.priority === "high")).toHaveLength(0);
  });
});

describe("reguła jako funkcja czysta", () => {
  it("galeria MALUJE obraz, ale priorytetu nie niesie — i nie oddaje go dalej", () => {
    // Preset galerii jest PUSTY (operator sam wgrywa zdjęcia), więc kafle
    // trzeba dołożyć — inaczej test mierzyłby sekcję bez ani jednego obrazu.
    const galeria = {
      id: "s-gal",
      position: 0,
      type: "gallery",
      content: { heading: "Nasze realizacje", items: [{ imagePath: "t/a.webp", alt: "" }] },
    } as unknown as RenderSection;

    const dane = { products: [produkt("p1", `${BASE}/p1.webp`)], categories: [], siteImageBase: BASE };

    // Kontrola przyrządu: preset galerii naprawdę ma kafle.
    expect(sectionImagePaint(galeria, dane)).toBe("opaque");
    expect(
      priorityImageSectionId([galeria, produktyV1()], dane),
      "priorytet przeskoczył galerię i wylądował pod zgięciem",
    ).toBeNull();
  });

  it("zdjęcie sekcji BEZ prefiksu bucketa nie liczy się jako obraz (kafel zastępczy)", () => {
    const dane = { products: [], categories: [] };
    expect(sectionImagePaint(heroCanvas(), dane)).toBe("none");
    expect(sectionImagePaint(heroCanvas(), { ...dane, siteImageBase: BASE })).toBe("carry");
  });

  it("sekcja sprzętu bez zdjęcia pierwszej pozycji nie jest sekcją z obrazem", () => {
    const dane = { products: [produkt("p1", null)], categories: [], siteImageBase: BASE };
    expect(sectionImagePaint(produktyV1(), dane)).toBe("none");
  });
});
