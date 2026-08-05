import type { GalleryStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { GALLERY_GAP_CLASS, GALLERY_MASONRY_ITEM_GAP, galleryColumnsStyle } from "./gallery-shared";
import { GalleryPhotos } from "./gallery-photos";
import { StructuredSectionShell } from "./shell";

/**
 * GALERIA — UKŁAD „MOZAIKA" (E3, aneks ADR-094).
 *
 * Kadry w NATURALNYCH proporcjach: pion obok poziomu, bez przycinania. Tego
 * siatka nie umie z definicji — jej wartością jest wspólna proporcja, więc
 * zdjęcie pionowe traci w niej połowę kadru.
 *
 * ==================== DLACZEGO KOLUMNY CSS, A NIE JAVASCRIPT ====================
 *
 * Mozaikę robi się w sieci na dwa sposoby: układem wielokolumnowym CSS albo
 * pomiarem wysokości w skrypcie. Drugi daje ładniejsze wypełnienie i kosztuje
 * skrypt na stronie NAJEMCY, który mierzy obrazy przed ich wczytaniem i skacze
 * po doczytaniu każdego. Wybieramy pierwszy: kolumna wypełnia się po kolei
 * (czytanie w dół kolumny, nie w poprzek), a strona nie drga.
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
        imageClassName="h-auto w-full"
      />
    </StructuredSectionShell>
  );
}
