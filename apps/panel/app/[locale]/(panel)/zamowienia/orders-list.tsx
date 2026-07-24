"use client";

import type { CurrencyCode } from "@avably/core";
import { useCallback, useMemo, useState } from "react";

import type { ResolvedSort } from "@/lib/orders/order-sort";

import { OrdersBulkActions } from "./orders-bulk-actions";
import { OrdersTable, type OrdersTableRow } from "./orders-table";
import { useHiddenOrderColumns } from "./use-order-columns";

/**
 * Interaktywna warstwa listy zamówień (U4 + U5).
 *
 * Ekran jest server componentem i takim zostaje — czyta bazę, filtruje,
 * sortuje. Stanu KLIENTA jest dokładnie tyle: co zaznaczone i które kolumny
 * są schowane. Ten komponent jest jedynym właścicielem obu, a tabela i pasek
 * akcji dostają je propsami. Rozdział ma konkretną cenę i konkretny zysk:
 * `orders-table.tsx` zostaje bezstanowe, więc kontrakt renderu (#117) puszcza
 * je na fixture z dowolnym zestawem kolumn, bez `localStorage` i bez atrap.
 *
 * ZAZNACZENIE ŻYJE TYLKO NA WCZYTANEJ STRONIE. Odczyt listy ma limit 100
 * (page.tsx), a filtr/sort zmienia zbiór wierszy — dlatego zaznaczenie jest
 * PRZECINANE z aktualnymi wierszami przy każdym renderze. Bez tego po zmianie
 * filtra pasek liczyłby duchy, których nie widać na ekranie, a akcja masowa
 * ruszyłaby zamówienia, których operator nie ma przed oczami.
 */
export function OrdersList({
  rows,
  currency,
  locale,
  sort,
  baseParams,
}: {
  rows: OrdersTableRow[];
  currency: CurrencyCode;
  locale: string;
  sort: ResolvedSort;
  baseParams: Record<string, string | undefined>;
}) {
  const hiddenColumns = useHiddenOrderColumns();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const pageIds = useMemo(() => rows.map((row) => row.id), [rows]);

  // Przecięcie zaznaczenia z wierszami strony — patrz nagłówek pliku.
  const selectedOnPage = useMemo(
    () => new Set(pageIds.filter((id) => selected.has(id))),
    [pageIds, selected],
  );

  const toggleRow = useCallback((id: string, isSelected: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (isSelected) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(
    (isSelected: boolean) => {
      setSelected((current) => {
        const next = new Set(current);
        for (const id of pageIds) {
          if (isSelected) next.add(id);
          else next.delete(id);
        }
        return next;
      });
    },
    [pageIds],
  );

  const clear = useCallback(() => setSelected(new Set()), []);

  return (
    <>
      <OrdersTable
        rows={rows}
        currency={currency}
        locale={locale}
        sort={sort}
        baseParams={baseParams}
        hiddenColumns={hiddenColumns}
        selectedIds={selectedOnPage}
        onToggleRow={toggleRow}
        onToggleAll={toggleAll}
      />
      <OrdersBulkActions
        selectedIds={[...selectedOnPage]}
        pageCount={rows.length}
        onClear={clear}
      />
    </>
  );
}
