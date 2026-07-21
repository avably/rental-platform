import type { StatusTone } from "@avably/ui";

/**
 * Jedyne miejsce w panelu, które przypisuje RODZAJ semantyczny osi
 * DOSTĘPNOŚCI katalogu (ADR-058).
 *
 * `statusSemantics` z P2 (ADR-055) opisuje trzy osie procesu zamówienia —
 * order / payment / shipment — i jest kopią powierzchni `status-map`
 * artefaktu. Aktywność produktu ani punktu odbioru NIE JEST żadną z nich:
 * to flaga publikacji, nie krok w przepływie. Dopisanie jej do tamtej mapy
 * rozjechałoby kontrakt z artefaktem, więc oś dostaje własne, jedno miejsce —
 * dokładnie tym samym wzorcem co `statusBadgeProps` dla zamówień
 * (`lib/orders/status-chip.tsx`), żeby ekrany katalogu nie rozsypały po sobie
 * warunków kolorowania.
 *
 * Wyłączona pozycja to `neutral`, NIE `problem`: produkt zdjęty ze sprzedaży
 * jest decyzją najemcy, a nie usterką — a `problem` w tym systemie znaczy
 * „coś poszło źle".
 */
const AVAILABILITY_TONE = {
  active: "positive",
  inactive: "neutral",
} as const satisfies Record<string, StatusTone>;

export function availabilityBadgeProps(active: boolean): {
  tone: StatusTone;
  "data-catalog-axis": "availability";
  "data-catalog-value": keyof typeof AVAILABILITY_TONE;
} {
  const value = active ? "active" : "inactive";
  return {
    // Atrybuty osi jak w chipach artefaktu — dają kontraktowi i weryfikacji
    // w przeglądarce jednoznaczny uchwyt, bez czytania klas.
    tone: AVAILABILITY_TONE[value],
    "data-catalog-axis": "availability",
    "data-catalog-value": value,
  };
}
