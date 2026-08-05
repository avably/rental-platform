import type { ProductsStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontProduct } from "../types";
import { PRODUCT_GRID_CLASS } from "./product-grid";
import { ProductTile, ProductsCatalogLink, ProductsEmpty, visibleProductsFor } from "./products-shared";
import { StructuredSectionShell } from "./shell";

/**
 * SPRZĘT — UKŁAD „SIATKA" (E7, aneks ADR-094).
 *
 * Kafle ze zdjęciem, po dwa albo trzy w rzędzie (próg z `productGrid`). Strona
 * pokazuje tu SPRZĘT: zdjęcie jest argumentem sprzedażowym, a nie ozdobą.
 *
 * PEŁNE RZĘDY: ostatni, niepełny rząd znika — regułę niesie arkusz
 * (`site-product-grid` w site.css), bo liczba kolumn zależy od szerokości
 * kontenera, której render nie zna. Odnośnik do katalogu pod spodem sprawia,
 * że ucięcie nie chowa oferty, tylko odsyła po jej resztę.
 */
export function StructuredProductsGrid({
  content,
  styles,
  labels,
  products = [],
}: {
  content: ProductsStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  products?: StorefrontProduct[];
}) {
  const visible = visibleProductsFor(content, products);

  return (
    <StructuredSectionShell
      type="products"
      layout="grid"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      {visible.length === 0 ? (
        <ProductsEmpty labels={labels} />
      ) : (
        <ul data-products-grid className={cn(styles.productGrid, PRODUCT_GRID_CLASS, "list-none p-0")}>
          {visible.map((product, index) => (
            <ProductTile key={product.id} product={product} eager={index === 0} styles={styles} />
          ))}
        </ul>
      )}

      {/*
        LICZBA POZYCJI ODDANYCH DO DOKUMENTU, a nie liczba widocznych po ucięciu
        arkusza. Warunek odnośnika ma jedną odpowiedź niezależną od szerokości
        okna: „katalog ma więcej, niż ta sekcja pokazuje" jest wtedy zdaniem
        o TREŚCI, a nie o bieżącym rozmiarze przeglądarki. Ucięcie do pełnych
        rzędów może tę różnicę tylko powiększyć, nigdy odwrócić.
      */}
      <ProductsCatalogLink shown={visible.length} catalogSize={products.length} labels={labels} />
    </StructuredSectionShell>
  );
}
