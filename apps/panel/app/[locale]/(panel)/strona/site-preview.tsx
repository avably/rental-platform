"use client";

/**
 * PODGLĄD SZKICU (P8b — `data-site-preview="draft"` z mockupu
 * `secondary-site-editor`) — TREŚĆ dokumentu podglądu.
 *
 * Od kreatora A3 komponent nie stoi w kolumnie edytora, tylko jest ciałem
 * osobnej trasy `/podglad-strony`, którą edytor osadza w ramce (własny viewport
 * → prawdziwe media queries storefrontu). Stąd brak własnej ramki wizualnej i
 * opisu: chrome podglądu — nagłówek, przełącznik szerokości — należy do
 * edytora, a tu zostaje SAMA strona sklepu.
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

import { siteImagePublicBase } from "@/lib/site-image-base";

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
    <div data-site-preview="draft">
      {visible.length === 0 ? (
        <p data-preview-empty-state className="text-muted-foreground p-8 text-center text-sm">
          {t("empty")}
        </p>
      ) : (
        <SiteRenderer
          sections={visible}
          template={template}
          products={products}
          siteImageBase={siteImagePublicBase()}
        />
      )}
    </div>
  );
}
