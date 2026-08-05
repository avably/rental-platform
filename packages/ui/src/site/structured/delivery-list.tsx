import { deliveryPriceLabel, type DeliveryStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteMoney } from "../types";
import { StructuredSectionShell } from "./shell";

/**
 * DOSTAWA — UKŁAD „LISTA" (E7, aneks ADR-094).
 *
 * Wiersze z ceną wyrównaną do prawej. Tak czyta się cennik dodatków: przy
 * sześciu wariantach kafle rozjeżdżają się na dwa ekrany, a kwoty przestają
 * stać w jednej kolumnie — czyli znika jedyny powód, dla którego się je
 * zestawia.
 *
 * WIERSZ BEZ CENY ZOSTAJE WIERSZEM: kolumna kwoty jest po prostu pusta, a nie
 * wypełniona kreską „brak". Kreska w kolumnie ceny czyta się jako „cena zero"
 * albo „cena nieznana"; „Odbiór osobisty" nie jest ani jednym, ani drugim.
 */
export function StructuredDeliveryList({
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
      layout="list"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      {content.intro ? (
        <p data-delivery-intro className={styles.lead}>
          {content.intro}
        </p>
      ) : null}

      <ul data-delivery-list className="mt-8 flex list-none flex-col p-0">
        {content.items.map((item, index) => {
          const price = deliveryPriceLabel(item, money.currency, money.locale);
          return (
            <li
              key={index}
              data-delivery-row={index}
              className="site-rule-top flex flex-col gap-1 py-4 @min-[40rem]/site:flex-row @min-[40rem]/site:items-baseline @min-[40rem]/site:gap-6"
            >
              {/* `min-w-0` — bez niego długa nazwa wariantu rozpycha wiersz
                  ponad szerokość kontenera zamiast się złamać. */}
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <h3 data-delivery-title className={styles.cardTitle}>
                  {item.title}
                </h3>
                <span data-delivery-text className="site-text-muted text-sm">
                  {item.text}
                </span>
              </span>
              {price ? (
                <span
                  data-delivery-price
                  className="site-text-accent shrink-0 text-base whitespace-nowrap @min-[40rem]/site:text-right"
                >
                  {price}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </StructuredSectionShell>
  );
}
