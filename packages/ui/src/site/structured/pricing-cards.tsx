import type { PricingStructuredContent } from "@avably/core/site";

import { cn } from "../../lib/cn";
import type { TemplateStyles } from "../template";
import type { SiteMoney, SiteRenderLabels } from "../types";
import { AUTO_LAYOUT_CLASS, autoLayoutStyle } from "./auto-layout";
import { PricingFooter, PricingItemNote, priceLabelOf } from "./pricing-shared";
import { StructuredSectionShell } from "./shell";

/**
 * CENNIK — UKŁAD „KARTY" (E6, aneks ADR-094).
 *
 * Ten sam `items`, co tabela, czytany POJEDYNCZO zamiast porównawczo. Kafel ma
 * miejsce na notkę warunku („Minimum 20 sztuk”) w pełnym zdaniu, którego wiersz
 * tabeli nie zmieści bez rozbicia rytmu kolumn — i to jest cała różnica między
 * tymi dwoma układami.
 *
 * LICZBA KOLUMN IDZIE OD LICZBY POZYCJI (auto-układ, patrz `auto-layout.ts`),
 * a nie z kontrolki w szufladzie. Cztery pozycje stają w 2 + 2, jedna zajmuje
 * pełną szerokość, siedem nie zostawia pustej komórki w ostatnim rzędzie —
 * bo rząd wypełniają WPISY, a nie puste ślady po nieistniejących.
 */
export function StructuredPricingCards({
  content,
  styles,
  labels,
  money,
}: {
  content: PricingStructuredContent;
  styles: TemplateStyles;
  labels: SiteRenderLabels;
  money: SiteMoney;
}) {
  return (
    <StructuredSectionShell
      type="pricing"
      layout="cards"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <ul
        data-pricing-cards
        className={cn("mt-8", AUTO_LAYOUT_CLASS)}
        style={autoLayoutStyle(content.items.length)}
      >
        {content.items.map((item, index) => (
          <li
            key={index}
            data-pricing-card={index}
            className="site-card flex flex-col gap-2 p-5"
          >
            <span data-pricing-name className="site-title text-base font-medium break-words">
              {item.name}
            </span>
            {/*
              Cena stoi POD nazwą i jest największym elementem kafla: kafel
              cennika czyta się po cenie, a nazwa jest jej wyjaśnieniem.
            */}
            <span data-pricing-price className="site-text-accent text-lg">
              {priceLabelOf(item, money, labels)}
            </span>
            <PricingItemNote item={item} className="mt-auto" />
          </li>
        ))}
      </ul>

      <PricingFooter content={content} labels={labels} />
    </StructuredSectionShell>
  );
}
