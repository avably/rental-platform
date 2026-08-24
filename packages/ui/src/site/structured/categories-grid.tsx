import type { CategoriesStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontCategory } from "../types";
import { CategoriesEmpty, CategoryTile, visibleCategoriesFor } from "./categories-shared";
import { StructuredSectionShell } from "./shell";

/**
 * KATEGORIE — UKŁAD „SIATKA" (Faza 7, ADR-259).
 *
 * Kafle z banerem, po dwa albo trzy w rzędzie (ten sam próg kontenerowy, co
 * sekcja sprzętu). Kafel prowadzi na stronę kategorii (`/kategoria/{slug}`),
 * więc sekcja jest DROGOWSKAZEM po ofercie, a nie jej wystawą — dlatego bez
 * ceny i bez przycisku rezerwacji, które należą do sprzętu.
 *
 * SIATKA REUŻYWA `styles.productGrid` (ta sama responsywność kontenerowa:
 * dwie kolumny na telefonie, trzy od 64rem). Pusta sekcja (najemca bez
 * kategorii albo wybór wskazujący same usunięte) pokazuje stan pusty pod
 * nagłówkiem — stan naprawialny w kreatorze widzi operator także przez pusty
 * stan płótna (E8), a klient dostaje zdanie zamiast pustej ramki.
 */
export function StructuredCategoriesGrid({
  content,
  styles,
  labels,
  categories = [],
}: {
  content: CategoriesStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  categories?: StorefrontCategory[];
}) {
  const visible = visibleCategoriesFor(content, categories);

  return (
    <StructuredSectionShell
      type="categories"
      layout="grid"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      {visible.length === 0 ? (
        <CategoriesEmpty labels={labels} />
      ) : (
        <ul data-categories-grid className={cn(styles.productGrid, "list-none p-0")}>
          {visible.map((category, index) => (
            <CategoryTile
              key={category.id}
              category={category}
              eager={index === 0}
              styles={styles}
            />
          ))}
        </ul>
      )}
    </StructuredSectionShell>
  );
}
