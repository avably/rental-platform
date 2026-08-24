import type { CategoriesStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontCategory } from "../types";

/**
 * WSPÓLNE CZĘŚCI SEKCJI KATEGORII (Faza 7, ADR-259).
 *
 * Sekcja kategorii jest bliźniakiem sekcji sprzętu, tyle że jej encją jest
 * KATEGORIA: kafel niesie baner i nazwę, a klik prowadzi na stronę kategorii
 * (`/kategoria/{slug}`, trasa Fazy C). Wybór pozycji i stan pusty są tu takie
 * same, co przy sprzęcie, więc mieszkają w jednym miejscu.
 *
 * ZERO HEKSÓW: kolor bierze się z ról motywu przez klasy arkusza (`site-*`).
 * Kafel maluje DWIE role — nazwę (ink) i obrys (border, `site-card`) — i ani
 * jednego cienia (zakaz cieni, ADR-090: głębię niesie obrys, nie rozmycie).
 */

/**
 * KATEGORIE, KTÓRE SEKCJA ODDAJE DO DOKUMENTU.
 *
 *   • `catalog` — WSZYSTKIE kategorie katalogu w kolejności najemcy (warstwa
 *     danych sortuje po pozycji);
 *   • `picked` — WYŁĄCZNIE wskazane kategorie, w kolejności wskazania (a nie
 *     katalogu: skoro operator ustawił je w szufladzie, to jest jego decyzja).
 *
 * KATEGORIA, KTÓREJ JUŻ NIE MA (usunięta z katalogu) po prostu WYPADA: kafel
 * zastępczy prowadziłby donikąd, a błąd renderu zabrałby całą stronę przez
 * jedną kategorię skasowaną w panelu. Operator widzi ubytek w podglądzie
 * kreatora, bo płótno czyta te same kategorie, co sklep.
 */
export function visibleCategoriesFor(
  content: CategoriesStructuredContent,
  categories: readonly StorefrontCategory[],
): StorefrontCategory[] {
  if (content.source === "picked") {
    return content.items
      .map((item) => categories.find((category) => category.id === item.categoryId))
      .filter((category): category is StorefrontCategory => category !== undefined);
  }
  return [...categories];
}

/**
 * STAN PUSTY. Najemca bez kategorii i wybór wskazujący same usunięte wyglądają
 * dla odwiedzającego tak samo — i tak samo brzmią: „kategorie są w
 * przygotowaniu" jest zdaniem prawdziwym w obu przypadkach, a „wybrane
 * kategorie zniknęły" byłoby raportem z naszej bazy wystawionym klientowi
 * (ta sama zasada, co przy `ProductsEmpty`).
 */
export function CategoriesEmpty({ labels }: { labels: SiteRenderLabels }) {
  return (
    <p data-categories-empty className="site-text-muted mt-8">
      {labels.categoriesEmpty}
    </p>
  );
}

/**
 * KAFEL KATEGORII — baner (albo płyta zastępcza) i nazwa, cały kafel jest
 * odnośnikiem do strony kategorii.
 *
 * PIERWSZY kafel ładuje się ŁAPCZYWIE: sekcja kategorii bywa wysoko na stronie,
 * więc jej pierwszy baner bywa elementem LCP, a `loading="lazy"` odkłada go za
 * pierwsze malowanie i psuje pomiar (ta sama zasada, co w sekcji sprzętu).
 */
export function CategoryTile({
  category,
  eager,
  styles,
  className,
}: {
  category: StorefrontCategory;
  eager: boolean;
  styles: TemplateStyles;
  className?: string;
}) {
  const body = (
    <>
      {category.imageUrl ? (
        // Pakiet UI nie zależy od `next/image`; banery idą z publicznego
        // Storage, więc zwykły `<img>` (ta sama zasada, co w sekcji sprzętu).
        <img
          src={category.imageUrl}
          alt={category.name}
          className="aspect-[4/3] w-full object-cover"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
        />
      ) : (
        <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-1 p-3 @min-[40rem]/site:p-4">
        <span data-categories-name className={styles.cardTitle}>
          {category.name}
        </span>
      </div>
    </>
  );

  return (
    <li data-categories-item={category.id} className={cn(styles.card, className)}>
      {/*
        Odnośnik do strony kategorii istnieje WYŁĄCZNIE w sklepie (warstwa danych
        podaje `href`). Podgląd kreatora dostaje kafel statyczny — edytor nie
        nawiguje do publicznej podstrony, a przypadkowe wyjście z płótna
        wyglądałoby jak awaria panelu (ta sama zasada, co przy kaflu sprzętu).
      */}
      {category.href ? (
        <a href={category.href} className="flex flex-1 flex-col">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
