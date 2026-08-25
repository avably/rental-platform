import type { ProductsStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontProduct } from "../types";
import {
  ProductCta,
  ProductFeatures,
  ProductSubtitle,
  ProductsCatalogLink,
  ProductsEmpty,
  productCtaLabel,
  productFeaturesOf,
  productFieldOf,
  productImageAlt,
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
  imagePriority = false,
}: {
  content: ProductsStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  products?: StorefrontProduct[];
  /** Czy TA sekcja niesie pierwszy obraz strony (S-39) — patrz `../image-priority`. */
  imagePriority?: boolean;
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
            const ctaLabel = productCtaLabel(content, product, labels);
            const body = (
              <>
                {product.imageUrl ? (
                  <img
                    src={product.imageUrl}
                    alt={productImageAlt(product)}
                    className="size-20 shrink-0 rounded-md object-cover"
                    loading={imagePriority && index === 0 ? "eager" : "lazy"}
                    fetchPriority={imagePriority && index === 0 ? "high" : undefined}
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
                  {ctaLabel ? <ProductCta label={ctaLabel} styles={styles} /> : null}
                </span>
                {/*
                  CENA NIE MOŻE ROZPYCHAĆ WIERSZA (S-12, audyt UX 2026-08-25).
                  `whitespace-nowrap shrink-0` w wierszu flex wypychało stronę
                  poza viewport na 360/390 px (scrollWidth 423 przy 360) i cięło
                  kwotę na krawędzi ekranu („od 100,00 z…”). Poniżej 28 rem
                  kontenera cena schodzi POD treść jako pełny wiersz
                  (`basis-full` + `flex-wrap` na wierszu pozycji); od 28 rem
                  wraca na prawą flankę — dokładnie dzisiejszy wygląd.
                  Atomowość samej frazy („100,00 zł / doba”) niesie twarda
                  spacja w etykiecie (S-40), nie nowrap na całym pasku.
                */}
                <span
                  data-products-price
                  className="site-text-accent shrink-0 basis-full text-base @min-[28rem]/site:basis-auto @min-[28rem]/site:text-right"
                >
                  {product.priceLabel}
                </span>
              </>
            );
            return (
              /*
                `flex-wrap` na OBU wariantach wiersza (z odnośnikiem i bez):
                bez niego cena z `basis-full` nie ma dokąd zejść i wiersz
                znowu przelewa się poza kontener (S-12). Przy ≥28 rem cena ma
                `basis-auto`, więc nic się nie zawija i układ zostaje jak był.
              */
              <li
                key={product.id}
                data-products-item={product.id}
                className="site-rule-top flex flex-wrap items-center gap-4 py-4"
              >
                {product.href ? (
                  <a href={product.href} className="flex flex-1 flex-wrap items-center gap-4">
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
