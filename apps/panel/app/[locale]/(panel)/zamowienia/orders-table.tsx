import {
  Checkbox,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { formatMoney, type CurrencyCode, type OrderStatus, type PaymentStatus } from "@avably/core";
import { useTranslations } from "next-intl";
import { Fragment, type ReactNode } from "react";

import { Link } from "@/i18n/navigation";
import type { FormState } from "@/lib/form-state";
import { StatusChip } from "@/lib/orders/status-chip";
import { ariaSortFor, orderSortHref, type ResolvedSort } from "@/lib/orders/order-sort";
import { type OrderColumnKey } from "@/lib/orders/order-columns";
import { type OrderSortKey } from "@/lib/order-validation";

import { OrderRowActions } from "./order-row-actions";

/** Akcja archiwizacji/przywracania — sygnatura useActionState (ADR-242). */
export type OrderArchiveAction = (
  prevState: FormState,
  formData: FormData,
) => Promise<FormState>;

/**
 * Sterowanie archiwum listy (ADR-242) — przekazane z RSC `page.tsx` przez
 * warstwę kliencką aż do menu wiersza. `archived` mówi, w którym WIDOKU jest
 * lista (aktywne vs archiwum), więc menu wiersza pokazuje „Archiwizuj" albo
 * „Przywróć". Nieobecne (undefined) = akcje archiwum się nie renderują (okno
 * domykania, kontrakt renderu bez Supabase) — tabela zostaje prezentacyjna.
 */
export interface OrdersArchiveControls {
  archived: boolean;
  archiveAction: OrderArchiveAction;
  restoreAction: OrderArchiveAction;
}

/**
 * Tabela listy zamówień (sekcja 04 artefaktu Fazy 2, ADR-057; przegląd U2–U5).
 *
 * Kolumny co do znaku jak w artefakcie: zaznaczenie / ID / Klient / Sprzęt /
 * Termin / Kwota / Status zamówienia / Status płatności / Akcje. Nowości
 * przeglądu:
 *  - nagłówki SORTOWALNE (U2) — link zmienia sort/dir w URL, `aria-sort` niesie
 *    stan; „#" sortuje chronologicznie (created_at), patrz order-sort.ts;
 *  - CAŁY wiersz prowadzi do szczegółu (U3) — KAŻDA WIDOCZNA komórka treściowa
 *    niesie własną kotwicę wypełniającą komórkę (`CellLink`); kolumny
 *    zaznaczenia i Akcji zostają BEZ linku, więc checkbox i menu klikają się
 *    niezależnie;
 *  - ZAZNACZANIE wierszy (U4) — stan trzyma `orders-list.tsx`, tabela jest
 *    sterowana propsami;
 *  - WYBÓR KOLUMN (U5) — `hiddenColumns` decyduje, które kolumny treściowe się
 *    RENDERUJĄ. Nie `display:none`: ukryta kolumna nie ma prawa zostawiać
 *    w DOM ani kotwicy, ani treści dla czytnika ekranu;
 *  - na wąskim ekranie zamiast poziomego przewijania — STOS KART (U3), ten sam
 *    wiersz-model, z checkboxem OBOK karty (a nie wewnątrz kotwicy).
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async, bez własnego stanu): dostaje
 * gotowe wiersze, efektywny `sort`, zbiór ukrytych kolumn i zaznaczenie, więc
 * kontrakt renderu wywołuje go na fixture bez Supabase i bez `localStorage`.
 */

export interface OrdersTableRow {
  id: string;
  orderNumber: string;
  /** Etykieta klienta: nazwa albo e-mail albo „—" (gotowa do wyświetlenia). */
  customerLabel: string;
  /** Rozłożone pola klienta — inicjały karty mobilnej i haystack wyszukiwarki. */
  customerName: string | null;
  customerEmail: string | null;
  /** Nazwy produktów pozycji — pierwsza w kolumnie, reszta jako „+N". */
  equipment: string[];
  startDate: string;
  endDate: string;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  totalRentalGrosze: number;
  /**
   * Waluta ZAMÓWIENIA (orders.currency, 0049/ADR-103) — własność WIERSZA,
   * nie tabeli: po zmianie ustawienia najemcy historia dalej mówi swoją
   * walutą, więc dwa wiersze tej samej listy mogą mówić dwiema.
   */
  currency: CurrencyCode;
}

/**
 * Termin jako zakres w formacie locale (`formatRange` sam skraca powtórzony
 * miesiąc i rok, jak w mockupie). Daty są dniowe (`YYYY-MM-DD`), więc czytamy
 * je w UTC — w Europe/Warsaw północ UTC cofnęłaby dzień o jeden.
 */
function formatTerm(locale: string, startDate: string, endDate: string): string {
  const format = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return format.formatRange(new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T00:00:00Z`));
}

/** Inicjały klienta na awatar karty: z nazwy (max 2 słowa) albo z e-maila. */
function initialsFor(name: string | null, email: string | null): string {
  const source = name?.trim() || email?.trim() || "";
  if (source === "") return "—";
  const words = source.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? `${words[0]![0]}${words[1]![0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

/**
 * Komórka treściowa nie ma własnego paddingu — wypełnia ją kotwica `CellLink`,
 * więc klikalny jest cały prostokąt komórki, nie sam tekst.
 */
const CELL_CLASS = "h-[52px] p-0";

/**
 * Szerokość minimalna tabeli zależy od liczby WIDOCZNYCH kolumn (U5). Stała
 * `min-w-4xl` po ukryciu czterech kolumn rozciągałaby dwie pozostałe na pół
 * ekranu, a przy komplecie kolumn brak minimum ściskałby je do nieczytelności.
 * Progi, nie wzór: klasa Tailwinda musi być literałem znanym przy budowie, a
 * kontrakt spójności panelu (ADR-060) zakazuje przypinania szerokości stylem
 * inline i notacją `w-[…]`. Trzy kubełki wystarczą — poniżej `md` tabela i tak
 * ustępuje kartom.
 */
function tableMinWidthClass(visibleColumns: number): string {
  if (visibleColumns >= 5) return "min-w-4xl";
  if (visibleColumns >= 3) return "min-w-2xl";
  return "";
}

/**
 * Kotwica wypełniająca komórkę wiersza — mechanizm „cały wiersz prowadzi do
 * szczegółu" (U3, naprawa #117).
 *
 * POPRZEDNIO był to JEDEN rozciągnięty link (`after:absolute after:inset-0`)
 * na wierszu z klasą `relative`. `position: relative` na `<tr>` NIE ustanawia
 * bloku zawierającego w Safari ani Firefoksie (pozycjonowanie elementów tabeli
 * jest historycznie niespójne) — wszystkie nakładki rozciągały się do
 * wspólnego przodka, nachodziły na siebie i klik/hover łapiła ostatnia w DOM.
 * Efekt: cała tabela prowadziła do jednego zamówienia.
 *
 * Dlatego dziś KAŻDA WIDOCZNA komórka treściowa niesie WŁASNĄ, prawdziwą
 * kotwicę do swojego zamówienia — zero pozycjonowania, zero nakładek, poprawne
 * z konstrukcji w każdej przeglądarce. Etykietę i fokus niesie jedna kotwica
 * (`primary`, komórka „#"); pozostałe są `aria-hidden` i wyjęte z taba, żeby
 * czytnik nie ogłaszał kilku identycznych linków, a Tab nie przechodził przez
 * wiersz tyle razy, ile jest kolumn.
 */
function CellLink({
  href,
  primary = false,
  align = "left",
  className,
  children,
}: {
  href: string;
  primary?: boolean;
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      data-cell-link
      data-row-link={primary ? "" : undefined}
      tabIndex={primary ? undefined : -1}
      aria-hidden={primary ? undefined : true}
      className={cn(
        "text-foreground flex h-[52px] items-center px-3.5 no-underline outline-none",
        align === "right" && "justify-end",
        primary &&
          "rounded-sm hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function OrdersTable({
  rows,
  locale,
  sort,
  baseParams,
  hiddenColumns,
  selectedIds,
  onToggleRow,
  onToggleAll,
  archiveControls,
}: {
  rows: OrdersTableRow[];
  locale: string;
  /** Efektywny sort (klucz + kierunek) — dla `aria-sort` i strzałek nagłówków. */
  sort: ResolvedSort;
  /** Zatwierdzone parametry URL zachowywane w linkach sortu. */
  baseParams: Record<string, string | undefined>;
  /** Kolumny treściowe zdjęte przez operatora (U5) — nie renderują się wcale. */
  hiddenColumns: ReadonlySet<OrderColumnKey>;
  /** Zaznaczone zamówienia WCZYTANEJ STRONY (U4). */
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  /** Archiwizacja/przywracanie z menu wiersza (ADR-242); brak = bez akcji. */
  archiveControls?: OrdersArchiveControls;
}) {
  const t = useTranslations("orders.list");

  const sortableHead = (label: string, key: OrderSortKey, align: "left" | "right" = "left") => {
    const href = `/zamowienia${orderSortHref(baseParams, key, sort)}`;
    const active = sort.key === key;
    return (
      <TableHead aria-sort={ariaSortFor(key, sort)} className={cn(HEAD_CLASS, align === "right" && "text-right")}>
        <Link
          href={href}
          data-sort-key={key}
          aria-label={t("sortBy", { column: label })}
          className={cn(
            "inline-flex items-center gap-1 rounded-sm text-inherit no-underline outline-none hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
            align === "right" && "flex-row-reverse",
          )}
        >
          <span>{label}</span>
          <SortArrow active={active} dir={sort.dir} />
        </Link>
      </TableHead>
    );
  };

  /**
   * Kolumny treściowe opisane W JEDNYM MIEJSCU: nagłówek stoi obok komórki,
   * więc nie da się dodać jednego bez drugiego, a ukrywanie (U5) jest filtrem
   * po tej samej liście — nagłówek i komórka znikają razem albo wcale.
   */
  const columns: {
    key: OrderColumnKey;
    head: ReactNode;
    align?: "right";
    className?: string;
    cell: (row: OrdersTableRow) => ReactNode;
  }[] = [
    {
      key: "customer",
      head: sortableHead(t("colCustomer"), "klient"),
      className: "font-medium",
      cell: (row) => row.customerLabel,
    },
    {
      key: "equipment",
      head: <TableHead className={HEAD_CLASS}>{t("colEquipment")}</TableHead>,
      cell: (row) => (
        <span>
          {row.equipment[0] ?? "—"}
          {row.equipment.length > 1 ? (
            <span className="text-muted-foreground">
              {" "}
              {t("itemsMore", { count: row.equipment.length - 1 })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "date",
      head: sortableHead(t("colTerm"), "termin"),
      className: "tabular-nums tracking-[0.01em]",
      cell: (row) => formatTerm(locale, row.startDate, row.endDate),
    },
    {
      key: "amount",
      head: sortableHead(t("colAmount"), "kwota", "right"),
      align: "right",
      className: "tabular-nums tracking-[0.01em]",
      cell: (row) => formatMoney(row.totalRentalGrosze, row.currency, locale),
    },
    {
      key: "order-status",
      head: sortableHead(t("colOrderStatus"), "status"),
      cell: (row) => <StatusChip axis="order" value={row.orderStatus} />,
    },
    {
      key: "payment-status",
      head: sortableHead(t("colPaymentStatus"), "platnosc"),
      cell: (row) => <StatusChip axis="payment" value={row.paymentStatus} />,
    },
  ];

  const visibleColumns = columns.filter((column) => !hiddenColumns.has(column.key));

  const selectedOnPage = rows.filter((row) => selectedIds.has(row.id)).length;
  const allSelected = rows.length > 0 && selectedOnPage === rows.length;
  // Radix przyjmuje trzeci stan wprost — natywny `indeterminate` dałoby się
  // ustawić wyłącznie przez ref w efekcie, czyli po pierwszym malowaniu.
  const headChecked = allSelected ? true : selectedOnPage > 0 ? "indeterminate" : false;

  return (
    <>
      {/* Desktop: tabela. Ramka i przewijanie poziome jak `.table-scroll`
          artefaktu — dopiero na wąskim md schodzimy na karty niżej. */}
      <div className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block">
        <Table className={cn("border-collapse", tableMinWidthClass(visibleColumns.length))}>
          <TableHeader>
            <TableRow className="hover:border-b-border">
              <TableHead className="h-auto w-11 px-3.5 py-3">
                <Checkbox
                  data-orders-select-all
                  checked={headChecked}
                  onCheckedChange={(checked) => onToggleAll(checked === true)}
                  aria-label={t("selectAllOnPage")}
                />
              </TableHead>
              {sortableHead(t("colId"), "numer")}
              {visibleColumns.map((column) => (
                <Fragment key={column.key}>{column.head}</Fragment>
              ))}
              <TableHead className="h-auto px-3.5 py-3">
                <span className="sr-only">{t("colActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                data-order-row
                data-order-id={row.orderNumber}
                data-selected={selectedIds.has(row.id) ? "" : undefined}
                className="transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-within:bg-muted data-[selected]:bg-secondary"
              >
                {/* Komórka zaznaczenia — jak kolumna Akcje: BEZ kotwicy, żeby
                    klik w checkbox nie był jednocześnie klikiem w wiersz-link. */}
                <TableCell data-cell="select" className="h-[52px] px-3.5 py-2.5">
                  <Checkbox
                    data-orders-select-row
                    checked={selectedIds.has(row.id)}
                    onCheckedChange={(checked) => onToggleRow(row.id, checked === true)}
                    aria-label={t("selectRow", { number: row.orderNumber })}
                  />
                </TableCell>
                <TableCell data-cell="id" className={CELL_CLASS}>
                  <CellLink href={`/zamowienia/${row.id}`} primary>
                    <span className="font-medium tabular-nums tracking-[0.01em]">{row.orderNumber}</span>
                  </CellLink>
                </TableCell>
                {visibleColumns.map((column) => (
                  <TableCell key={column.key} data-cell={column.key} className={CELL_CLASS}>
                    <CellLink
                      href={`/zamowienia/${row.id}`}
                      align={column.align}
                      className={column.className}
                    >
                      {column.cell(row)}
                    </CellLink>
                  </TableCell>
                ))}
                <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                  <OrderRowActions
                    orderId={row.id}
                    labels={{
                      trigger: t("rowActions", { number: row.orderNumber }),
                      details: t("actionDetails"),
                      status: t("actionStatus"),
                      archive: t("actionArchive"),
                      restore: t("actionRestore"),
                    }}
                    archive={
                      archiveControls
                        ? {
                            archived: archiveControls.archived,
                            action: archiveControls.archived
                              ? archiveControls.restoreAction
                              : archiveControls.archiveAction,
                          }
                        : undefined
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stos kart. Ta sama tablica `rows`, jeden wiersz-model — cała
          karta prowadzi do szczegółu, a checkbox stoi OBOK niej: kontrolka
          w środku kotwicy byłaby i niepoprawnym HTML-em, i pułapką na klik. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="flex items-start gap-2">
            <Checkbox
              data-orders-select-card
              checked={selectedIds.has(row.id)}
              onCheckedChange={(checked) => onToggleRow(row.id, checked === true)}
              aria-label={t("selectRow", { number: row.orderNumber })}
              className="mt-4 shrink-0"
            />
            <Link
              href={`/zamowienia/${row.id}`}
              data-order-card
              data-order-id={row.orderNumber}
              className="border-border bg-card block min-w-0 flex-1 rounded-lg border p-4 no-underline outline-none transition-colors [transition-duration:var(--motion-fast)] hover:bg-muted focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground font-medium tabular-nums tracking-[0.01em]">
                  {row.orderNumber}
                </span>
                <span className="text-foreground font-semibold tabular-nums">
                  {formatMoney(row.totalRentalGrosze, row.currency, locale)}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="bg-secondary text-secondary-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                >
                  {initialsFor(row.customerName, row.customerEmail)}
                </span>
                <span className="text-foreground truncate text-sm">{row.customerLabel}</span>
              </div>
              <div className="text-muted-foreground mt-1 text-sm tabular-nums">
                {formatTerm(locale, row.startDate, row.endDate)}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusChip axis="order" value={row.orderStatus} />
                <StatusChip axis="payment" value={row.paymentStatus} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span aria-hidden="true" className={cn("text-[9px] leading-none", active ? "opacity-100" : "opacity-30")}>
      {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
    </span>
  );
}
