import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { availabilityBadgeProps } from "@/lib/catalog/availability-chip";

import { ToggleLocationButton } from "./toggle-button";

/**
 * Tabela punktów odbioru w designie Fazy 2 (ADR-058) — ta sama forma co
 * lista produktów i lista zamówień: ramka z przewijaniem poziomym, nagłówki
 * jako micro-label, stan focusu na linku (element tabowalny, ADR-057 D5).
 *
 * Oś dostępności idzie przez `availabilityBadgeProps` — ekran nie zna słowa
 * „positive". Adres jest tekstem z natury proporcjonalnym, więc świadomie
 * NIE dostaje `tabular-nums` (ADR-053 D3: klasa idzie na dane liczbowe
 * i identyfikatory, nie na wszystko, co zawiera cyfrę).
 */
export interface LocationsTableRow {
  id: string;
  name: string;
  address: string;
  active: boolean;
  /** Akcja przełączenia, ZWIĄZANA już po stronie serwera (bind na stronie). */
  toggleAction: Parameters<typeof ToggleLocationButton>[0]["action"];
}

/**
 * Zdanie o skutku wyłączenia stoi PRZY AKCJI (U9): nad tabelą, w której żyje
 * przycisk, i jest wskazywane przez `aria-describedby` każdego przycisku, więc
 * czytnik ekranu podaje je razem z nazwą akcji. Powtarzanie go w komórce
 * każdego wiersza byłoby tym samym zdaniem N razy.
 */
const TOGGLE_EFFECT_ID = "location-toggle-effect";

export function LocationsTable({ rows }: { rows: LocationsTableRow[] }) {
  const t = useTranslations("orders.delivery.locations");

  const headClass =
    "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

  return (
    <div className="flex flex-col gap-2">
      <p id={TOGGLE_EFFECT_ID} className="text-muted-foreground text-[13px] leading-[18px]">
        {t("toggleEffect")}
      </p>
      <div className="border-border bg-card overflow-x-auto rounded-lg border">
        <Table className="min-w-[640px] border-collapse">
          <TableHeader>
            <TableRow className="hover:border-b-border">
              <TableHead className={headClass}>{t("colName")}</TableHead>
              <TableHead className={headClass}>{t("colAddress")}</TableHead>
              <TableHead className={headClass}>{t("colActive")}</TableHead>
              <TableHead className="h-auto px-3.5 py-3">
                <span className="sr-only">{t("colActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((location) => (
              <TableRow key={location.id} data-location-row data-location-id={location.id}>
                <TableCell data-cell="name" className="h-[52px] px-3.5 py-2.5">
                  <Link
                    className="text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                    href={`/ustawienia-dostaw/punkty-odbioru/${location.id}`}
                  >
                    {location.name}
                  </Link>
                </TableCell>
                <TableCell data-cell="address" className="h-[52px] px-3.5 py-2.5">
                  {location.address}
                </TableCell>
                <TableCell data-cell="availability" className="h-[52px] px-3.5 py-2.5">
                  <StatusBadge {...availabilityBadgeProps(location.active)}>
                    {location.active ? t("activeYes") : t("activeNo")}
                  </StatusBadge>
                </TableCell>
                <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                  <ToggleLocationButton
                    action={location.toggleAction}
                    nextActive={!location.active}
                    describedBy={TOGGLE_EFFECT_ID}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
