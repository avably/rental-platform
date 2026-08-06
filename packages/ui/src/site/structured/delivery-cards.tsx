import { deliveryPriceLabel, type DeliveryStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteMoney } from "../types";
import { AUTO_LAYOUT_CLASS, autoLayoutStyle } from "./auto-layout";
import { StructuredSectionShell } from "./shell";

/**
 * DOSTAWA — UKŁAD „KARTY" (E7, aneks ADR-094).
 *
 * Warianty obok siebie, każdy z ceną pod tytułem. Tak czyta się WYBÓR: „odbiór
 * osobisty czy dowóz" jest pytaniem, na które odpowiada się raz, patrząc na
 * wszystkie możliwości naraz.
 *
 * KARTA BEZ CENY NIE MA PUSTEGO MIEJSCA PO CENIE. Wariant bez kwoty („Odbiór
 * osobisty") to kompletna informacja, a nie brak danych — dopisanie mu „0,00 zł"
 * albo kreski byłoby odpowiedzią na pytanie, którego nikt nie zadał. Rozstrzyga
 * `deliveryPriceLabel` z rdzenia, a nie własny `if` w tym pliku: dwa pytania
 * o obecność ceny rozjechałyby się przy pierwszej poprawce.
 *
 * Liczba kolumn idzie od LICZBY wariantów (auto-układ E6) — trzy warianty stają
 * w równym rzędzie, cztery w 2 + 2, a nie w 3 + 1 z dziurą.
 */
export function StructuredDeliveryCards({
  content,
  styles,
  money,
}: {
  content: DeliveryStructuredContent;
  styles: TemplateStyles;
  money: SiteMoney;
}) {
  return (
    <StructuredSectionShell
      type="delivery"
      layout="cards"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      {content.intro ? (
        <p data-delivery-intro className={styles.lead}>
          {content.intro}
        </p>
      ) : null}

      <ul
        data-delivery-cards
        className={cn("mt-8", AUTO_LAYOUT_CLASS)}
        style={autoLayoutStyle(content.items.length)}
      >
        {content.items.map((item, index) => {
          const price = deliveryPriceLabel(item, money.currency, money.locale);
          return (
            <li key={index} data-delivery-card={index} className="site-card flex flex-col gap-2 p-5">
              <h3 data-delivery-title className={styles.cardTitle}>
                {item.title}
              </h3>
              {price ? (
                <span data-delivery-price className="site-text-accent site-numeric text-lg">
                  {price}
                </span>
              ) : null}
              <p data-delivery-text className="site-text-muted text-sm">
                {item.text}
              </p>
            </li>
          );
        })}
      </ul>
    </StructuredSectionShell>
  );
}
