/**
 * WIERSZE PODSUMOWANIA KWOT (F8) — JEDNA geometria dla koszyka, checkoutu,
 * kroku płatności i ekranu potwierdzenia.
 *
 * ==================== DLACZEGO GRID, NIE FLEX (naprawa S-15) ====================
 *
 * Do F8 wiersz kwoty był `flex justify-between` w kontenerze `display: grid`
 * BEZ szablonu kolumn. Niejawna kolumna `auto` takiej siatki przyjmuje
 * szerokość NAJWIĘKSZEGO dziecka (min-content), więc jedno sztywne dziecko
 * karty — iframe antybotowy o stałych 300 px — rozdymało kolumnę ponad pudełko
 * treści, KAŻDY wiersz rozciągał się do szerokości kolumny, a kwota dociśnięta
 * do prawej lądowała ZA paddingiem i 1 px za ramką karty (zmierzone:
 * `gridTemplateColumns: 300px` przy 278 px treści; przy kwotach 4-cyfrowych
 * ucinało „zł" — zrzut właściciela).
 *
 * Naprawa u źródła stoi w DWÓCH miejscach naraz:
 *   1. KAŻDY tor siatki na ścieżce kwot jest `minmax(0, 1fr)` (`grid-cols-1`
 *      Tailwinda) — szerokość toru liczy się z KONTENERA, nigdy z dziecka,
 *      więc żaden przyszły „szeroki gość" karty nie wypchnie kwot z paddingu.
 *   2. Wiersz kwoty to grid `[etykieta] [wartość]` (`1fr auto`): wartość jest
 *      własną kolumną DOMKNIĘTĄ w pudełku wiersza, a nie końcem elastycznego
 *      paska, który dziedziczy szerokość spoza siebie.
 *
 * `site-numeric` (tabular-nums) wyrównuje cyfry w kolumnie — patrz site.css;
 * `whitespace-nowrap` trzyma kwotę w jednym tokenie (fraza kwoty jest atomowa
 * tak samo jak fraza terminu z formatRentalRange).
 */
import type { ReactNode } from "react";

export interface SummaryRow {
  label: ReactNode;
  value: ReactNode;
  /** Klucz Reacta, gdy etykieta nie jest stringiem. */
  key?: string;
}

/** Klasy wiersza kwoty — eksportowane, bo pilnuje ich test geometrii. */
export const SUMMARY_ROW_GRID = "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3";
export const SUMMARY_VALUE = "site-numeric text-right whitespace-nowrap";

export function SummaryList({
  rows,
  total,
}: {
  rows: SummaryRow[];
  /**
   * „Razem do zapłaty" — hierarchia wprost ze spec F8: separator NAD wierszem,
   * wartość 20 px/600, reszta wierszy 15 px.
   */
  total: SummaryRow;
}) {
  return (
    <dl className="grid grid-cols-1 gap-2 text-[15px]" data-checkout-summary-rows>
      {rows.map((row, index) => (
        <div
          key={row.key ?? (typeof row.label === "string" ? row.label : index)}
          className={SUMMARY_ROW_GRID}
          data-summary-row
        >
          <dt className="site-text-muted">{row.label}</dt>
          <dd className={SUMMARY_VALUE} data-summary-value>
            {row.value}
          </dd>
        </div>
      ))}
      <div className={`site-rule-top mt-1 ${SUMMARY_ROW_GRID} pt-3`} data-summary-row>
        <dt className="font-semibold">{total.label}</dt>
        <dd className={`${SUMMARY_VALUE} text-xl font-semibold`} data-summary-total>
          {total.value}
        </dd>
      </div>
    </dl>
  );
}
