import type { ProductsStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontProduct } from "../types";
import {
  ProductCta,
  ProductFeatures,
  ProductSubtitle,
  ProductsCatalogLink,
  ProductsEmpty,
  productFeaturesOf,
  productFieldOf,
  visibleProductsFor,
} from "./products-shared";
import { StructuredSectionShell } from "./shell";

/**
 * SPRZĘT — UKŁAD „LISTA" (E7, aneks ADR-094).
 *
 * Ten sam wybór pozycji, co siatka, czytany OFERTOWO zamiast katalogowo: nazwa
 * i cena stoją w jednej kolumnie, więc oko przebiega ceny w pionie, a sekcja
 * zajmuje ułamek wysokości siatki. Miniatura zostaje, bo sprzętu nie rozpoznaje
 * się po nazwie — ale jest miniaturą, a nie kadrem.
 *
 * REGUŁY PEŁNYCH RZĘDÓW TU NIE MA I BYĆ NIE MOŻE: lista ma jedną kolumnę, więc
 * każdy rząd jest pełny z konstrukcji. To nie jest wyjątek od reguły, tylko jej
 * przypadek brzegowy — `fullRowCount(n, 1) === n` (kontrakt w rdzeniu).
 */
export function StructuredProductsList({
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
      layout="list"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      {visible.length === 0 ? (
        <ProductsEmpty labels={labels} />
      ) : (
        <ul data-products-list className="mt-8 flex list-none flex-col p-0">
          {visible.map((product, index) => {
            /*
              WSKAZANIA CZYTANE TAK SAMO, JAK W SIATCE (faza 1b, ADR-154).
              Oba układy czytają TĘ SAMĄ treść — gdyby lista miała własną kopię
              rozwiązywania wskazań, jedna z dwóch prędzej czy później zgubiłaby
              regułę „wskazanie bez wartości wypada" i pokazałaby sierocą
              etykietę bez wartości. Funkcje stoją więc raz, we wspólnym module.
            */
            const subtitle = productFieldOf(product, content.subtitleField);
            const features = productFeaturesOf(product, content.featureFields);
            const body = (
              <>
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={product.imageAlt}
                    className="size-20 shrink-0 rounded-md object-cover"
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                ) : (
                  <div className="site-placeholder size-20 shrink-0 rounded-md" aria-hidden="true" />
                )}
                {/* `min-w-0` — bez niego długa nazwa sprzętu rozpycha wiersz
                    ponad szerokość kontenera zamiast się złamać. */}
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span data-products-name className={styles.cardTitle}>
                    {product.name}
                  </span>
                  {subtitle ? <ProductSubtitle value={subtitle.value} /> : null}
                  {product.description ? (
                    <span className="site-text-muted line-clamp-2 text-sm">{product.description}</span>
                  ) : null}
                  <ProductFeatures features={features} />
                  {content.ctaLabel ? <ProductCta label={content.ctaLabel} styles={styles} /> : null}
                </span>
                <span
                  data-products-price
                  className="site-text-accent shrink-0 text-right text-base whitespace-nowrap"
                >
                  {product.priceLabel}
                </span>
              </>
            );
            return (
              <li
                key={product.id}
                data-products-item={product.id}
                className="site-rule-top flex items-center gap-4 py-4"
              >
                {product.href ? (
                  <a href={product.href} className="flex flex-1 items-center gap-4">
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ProductsCatalogLink shown={visible.length} catalogSize={products.length} labels={labels} />
    </StructuredSectionShell>
  );
}
