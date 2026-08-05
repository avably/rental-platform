import type { GalleryStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels } from "../types";
import { GALLERY_GAP_CLASS, galleryColumnsStyle } from "./gallery-shared";
import { GalleryPhotos } from "./gallery-photos";
import { StructuredSectionShell } from "./shell";

/**
 * GALERIA — UKŁAD „SIATKA" (E3, aneks ADR-094).
 *
 * Równy rytm kafli o JEDNEJ proporcji (4:3): katalog realizacji, w którym
 * porównuje się zdjęcia między sobą, a nie ogląda każde osobno. Kadr jest
 * przycinany (`object-cover`) i to jest cena tego rytmu — kto jej nie chce,
 * przełącza się na mozaikę bez ruszania ani jednego wpisu.
 *
 * DWIE KOLUMNY DO PROGU 40 rem (decyzja właściciela 2026-08-01): klasa bez
 * wariantu obowiązuje od zera w górę, więc to ona rządzi telefonem. Wybór
 * operatora (2/3/4) wchodzi dopiero POWYŻEJ progu — na 390 px cztery kolumny
 * dałyby cztery znaczki zamiast zdjęć.
 */
export function StructuredGalleryGrid({
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
      layout="grid"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <GalleryPhotos
        content={content}
        labels={labels}
        siteImageBase={siteImageBase}
        listClassName={cn(
          "mt-8 grid grid-cols-2",
          GALLERY_GAP_CLASS[content.gap],
          "@min-[40rem]/site:[grid-template-columns:repeat(var(--gallery-columns),minmax(0,1fr))]",
        )}
        listStyle={galleryColumnsStyle(content.columns)}
        imageClassName="aspect-[4/3] w-full object-cover"
      />
    </StructuredSectionShell>
  );
}
