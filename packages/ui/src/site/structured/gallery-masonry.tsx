import type { GalleryStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { GALLERY_GAP_CLASS, GALLERY_MASONRY_ITEM_GAP, galleryColumnsStyle } from "./gallery-shared";
import { GalleryPhotos } from "./gallery-photos";
import { StructuredSectionShell } from "./shell";

/**
 * GALERIA — UKŁAD „MOZAIKA" (E3, aneks ADR-094; proporcja stała od naprawy
 * celności kotwic).
 *
 * Kafle płyną KOLUMNAMI (czytanie w dół kolumny, nie w poprzek) i to właśnie —
 * razem z przesunięciem rytmu od podpisów różnej długości — odróżnia mozaikę
 * od siatki z jej równymi rzędami. Kadr ma STAŁĄ proporcję 4:3, jak pozostałe
 * układy, i to jest świadome zejście z pierwotnego zamysłu „kadry
 * w naturalnych proporcjach":
 *
 *   • treść NIE NIESIE wymiarów kadru (`imageSourceSchema` to adres
 *     i atrybucja, kuracja pinuje tylko szerokość), więc naturalnej wysokości
 *     nie da się zarezerwować przed wczytaniem — a obraz `loading="lazy"` bez
 *     rezerwacji ma 0 px, dokument rośnie w trakcie przejazdu kotwicznego
 *     (zmierzone ~417 px na zimnym cache) i skok do `#rezerwacja` ląduje
 *     o tyle za wysoko;
 *   • pełny kadr bez przycięcia pozostaje tam, gdzie się go OGLĄDA:
 *     powiększenie renderuje proporcje naturalne (`object-contain`).
 *
 * Kontraktu pilnuje `site-image-reservation.test.tsx`: każda powierzchnia
 * obrazu w przepływie dokumentu rezerwuje wysokość klasą proporcji.
 *
 * ==================== DLACZEGO KOLUMNY CSS, A NIE JAVASCRIPT ====================
 *
 * Mozaikę robi się w sieci na dwa sposoby: układem wielokolumnowym CSS albo
 * pomiarem wysokości w skrypcie. Drugi daje ładniejsze wypełnienie i kosztuje
 * skrypt na stronie NAJEMCY, który mierzy obrazy przed ich wczytaniem i skacze
 * po doczytaniu każdego. Wybieramy pierwszy: kolumna wypełnia się po kolei,
 * a strona nie drga.
 *
 * `gap` w układzie wielokolumnowym ustawia WYŁĄCZNIE odstęp między kolumnami —
 * pionowy niesie margines kafla, stąd dwie klasy z jednej nazwy gęstości.
 */
export function StructuredGalleryMasonry({
  content,
  styles,
  siteImageBase,
  labels,
}: {
  content: GalleryStructuredContent;
  styles: TemplateStyles;
  siteImageBase?: string;
  labels: SiteRenderLabels;
}) {
  return (
    <StructuredSectionShell
      type="gallery"
      layout="masonry"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <GalleryPhotos
        content={content}
        labels={labels}
        siteImageBase={siteImageBase}
        listClassName={cn(
          "mt-8 columns-2",
          GALLERY_GAP_CLASS[content.gap],
          "@min-[40rem]/site:[columns:var(--gallery-columns)]",
        )}
        listStyle={galleryColumnsStyle(content.columns)}
        // `break-inside-avoid` trzyma kafel w jednej kolumnie — bez tego podpis
        // potrafi wylądować pod zdjęciem w kolumnie obok.
        itemClassName={cn("break-inside-avoid", GALLERY_MASONRY_ITEM_GAP[content.gap])}
        imageClassName="aspect-[4/3] w-full object-cover"
      />
    </StructuredSectionShell>
  );
}
