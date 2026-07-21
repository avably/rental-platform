import { StatusBadge, statusSemantics, type StatusAxis, type StatusTone } from "@avably/ui";
import { useTranslations } from "next-intl";

/**
 * Jedyne miejsce w panelu, które przypisuje RODZAJ semantyczny statusowi
 * (ADR-057).
 *
 * Reguła ekranów zamówień: `tone` NIGDY nie jest literałem przy statusie —
 * wynika wyłącznie z `statusSemantics` (kontrakt z artefaktem Fazy 2,
 * ADR-055). Dzięki temu przemalowanie rodzaju dzieje się w jednym pliku
 * pakietu UI, a nie w kilkunastu warunkach rozsianych po ekranach — a skan
 * `order-status-tone-contract.test.ts` pilnuje, że nikt nie dopisze literału
 * z powrotem.
 *
 * Etykieta idzie ze słownika i18n `orders.statusLabels.<oś>.<wartość>`, którego
 * komplet i treść PL przypina `order-status-labels-contract.test.ts` do
 * artefaktu. Chip zawsze niesie tekst (twardy zakaz color-only-status).
 */

/** Dozwolone wartości osi = klucze mapy semantyki, nie luźny string. */
type StatusValue<A extends StatusAxis> = keyof (typeof statusSemantics)[A] & string;

export function statusBadgeProps<A extends StatusAxis>(
  axis: A,
  value: StatusValue<A>,
): {
  tone: StatusTone;
  "data-status-axis": A;
  "data-status-value": string;
} {
  return {
    tone: statusSemantics[axis][value] as StatusTone,
    // Atrybuty osi jak w chipach artefaktu — dają testowi kontraktowemu i
    // weryfikacji w przeglądarce jednoznaczny uchwyt do wiersza.
    "data-status-axis": axis,
    "data-status-value": value,
  };
}

export function StatusChip<A extends StatusAxis>({
  axis,
  value,
  className,
}: {
  axis: A;
  value: StatusValue<A>;
  className?: string;
}) {
  const t = useTranslations("orders.statusLabels");

  // next-intl typuje klucze literałami i nie umie przejść ścieżki złożonej z
  // parametru generycznego (`orders.statusLabels.${A}.…`). Rzutujemy WYŁĄCZNIE
  // kształt klucza — para oś/wartość jest już ograniczona typem `StatusValue<A>`
  // do kluczy `statusSemantics`, a komplet etykiet po drugiej stronie pilnuje
  // `order-status-labels-contract.test.ts`. Brak klucza jest więc czerwonym
  // testem, nie cichym „orders.statusLabels.order.pending" na ekranie.
  const key = `${axis}.${value}` as Parameters<typeof t>[0];

  return (
    <StatusBadge {...statusBadgeProps(axis, value)} className={className}>
      {t(key)}
    </StatusBadge>
  );
}
