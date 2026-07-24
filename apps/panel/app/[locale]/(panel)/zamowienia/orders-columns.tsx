"use client";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@avably/ui";
import { useTranslations } from "next-intl";

import {
  ORDER_COLUMN_KEYS,
  ORDER_COLUMN_LABEL_KEY,
  visibleColumnCount,
} from "@/lib/orders/order-columns";

import { setOrderColumnVisible, useHiddenOrderColumns } from "./use-order-columns";

/**
 * Menu „Kolumny" (uwaga przeglądu U5) — przełączniki widoczności kolumn
 * treściowych, trwałe w `localStorage` (bez migracji, patrz
 * `lib/orders/order-columns.ts`).
 *
 * Menu NIE zamyka się po kliknięciu pozycji (`onSelect` z preventDefault):
 * ukrywanie kolumn robi się seriami, a zamknięcie po każdej zmianie kazałoby
 * otwierać je od nowa przy każdym przełączniku.
 *
 * Stoi w belce filtrów obok „Filtrów zaawansowanych", bo to jest ta sama
 * decyzja co filtr: ile z tabeli widzę.
 */
export function OrdersColumnsMenu() {
  const t = useTranslations("orders.list");
  const hidden = useHiddenOrderColumns();
  const visible = visibleColumnCount(hidden);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-orders-columns-trigger
        className="border-border bg-card text-foreground inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm font-medium outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:bg-muted focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
      >
        <ColumnsGlyph />
        <span>{t("columns")}</span>
        {/* Licznik mówi wprost, że część kolumn jest schowana — inaczej
            brakująca kolumna wygląda jak usterka, a nie jak własny wybór. */}
        <span className="text-muted-foreground tabular-nums">
          {t("columnsCount", { visible, total: ORDER_COLUMN_KEYS.length })}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-60">
        <DropdownMenuLabel>{t("columnsMenuTitle")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ORDER_COLUMN_KEYS.map((key) => (
          <DropdownMenuCheckboxItem
            key={key}
            data-orders-column={key}
            checked={!hidden.has(key)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={(checked) => setOrderColumnVisible(key, checked === true)}
          >
            {t(ORDER_COLUMN_LABEL_KEY[key])}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        {/* Kolumny stałe wymienione JAWNIE: ich brak w liście przełączników
            jest decyzją, a nie przeoczeniem (ID niesie kotwicę wiersza,
            Akcje — menu wiersza). */}
        <p className="text-muted-foreground px-2 py-1.5 text-xs">{t("columnsFixedHint")}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnsGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2.5" width="4" height="11" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="10" y="2.5" width="4" height="11" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
