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

import { ORDERS_LIST_SKELETON_ROWS } from "./screen-regions";
import {
  SkeletonBlock,
  SkeletonLine,
  SkeletonRegion,
  SkeletonScreen,
  times,
} from "./skeleton-primitives";

/**
 * Szkielet ładowania LISTY zamówień (uwaga przeglądu N1).
 *
 * Odwzorowuje ekran po przebudowie U1/U2/U3 (#113): podtytuł z akcją, cztery
 * kafle statystyk, belka z wyszukiwarką i licznikiem, szybkie chipy zakresu,
 * zwinięte „Filtry zaawansowane", sortowalna tabela na desktopie i stos kart
 * poniżej `md`. Klasy kontenerów są KOPIĄ klas z ekranu — stąd brak skoku przy
 * podmianie treści (liczby z pomiaru w dzienniku dokumentacji).
 *
 * Zbioru regionów pilnuje `ORDERS_LIST_REGIONS` w `screen-regions.ts` przez
 * `test/skeleton-parity-contract.test.tsx`.
 */

/** Szerokości pasków nagłówka „na oko" — wysokość jedna, 14px jak `<th>`. */
const HEAD_WIDTHS = ["w-10", "w-16", "w-20", "w-16", "w-14", "w-24", "w-24", "w-4"];

/** Kopia `HEAD_CLASS` z `orders-table.tsx` — geometria nagłówka tabeli. */
const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/**
 * Kopia geometrii komórki TREŚCIOWEJ z `orders-table.tsx`: po naprawie #117
 * komórka nie ma własnego paddingu, bo wypełnia ją kotwica `CellLink`.
 */
const CELL_CLASS = "h-[52px] p-0";

/**
 * Pasek wewnątrz komórki treściowej — odpowiednik `CellLink`: to on, a nie
 * komórka, niesie wysokość 52 px i padding poziomy.
 */
function CellBar({ className, align }: { className?: string; align?: "right" }) {
  return (
    <div
      className={cn(
        "flex h-[52px] items-center px-3.5",
        align === "right" && "justify-end",
      )}
    >
      <SkeletonBlock className={cn("h-3.5 rounded-[6px]", className)} />
    </div>
  );
}

export function OrdersListSkeleton() {
  const t = useTranslations("orders.list");

  return (
    <SkeletonScreen label={t("loading")} className="flex flex-col gap-4">
      {/* Nagłówek: podtytuł (text-sm → 20px) i przycisk akcji (h-9). */}
      <SkeletonRegion
        region="header"
        className="flex flex-wrap items-center justify-between gap-3"
      >
        <SkeletonLine line="text" className="w-72" />
        <SkeletonBlock className="h-9 w-40 rounded-md" />
      </SkeletonRegion>

      {/* Cztery kafle: mikro-etykieta (14) + wartość (30) + podpis (16),
          `gap-1` i `p-4` jak w `orders-stats.tsx` → 102px na kafel. Szkielet
          NIE udaje liczby: pasek nie sugeruje ani wartości, ani jej rzędu
          wielkości — to byłaby treść, której jeszcze nie znamy. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {times(4).map((tile) => (
          <SkeletonRegion
            key={tile}
            region="stat-tile"
            className="border-border bg-card flex flex-col gap-1 rounded-lg border p-4"
          >
            <SkeletonLine line="micro" className="w-20" />
            <SkeletonLine line="display" className="w-16" />
            <SkeletonLine line="caption" className="w-24" />
          </SkeletonRegion>
        ))}
      </div>

      <div className="flex flex-col gap-3">
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

        {/* JEDEN wiersz filtrów po N2 (#120): chipy zakresu z lewej (31 px —
            `px-3.5 py-2` + `text-[13px] leading-none` + obrys), a z prawej
            „Kolumny" i „Filtry zaawansowane" jako WĄSKIE przyciski h-9.
            Zaawansowane były wcześniej pasem pełnej szerokości (46 px); ta
            zmiana geometrii jest właśnie tym, czego szkielet nie może
            przegapić. Ten sam przełom `sm` (prawa grupa `w-full` → `sm:w-auto`),
            więc wysokość zgadza się w obu wariantach. */}
        <SkeletonRegion region="filter-row" className="flex flex-wrap items-start gap-2">
          <div className="flex flex-1 flex-wrap gap-2">
            {times(3).map((chip) => (
              <SkeletonRegion key={chip} region="preset-chip">
                <SkeletonBlock className="h-[31px] w-32 rounded-md" />
              </SkeletonRegion>
            ))}
          </div>
          <div className="flex w-full flex-wrap items-start gap-2 sm:w-auto">
            <SkeletonRegion region="columns-menu">
              <SkeletonBlock className="h-9 w-36 rounded-lg" />
            </SkeletonRegion>
            {/* Panel zaawansowany wchodzi ZWINIĘTY i wychodzi NAKŁADKĄ, więc
                szkielet maluje sam przycisk — rozwinięta treść byłaby
                obietnicą, której ekran nie spełni. */}
            <SkeletonRegion
              region="advanced-filters"
              className="w-full sm:w-auto"
            >
              <SkeletonBlock className="h-9 w-full rounded-lg sm:w-44" />
            </SkeletonRegion>
          </div>
        </SkeletonRegion>
      </div>

      {/* Desktop: ta sama ramka i ta sama tabela co ekran. Po U5 minimalna
          szerokość zależy od liczby WIDOCZNYCH kolumn — szkielet zakłada
          komplet (nie zna preferencji z `localStorage`), czyli `min-w-4xl`
          jak `tableMinWidthClass(6)`. */}
      <SkeletonRegion
        region="table"
        className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block"
      >
        <Table className="min-w-4xl border-collapse">
          <TableHeader>
            <TableRow>
              {/* Kolumna zaznaczenia (U4): `w-11`, checkbox `size-4`. */}
              <TableHead
                data-skeleton-region="table-head"
                className="h-auto w-11 px-3.5 py-3"
              >
                {/* `inline-block` nie jest ozdobnikiem: realny checkbox to
                    `<button>`, czyli element LINIOWY, więc komórka nagłówka
                    dostaje jeszcze strut linii (`text-sm` tabeli) i ma 44,5 px,
                    a nie 40,5. Blokowy pasek zjadłby te 4 px i cała tabela
                    przesunęłaby się po wejściu treści. */}
                <SkeletonRegion region="select-all" className="inline-block align-middle">
                  <SkeletonBlock className="size-4 rounded-[4px]" />
                </SkeletonRegion>
              </TableHead>
              {HEAD_WIDTHS.map((width, column) => (
                <TableHead
                  key={`${width}-${column}`}
                  data-skeleton-region="table-head"
                  className={HEAD_CLASS}
                >
                  <SkeletonLine line="micro" className={width} />
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {times(ORDERS_LIST_SKELETON_ROWS).map((row) => (
              <TableRow key={row} data-skeleton-region="table-row">
                <TableCell className="h-[52px] px-3.5 py-2.5">
                  <SkeletonRegion region="select-row" className="inline-block align-middle">
                    <SkeletonBlock className="size-4 rounded-[4px]" />
                  </SkeletonRegion>
                </TableCell>
                {/* Komórki treściowe nie mają własnego paddingu (`p-0`) —
                    wypełnia je kotwica `CellLink` o wysokości 52 px, więc
                    pasek siedzi w środku takiej samej ramki. */}
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-24" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-32" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-40" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-36" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="w-20" align="right" />
                </TableCell>
                {/* Chip statusu ma WŁASNĄ wysokość (h-7) — pasek ją kopiuje,
                    inaczej wiersz „usiadłby" po wejściu treści. */}
                <TableCell className={CELL_CLASS}>
                  <CellBar className="h-7 w-24 rounded-sm" />
                </TableCell>
                <TableCell className={CELL_CLASS}>
                  <CellBar className="h-7 w-24 rounded-sm" />
                </TableCell>
                <TableCell className="h-[52px] px-3.5 py-2.5 text-right">
                  <SkeletonLine className="ml-auto w-6" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SkeletonRegion>

      {/* Mobile: checkbox OBOK karty (U4) i karta o geometrii z
          `orders-table.tsx` (24 + 8 + 28 + 4 + 20 + 12 + 28 treści, `p-4`,
          obrys) = 158px. */}
      <SkeletonRegion region="mobile-cards" className="flex flex-col gap-3 md:hidden">
        {times(ORDERS_LIST_SKELETON_ROWS).map((card) => (
          <div key={card} className="flex items-start gap-2">
            <SkeletonRegion region="select-card" className="mt-4 shrink-0">
              <SkeletonBlock className="size-4 rounded-[4px]" />
            </SkeletonRegion>
            <SkeletonRegion
              region="mobile-card"
              className="border-border bg-card block min-w-0 flex-1 rounded-lg border p-4"
            >
              <div className="flex items-baseline justify-between gap-3">
                <SkeletonLine line="body" className="w-28" />
                <SkeletonLine line="body" className="w-20" />
              </div>
              <div className="mt-2 flex items-center gap-2">
                <SkeletonBlock className="size-7 shrink-0 rounded-full" />
                <SkeletonLine line="text" className="w-40" />
              </div>
              <div className="mt-1">
                <SkeletonLine line="text" className="w-36" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <SkeletonBlock className="h-7 w-24 rounded-sm" />
                <SkeletonBlock className="h-7 w-24 rounded-sm" />
              </div>
            </SkeletonRegion>
          </div>
        ))}
      </SkeletonRegion>
    </SkeletonScreen>
  );
}
