import {
  PRICING_CATALOG_HREF,
  pricingPriceLabel,
  type PricingStructuredContent,
  type PricingStructuredItem,
} from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { SiteMoney, SiteRenderLabels } from "../types";

/**
 * WSPÓLNE CZĘŚCI OBU UKŁADÓW CENNIKA (E6, aneks ADR-094).
 *
 * Tabela i karty różnią się KONTENEREM (wiersze kontra kafle) i niczym więcej:
 * etykieta ceny, notka pozycji, notka sekcji i odnośnik do katalogu są w obu
 * takie same. Gdyby każdy plik układu miał własną kopię składania ceny, jedna
 * z dwóch prędzej czy później zgubiłaby przedrostek „od” albo jednostkę — a to
 * jest informacja HANDLOWA, nie detal wyglądu: „60 zł” zamiast „od 60 zł / doba”
 * jest ofertą, której najemca nie złożył.
 *
 * ZERO HEKSÓW i zero arytmetyki złotych: kolor bierze się z ról motywu przez
 * klasy arkusza (`site-*`), a kwota — z `pricingPriceLabel` (rdzeń → jedyny
 * formatter pieniędzy w systemie). Dzielenia przez sto w tym katalogu nie ma.
 */

/**
 * ETYKIETA CENY JEDNEJ POZYCJI. Słowa („od”, nazwa jednostki) idą z JĘZYKA
 * STRONY, a nie z treści najemcy — patrz `SiteRenderLabels`. Waluta i zapis
 * z warstwy danych (`SiteMoney`), bo waluta jest ustawieniem sklepu.
 */
export function priceLabelOf(
  item: PricingStructuredItem,
  money: SiteMoney,
  labels: SiteRenderLabels,
): string {
  return pricingPriceLabel(item, money.currency, money.locale, {
    from: labels.pricingFrom,
    unit: labels.pricingUnits[item.unit],
  });
}

/**
 * STOPKA SEKCJI: notka najemcy i odnośnik do katalogu.
 *
 * Odnośnik jest LINKIEM, nie przyciskiem akcji — prowadzi do innego widoku tego
 * samego sklepu, a nie uruchamia operacji. Wypełniony akcentem konkurowałby
 * z przyciskiem rezerwacji w katalogu, do którego ma dopiero doprowadzić.
 */
export function PricingFooter({
  content,
  labels,
}: {
  content: PricingStructuredContent;
  labels: SiteRenderLabels;
}) {
  if (!content.footnote && !content.showCatalogLink) return null;
  return (
    <div className="mt-6 flex flex-col gap-3">
      {content.footnote ? (
        <p data-pricing-footnote className="site-text-muted text-sm">
          {content.footnote}
        </p>
      ) : null}
      {content.showCatalogLink ? (
        <p>
          <a data-pricing-catalog href={PRICING_CATALOG_HREF} className="site-link underline">
            {labels.pricingCatalog}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * NOTKA POZYCJI („min. 3 doby”). Drugorzędna wobec ceny, więc przygaszona —
 * ale NIE mniejsza od reszty do granicy nieczytelności: to jest warunek oferty,
 * a warunek, którego nie da się przeczytać, jest warunkiem ukrytym.
 */
export function PricingItemNote({ item, className }: { item: PricingStructuredItem; className?: string }) {
  if (!item.note) return null;
  return (
    <span data-pricing-item-note className={cn("site-text-muted text-sm", className)}>
      {item.note}
    </span>
  );
}
