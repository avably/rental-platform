import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { useTranslations } from "next-intl";

import { CUSTOMERS_LIST_SKELETON_ROWS } from "./screen-regions";
import {
  SkeletonBlock,
  SkeletonLine,
  SkeletonRegion,
  SkeletonScreen,
  times,
} from "./skeleton-primitives";

/**
 * Szkielet ładowania LISTY klientów (R6a).
 *
 * Odwzorowuje ekran: podtytuł, belka z wyszukiwarką i licznikiem, tabela na
 * desktopie i stos kart poniżej `md`. Klasy kontenerów są KOPIĄ klas z ekranu
 * (`customers-table.tsx`, `page.tsx`) — stąd brak skoku przy podmianie treści.
 *
 * Zbioru regionów pilnuje `CUSTOMERS_LIST_REGIONS` w `screen-regions.ts` przez
 * `test/customers-skeleton-parity.test.tsx`.
 */

/** Kopia `HEAD_CLASS` z `customers-table.tsx` — geometria nagłówka tabeli. */
const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/** Kopia geometrii komórki treściowej: `p-0`, wypełnia ją kotwica o h-[52px]. */
const CELL_CLASS = "h-[52px] p-0";

/** Szerokości pasków nagłówka „na oko" — jedna wysokość, 14px jak `<th>`. */
const HEAD_WIDTHS = ["w-20", "w-24", "w-16", "w-16", "w-24"];

function CellBar({ className, align }: { className?: string; align?: "right" }) {
  return (
    <div className={cn("flex h-[52px] items-center px-3.5", align === "right" && "justify-end")}>
      <SkeletonBlock className={cn("h-3.5 rounded-[6px]", className)} />
    </div>
  );
}

export function CustomersListSkeleton() {
  const t = useTranslations("customers.list");

  return (
    <SkeletonScreen label={t("loading")} className="flex flex-col gap-4">
      {/* Nagłówek: sam podtytuł (text-sm → 20px). */}
      <SkeletonRegion region="header" className="flex flex-wrap items-center justify-between gap-3">
        <SkeletonLine line="text" className="w-80" />
      </SkeletonRegion>

      {/* Wyszukiwarka (h-10) + licznik wyników (text-sm). Ten sam przełom
          kolumna→rząd na `sm`, więc wysokość zgadza się w obu wariantach. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SkeletonRegion region="search" className="relative flex-1">
          <SkeletonBlock className="h-10 w-full rounded-md" />
        </SkeletonRegion>
        <SkeletonRegion region="result-count" className="shrink-0">
          <SkeletonLine line="text" className="w-24" />
        </SkeletonRegion>
      </div>

      {/* Desktop: ta sama ramka i ta sama tabela co ekran (`min-w-3xl`). */}
      <SkeletonRegion
        region="table"
        className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block"
      >
        <Table className="min-w-3xl border-collapse">
          <TableHeader>
            <TableRow>
              {HEAD_WIDTHS.map((width, column) => (
                <TableHead
                  key={`${width}-${column}`}
                  data-skeleton-region="table-head"
                  className={cn(HEAD_CLASS, column === 3 && "text-right")}
                >
                  <SkeletonLine line="micro" className={cn(width, column === 3 && "ml-auto")} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {times(CUSTOMERS_LIST_SKELETON_ROWS).map((row) => (
              <TableRow key={row} data-skeleton-region="table-row">
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-40" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-48" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-28" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-10" align="right" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-24" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SkeletonRegion>

      {/* Mobile: karta o geometrii z `customers-table.tsx` (awatar + dwie linie
          treści + rząd meta, `p-4`, obrys). */}
      <SkeletonRegion region="mobile-cards" className="flex flex-col gap-3 md:hidden">
        {times(CUSTOMERS_LIST_SKELETON_ROWS).map((card) => (
          <SkeletonRegion
            key={card}
            region="mobile-card"
            className="border-border bg-card block rounded-lg border p-4"
          >
            <div className="flex items-center gap-3">
              <SkeletonBlock className="size-8 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1">
                <SkeletonLine line="body" className="w-40" />
                <SkeletonLine line="text" className="mt-1 w-48" />
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              <SkeletonLine line="text" className="w-24" />
              <SkeletonLine line="text" className="w-20" />
              <SkeletonLine line="text" className="w-24" />
            </div>
          </SkeletonRegion>
        ))}
      </SkeletonRegion>
    </SkeletonScreen>
  );
}
