/**
 * PIERWSZY OBRAZ STRONY DOSTAJE PRIORYTET — reguła, nie stała (S-39 audytu
 * 2026-08-25).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Priorytety pobierania były PRZYPISANE NA SZTYWNO do rodzaju sekcji, a nie do
 * jej MIEJSCA na stronie, i wychodziły z tego odwrotnie, niż powinny:
 *
 *   • zdjęcie hero na płótnie v2 (`element-canvas`, element `image`) miało
 *     `loading="lazy"` — także wtedy, gdy stało w pierwszej sekcji, nad
 *     zgięciem, jako element LCP. Przeglądarka odkładała je za pierwsze
 *     malowanie, więc największy obraz strony startował ostatni;
 *   • pierwsza karta sekcji sprzętu miała `eager` + `fetchPriority="high"`
 *     ZAWSZE — także wtedy, gdy sekcja stała 1200 px niżej i jej zdjęcie nie
 *     miało prawa być widoczne przed przewinięciem. Wysoki priorytet zabierał
 *     wtedy pasmo obrazowi, który akurat był na ekranie.
 *
 * Obie wady biorą się z tego samego: komponent zna SIEBIE, ale nie zna swojego
 * miejsca w dokumencie, a „nad zgięciem" jest własnością MIEJSCA.
 *
 * ==================== REGUŁA ====================
 *
 * Priorytet dostaje PIERWSZY obraz, który strona namaluje — dokładnie jeden,
 * w dokładnie jednej sekcji. Rozstrzyga to renderer (jedyna warstwa, która widzi
 * całą listę sekcji RAZEM z danymi katalogu), a komponenty dostają gotową
 * odpowiedź propsem `imagePriority`.
 *
 * PRIORYTET ALBO NIC — nigdy „ten następny". Gdy pierwsza sekcja z obrazem jest
 * typu, który priorytetu nie umie nieść (galeria — patrz niżej), nie dostaje go
 * NIKT. Przekazanie go dalej w dół strony wskrzeszałoby dokładnie tę wadę,
 * którą ten plik zamyka: `fetchPriority="high"` na obrazie pod zgięciem.
 *
 * ==================== DLACZEGO GALERIA GO NIE NIESIE ====================
 *
 * Galeria (v1 i v3) ma dziś WSZYSTKIE kafle leniwe i jest pasem ilustracyjnym,
 * a nie obrazem otwierającym; jej kafle bywają liczone w dziesiątkach, a
 * powiększenie ma własną, kliencką warstwę. Rozpoznajemy ją jako sekcję, która
 * MALUJE obraz (żeby priorytet nie przeskoczył nad nią do sekcji niżej), ale
 * priorytetu jej nie dajemy — to zachowanie sprzed tej zmiany, więc nic się
 * w galerii nie pogarsza.
 */
import {
  isSectionCanvas,
  isStructuredSection,
  normalizeImageSource,
  type SectionCanvas,
} from "@avably/core/site";

import type {
  LegacyRenderSection,
  RenderSection,
  StorefrontCategory,
  StorefrontProduct,
} from "./types";

/**
 * Co warstwa danych wnosi do rozstrzygnięcia. Bez tego pytanie „czy ta sekcja
 * namaluje obraz" nie ma odpowiedzi: sekcja sprzętu maluje zdjęcia KATALOGU,
 * a nie własne, a zdjęcie sekcji bez prefiksu bucketa degraduje się do kafla
 * zastępczego (patrz `siteImageUrl`).
 */
export interface ImagePaintData {
  products: readonly StorefrontProduct[];
  categories: readonly StorefrontCategory[];
  siteImageBase?: string;
}

/**
 * Trzy odpowiedzi, nie dwie:
 *   • `none`  — sekcja nie namaluje ani jednego obrazu (tekst, FAQ, cennik…),
 *   • `carry` — namaluje i UMIE przyjąć priorytet,
 *   • `opaque` — namaluje, ale priorytetu nie przyjmuje (galeria).
 */
export type SectionImagePaint = "none" | "carry" | "opaque";

function canvasPaintsImage(canvas: SectionCanvas, data: ImagePaintData): boolean {
  return canvas.elements.some((element) => {
    if (element.kind !== "image") return false;
    // Zdjęcie ZWIĄZANE z rekordem strony (ADR-163) rozwiązuje się przy renderze
    // i wtedy zawsze ma adres — tu wystarczy sam fakt wiązania.
    if (element.bindings?.source) return true;
    const source = normalizeImageSource(element);
    if (!source) return false;
    return source.kind === "unsplash" || Boolean(data.siteImageBase);
  });
}

/** Czy pierwsza pozycja listy niesie zdjęcie — kafle poza pierwszym i tak są leniwe. */
function firstHasImage(items: readonly { imageUrl?: string | null }[]): boolean {
  return Boolean(items[0]?.imageUrl);
}

export function sectionImagePaint(section: RenderSection, data: ImagePaintData): SectionImagePaint {
  if (isStructuredSection(section.content)) {
    switch (section.content.type) {
      case "products":
        return firstHasImage(data.products) ? "carry" : "none";
      case "categories":
        return firstHasImage(data.categories) ? "carry" : "none";
      case "gallery":
        return section.content.items.length > 0 ? "opaque" : "none";
      default:
        return "none";
    }
  }

  if (isSectionCanvas(section.content)) {
    return canvasPaintsImage(section.content, data) ? "carry" : "none";
  }

  const legacy = section as LegacyRenderSection;
  switch (legacy.type) {
    case "hero":
      return legacy.content.imagePath && data.siteImageBase ? "carry" : "none";
    case "products":
      return firstHasImage(data.products) ? "carry" : "none";
    case "gallery":
      return (legacy.content.items ?? []).length > 0 && data.siteImageBase ? "opaque" : "none";
    default:
      return "none";
  }
}

/**
 * Identyfikator sekcji, której obraz ma dostać priorytet — albo `null`, gdy
 * priorytetu nie dostaje nikt (patrz „PRIORYTET ALBO NIC" w nagłówku pliku).
 *
 * Wejście jest w KOLEJNOŚCI DOKUMENTU — tej samej, w której renderer rysuje
 * sekcje. Funkcja niczego nie sortuje, bo „pierwszy obraz strony" to pytanie
 * o kolejność ostateczną, którą zna wyłącznie wołający (stopka jest przypięta
 * do końca, a na wielu trasach w ogóle nie należy do tej listy).
 */
export function priorityImageSectionId(
  sections: readonly RenderSection[],
  data: ImagePaintData,
): string | null {
  for (const section of sections) {
    const paint = sectionImagePaint(section, data);
    if (paint === "none") continue;
    return paint === "carry" ? section.id : null;
  }
  return null;
}
