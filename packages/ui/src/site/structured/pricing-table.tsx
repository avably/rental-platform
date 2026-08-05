import type { PricingStructuredContent } from "@avably/core/site";

import type { TemplateStyles } from "../template";
import type { SiteMoney, SiteRenderLabels } from "../types";
import { PricingFooter, PricingItemNote, priceLabelOf } from "./pricing-shared";
import { StructuredSectionShell } from "./shell";

/**
 * CENNIK — UKŁAD „TABELA" (E6, aneks ADR-094).
 *
 * ==================== DLACZEGO TO JEST `<table>` ====================
 *
 * Kusi zbudować to z `<div>`-ów i siatki: wygląda tak samo, a układa się
 * łatwiej. Odpada, bo cennik JEST tabelą danych — nazwa i cena to dwie kolumny
 * o stałym znaczeniu, a nie dwa napisy obok siebie. Czytnik ekranu na
 * prawdziwej tabeli zapowiada nagłówek kolumny przy każdej komórce („Cena:
 * 120 zł za dobę”), a na siatce `<div>`-ów czyta ciąg napisów, w którym po
 * trzech pozycjach nie wiadomo już, co jest czym. To jest różnica między
 * cennikiem czytelnym a cennikiem, który brzmi jak lista zakupów.
 *
 * ==================== BEZ POZIOMEGO PRZEWIJANIA ====================
 *
 * Tabela ma DWIE kolumny i obie są tekstem, który się łamie — więc mieści się
 * także w kontenerze telefonu i nie potrzebuje przewijania w bok. Notka
 * pozycji stoi POD nazwą (w tej samej komórce), a nie w trzeciej kolumnie:
 * trzecia kolumna na 390 px zamieniłaby nazwę sprzętu w pionowy słupek liter.
 */
export function StructuredPricingTable({
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
      layout="table"
      background={content.background}
      heading={content.heading}
      styles={styles}
    >
      <table data-pricing-table className="mt-8 w-full border-collapse text-left">
        {/*
          Nagłówki kolumn są UKRYTE WZROKOWO, ale obecne w drzewie: widzącemu
          mówi je układ (nazwa po lewej, kwota po prawej), a czytnikowi ekranu
          nie mówi nic — i to jego dotyczy cała wartość tabeli.
        */}
        <caption className="sr-only">{content.heading ?? labels.pricingCatalog}</caption>
        <tbody>
          {content.items.map((item, index) => (
            <tr key={index} data-pricing-row={index} className="site-rule">
              <th scope="row" className="site-title py-4 pr-4 align-top text-base font-medium">
                <span className="flex flex-col gap-1">
                  <span data-pricing-name>{item.name}</span>
                  <PricingItemNote item={item} />
                </span>
              </th>
              <td
                data-pricing-price
                className="site-text-accent py-4 text-right align-top text-base whitespace-nowrap"
              >
                {priceLabelOf(item, money, labels)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <PricingFooter content={content} labels={labels} />
    </StructuredSectionShell>
  );
}
