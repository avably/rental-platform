import { useTranslations } from "next-intl";

import { CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS } from "./screen-regions";
import { SkeletonBlock, SkeletonLine, SkeletonRegion, SkeletonScreen, times } from "./skeleton-primitives";

/**
 * Szkielet ładowania KARTY klienta (R6a).
 *
 * Odwzorowuje ekran: powrót do listy, nagłówek z nazwą, formularz edycji
 * (kontakt + faktura + adres = osiem pól) z przyciskiem zapisu, karta historii
 * zamówień (tabela na desktopie, karty poniżej `md`). Klasy kontenerów są
 * KOPIĄ klas ekranu (`customer-edit-form.tsx`, `customer-orders.tsx`,
 * `[id]/page.tsx`).
 *
 * Zbioru regionów pilnuje `CUSTOMER_DETAIL_REGIONS` w `screen-regions.ts` przez
 * `test/customers-skeleton-parity.test.tsx`.
 */

/** Pole formularza: etykieta (text-sm) nad polem (h-9 jak `Input`). */
function FieldSkeleton() {
  return (
    <SkeletonRegion region="field" className="flex flex-col gap-1.5">
      <SkeletonLine line="text" className="w-28" />
      <SkeletonBlock className="h-9 w-full rounded-md" />
    </SkeletonRegion>
  );
}

export function CustomerDetailSkeleton() {
  const t = useTranslations("customers.card");

  return (
    <SkeletonScreen label={t("historyHeading")} className="flex flex-col gap-6">
      {/* Powrót do listy + nazwa klienta. */}
      <div className="flex flex-col gap-2">
        <SkeletonRegion region="back">
          <SkeletonLine line="text" className="w-40" />
        </SkeletonRegion>
        <div className="flex flex-col gap-1">
          <SkeletonLine line="display" className="w-56" />
          <SkeletonLine line="text" className="w-32" />
        </div>
      </div>

      {/* Ban-lista (R6b): karta ze stanem i przyciskiem — ta sama karta `p-5`. */}
      <SkeletonRegion
        region="ban"
        className="border-border bg-card flex flex-wrap items-start justify-between gap-3 rounded-md border p-5"
      >
        <div className="flex flex-col gap-1.5">
          <SkeletonLine line="micro" className="w-20" />
          <SkeletonLine line="text" className="w-64" />
        </div>
        <SkeletonBlock className="h-9 w-36 rounded-md" />
      </SkeletonRegion>

      {/* Formularz edycji (kontakt + faktura + adres). Ta sama karta `p-5`. */}
      <SkeletonRegion
        region="edit-form"
        className="border-border bg-card flex flex-col gap-6 rounded-md border p-5"
      >
        <div className="flex flex-col gap-4">
          <SkeletonLine line="micro" className="w-32" />
          <FieldSkeleton />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonLine line="micro" className="w-32" />
          <FieldSkeleton />
          <FieldSkeleton />
        </div>
        <div className="flex flex-col gap-4">
          <SkeletonLine line="micro" className="w-24" />
          <FieldSkeleton />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
        </div>
        <SkeletonRegion region="save">
          <SkeletonBlock className="h-9 w-36 rounded-md" />
        </SkeletonRegion>
      </SkeletonRegion>

      {/* Historia zamówień — karta z tabelą (desktop) i kartami (mobile). */}
      <SkeletonRegion
        region="history"
        className="border-border bg-card flex flex-col gap-4 rounded-md border p-5"
      >
        <div className="flex flex-col gap-1">
          <SkeletonLine line="micro" className="w-40" />
          <SkeletonLine line="text" className="w-72" />
        </div>

        {/* Desktop: wiersze historii o wysokości h-[52px] jak realne. */}
        <div className="border-border hidden overflow-x-auto rounded-lg border md:block">
          <div className="border-border flex items-center gap-4 border-b px-3.5 py-3">
            {["w-16", "w-24", "w-16", "w-16"].map((width, column) => (
              <SkeletonLine key={`${width}-${column}`} line="micro" className={width} />
            ))}
          </div>
          {times(CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS).map((historyRow) => (
            <div
              key={historyRow}
              data-skeleton-region="history-row"
              className="border-border flex h-[52px] items-center gap-4 border-b px-3.5 last:border-b-0"
            >
              <SkeletonBlock className="h-3.5 w-24 rounded-[6px]" />
              <SkeletonBlock className="h-3.5 w-32 rounded-[6px]" />
              <SkeletonBlock className="h-3.5 w-16 rounded-[6px]" />
              <SkeletonBlock className="h-7 w-24 rounded-sm" />
            </div>
          ))}
        </div>

        {/* Mobile: karty historii. */}
        <ul className="flex flex-col gap-3 md:hidden">
          {times(CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS).map((historyCard) => (
            <li
              key={historyCard}
              data-skeleton-region="history-card"
              className="border-border bg-card block rounded-lg border p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <SkeletonLine line="body" className="w-28" />
                <SkeletonLine line="body" className="w-20" />
              </div>
              <SkeletonLine line="text" className="mt-1 w-36" />
              <SkeletonBlock className="mt-3 h-7 w-24 rounded-sm" />
            </li>
          ))}
        </ul>
      </SkeletonRegion>
    </SkeletonScreen>
  );
}
