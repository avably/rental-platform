import {
  PRODUCTS_CATALOG_HREF,
  productsCatalogLinkVisible,
  type ProductsStructuredContent,
} from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontProduct } from "../types";

/**
 * WSPÓLNE CZĘŚCI OBU UKŁADÓW SPRZĘTU (E7, aneks ADR-094).
 *
 * Siatka i lista różnią się KSZTAŁTEM POZYCJI i niczym więcej: wybór pozycji,
 * sufit liczby, stan pusty i odnośnik do katalogu są w obu takie same. Gdyby
 * każdy plik układu miał własną kopię wyboru, jedna z dwóch prędzej czy później
 * zgubiłaby warunek odnośnika — a to jest informacja HANDLOWA, nie detal
 * wyglądu: sekcja pokazująca sześć z dwudziestu pozycji i milcząca o reszcie
 * zataja, że reszta istnieje.
 *
 * ZERO HEKSÓW: kolor bierze się z ról motywu przez klasy arkusza (`site-*`).
 */

/**
 * POZYCJE, KTÓRE SEKCJA ODDAJE DO DOKUMENTU.
 *
 * ==================== DWA ŹRÓDŁA, JEDNO WYJŚCIE ====================
 *
 *   • `catalog` — pierwsze `limit` pozycji katalogu w jego własnej kolejności;
 *   • `picked` — WYŁĄCZNIE wskazane pozycje, w kolejności wskazania (a nie
 *     w kolejności katalogu: skoro operator ustawił je w szufladzie, to jest
 *     jego decyzja, a nie przypadek alfabetu).
 *
 * ==================== POZYCJA, KTÓREJ JUŻ NIE MA ====================
 *
 * Wskazanie, do którego nie ma dziś produktu (pozycja usunięta albo wyłączona
 * w katalogu), po prostu WYPADA. Alternatywy są dwie i obie gorsze: kafel
 * zastępczy kłamałby o ofercie, a błąd renderu zabrałby klientowi całą stronę
 * przez jedną pozycję skasowaną w panelu. Operator widzi ubytek w podglądzie
 * kreatora, bo płótno czyta ten sam katalog, co sklep.
 */
export function visibleProductsFor(
  content: ProductsStructuredContent,
  products: readonly StorefrontProduct[],
): StorefrontProduct[] {
  const chosen =
    content.source === "picked"
      ? content.items
          .map((item) => products.find((product) => product.id === item.productId))
          .filter((product): product is StorefrontProduct => product !== undefined)
      : [...products];
  return chosen.slice(0, content.limit);
}

/**
 * ODNOŚNIK DO PEŁNEGO KATALOGU — WARUNEK NA DANYCH, nie przełącznik operatora
 * (uzasadnienie przy `productsCatalogLinkVisible` w rdzeniu).
 *
 * Odnośnik jest LINKIEM, nie przyciskiem akcji: prowadzi do innego widoku tego
 * samego sklepu, a nie uruchamia operacji. Wypełniony akcentem konkurowałby
 * z przyciskiem rezerwacji w katalogu, do którego ma dopiero doprowadzić — ta
 * sama zasada, co przy odnośniku pod cennikiem (E6).
 */
export function ProductsCatalogLink({
  shown,
  catalogSize,
  labels,
}: {
  shown: number;
  catalogSize: number;
  labels: SiteRenderLabels;
}) {
  if (!productsCatalogLinkVisible(shown, catalogSize)) return null;
  return (
    <p className="mt-6">
      <a data-products-catalog href={PRODUCTS_CATALOG_HREF} className="site-link underline">
        {labels.productsCatalog}
      </a>
    </p>
  );
}

/**
 * STAN PUSTY. Katalog w przygotowaniu i wybór wskazujący same nieistniejące
 * pozycje wyglądają dla odwiedzającego tak samo — i tak samo powinny brzmieć:
 * „katalog jest w przygotowaniu" jest zdaniem prawdziwym w obu przypadkach,
 * a „wybrane pozycje zniknęły" byłoby raportem z naszej bazy wystawionym
 * klientowi.
 */
export function ProductsEmpty({ labels }: { labels: SiteRenderLabels }) {
  return (
    <p data-products-empty className="site-text-muted mt-8">
      {labels.productsEmpty}
    </p>
  );
}

/**
 * KAFEL POZYCJI — zdjęcie, nazwa, cena, opis.
 *
 * Cena przychodzi GOTOWA (`StorefrontProduct.priceLabel`), bo pochodzi
 * z katalogu, czyli spoza treści strony, a warstwa odczytu i tak ją czyta
 * (kontrast z ceną pozycji cennika, która mieszka w treści sekcji — patrz
 * `SiteMoney` w types.ts).
 *
 * PIERWSZY kafel ładuje się ŁAPCZYWIE: sekcja sprzętu wchodzi na stronie wysoko,
 * więc jej pierwsze zdjęcie bywa elementem LCP, a `loading="lazy"` odkłada je
 * za pierwsze malowanie i psuje pomiar. Pozostałe zostają leniwe.
 */
export function ProductTile({
  product,
  eager,
  styles,
  className,
}: {
  product: StorefrontProduct;
  eager: boolean;
  styles: TemplateStyles;
  className?: string;
}) {
  const body = (
    <>
      {product.imageUrl ? (
        // Pakiet UI nie zależy od `next/image`; zdjęcia idą z publicznego
        // Storage, więc zwykły `<img>` (ta sama zasada, co w sekcji v1).
        <img
          src={product.imageUrl}
          alt={product.imageAlt}
          className="aspect-[4/3] w-full object-cover"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
        />
      ) : (
        <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-1 p-3 @min-[40rem]/site:p-4">
        <span data-products-name className={styles.cardTitle}>
          {product.name}
        </span>
        <span data-products-price className={styles.cardPrice}>
          {product.priceLabel}
        </span>
        {product.description ? (
          <span className="site-text-muted mt-2 line-clamp-3 text-sm">{product.description}</span>
        ) : null}
      </div>
    </>
  );

  return (
    <li data-products-item={product.id} className={cn(styles.card, className)}>
      {/*
        Odnośnik do podstrony pozycji istnieje WYŁĄCZNIE w sklepie (warstwa
        danych podaje `href`). Podgląd kreatora dostaje kafel statyczny — edytor
        nie nawiguje do publicznej podstrony, a przypadkowe wyjście z płótna
        wyglądałoby jak awaria panelu.
      */}
      {product.href ? (
        <a href={product.href} className="flex flex-1 flex-col">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
