"use client";

/**
 * PODGLĄD SZKICU (P8b — `data-site-preview="draft"` z mockupu
 * `secondary-site-editor`).
 *
 * Renderuje TE SAME komponenty co storefront (`SiteRenderer`) na WŁĄCZONYCH
 * sekcjach szkicu — operator widzi zmianę, zanim ją opublikuje; anon dopiero po
 * „Opublikuj stronę” (storefront czyta `content_published`).
 *
 * Osobny plik od edytora, bo mockup stawia tu twardą regułę, którą trzeba dać
 * się przetestować w izolacji: przy WSZYSTKICH sekcjach wyłączonych podgląd ma
 * być PUSTY — bez fikcyjnej zawartości, bez przykładowych kafli produktów i bez
 * treści sekcji, których klient nie zobaczy. Podgląd pokazujący wyłączone
 * sekcje kłamałby dokładnie o tej rzeczy, dla której istnieje.
 */
import { SiteRenderer, type StorefrontProduct } from "@avably/ui";
import type { SiteTemplate } from "@avably/core/site";
import { useTranslations } from "next-intl";

import { previewSections, type EditorSection } from "./content";

export function SitePreview({
  sections,
  template,
  products,
}: {
  sections: EditorSection[];
  template: SiteTemplate;
  products: StorefrontProduct[];
}) {
  const t = useTranslations("site.preview");
  const visible = previewSections(sections);

  return (
    <aside data-site-preview="draft" className="flex min-w-0 flex-col gap-3">
      <p className="text-muted-foreground text-[11px] leading-4 font-semibold tracking-[0.08em] uppercase">
        {t("eyebrow")}
      </p>
      <p className="text-muted-foreground text-[13px] leading-[18px]">{t("intro")}</p>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {visible.length === 0 ? (
          <p
            data-preview-empty-state
            className="text-muted-foreground p-8 text-center text-sm"
          >
            {t("empty")}
          </p>
        ) : (
          <SiteRenderer sections={visible} template={template} products={products} />
        )}
      </div>
    </aside>
  );
}
