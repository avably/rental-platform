import {
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from "@avably/ui";
import { formatMoney, type CurrencyCode } from "@avably/core";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { type ProductSortKey } from "@/lib/catalog-validation";
import { availabilityBadgeProps } from "@/lib/catalog/availability-chip";
import { deploymentCellProps } from "@/lib/catalog/deployed-today";
import {
  ariaSortForProduct,
  productSortHref,
  type ResolvedProductSort,
} from "@/lib/catalog/product-sort";
import { type ProductThumbnail } from "@/lib/catalog/product-thumbnail";

import { ProductRowActions } from "./product-row-actions";

/**
 * Tabela katalogu produktów w designie Fazy 2 (ADR-058), rozbudowana w U8a
 * (ADR-145) o miniaturę, kolumnę „Dziś w terenie" i sortowalne nagłówki.
 *
 * Forma wprost z listy zamówień (ADR-057): ramka z przewijaniem POZIOMYM
 * tabeli zamiast całej strony, nagłówki jako micro-label z sekcji 02, kwoty
 * i liczby w `tabular-nums` (kolumna liczb ma się nie „chwiać" między
 * wierszami), stan wiersza i obrys focusu na elemencie TABOWALNYM — czyli na
 * linku z nazwą, nie na `<tr>` (lekcja ADR-057 D5).
 *
 * DWA WARIANTY, JEDEN MODEL WIERSZA (ADR-205). Do progu `md` tabela ustępuje
 * STOSOWI KART — wzorzec głównych list zamówień i klientów: pomiar ADR-204
 * pokazał, że katalog był JEDYNĄ główną listą bez wariantu mobilnego i na
 * telefonie (390 px) operator przewijał tabelę w bok przy każdym produkcie.
 * Karta niesie KOMPLET kolumn tabeli (miniatura, nazwa, cena/doba, kaucja,
 * egzemplarze, dziś w terenie, status, akcje) — nic nie chowa się za
 * rozwinięciem ani przewijaniem; pilnuje tego `katalog-karta-kompletnosc`,
 * a geometrię na telefonie `packages/e2e/tests/09-katalog-mobilny.spec.ts`.
 *
 * DWIE OSIE, DWIE KOLUMNY. „Status" niesie flagę PUBLIKACJI
 * (`availability-chip.ts`), „Dziś w terenie" — obecność FIZYCZNĄ
 * (`deployed-today.ts`). Nazwy i atrybuty `data-catalog-axis` są rozdzielne,
 * żeby w produkcie nie powstały dwie różne liczby pod jedną nazwą.
 *
 * KOMPONENT PREZENTACYJNY (bez I/O, bez async): dostaje gotowe wiersze, więc
 * kontrakt renderu może go wywołać na fixture bez Supabase i bez Next.js.
 */

export interface ProductsTableRow {
  id: string;
  name: string;
  basePriceDayGrosze: number;
  depositGrosze: number;
  active: boolean;
  unitCount: number;
  /** Liczba pozycji tego produktu fizycznie w terenie DZIŚ. */
  deployedToday: number;
  /** Miniatura pierwszego zdjęcia albo `null` — wtedy placeholder. */
  thumbnail: ProductThumbnail | null;
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

const CELL_CLASS = "h-[52px] px-3.5 py-2.5";

/** Micro-label pola karty mobilnej — typografia nagłówka tabeli bez jej
 * paddingów, żeby oba warianty mówiły jednym głosem (sekcja 02 artefaktu). */
const CARD_LABEL_CLASS =
  "text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export function ProductsTable({
  rows,
  currency,
  locale,
  sort,
  baseParams,
}: {
  rows: ProductsTableRow[];
  currency: CurrencyCode;
  locale: string;
  /** Efektywny sort (klucz + kierunek) — dla `aria-sort` i strzałek nagłówków. */
  sort: ResolvedProductSort;
  /** Zatwierdzone parametry URL zachowywane w linkach sortu. */
  baseParams: Record<string, string | undefined>;
}) {
  const t = useTranslations("catalog.list");

  const sortableHead = (label: string, key: ProductSortKey, align: "left" | "right" = "left") => (
    <TableHead
      aria-sort={ariaSortForProduct(key, sort)}
      className={cn(HEAD_CLASS, align === "right" && "text-right")}
    >
      <Link
        href={`/katalog${productSortHref(baseParams, key, sort)}`}
        data-sort-key={key}
        aria-label={t("sortBy", { column: label })}
        className={cn(
          "inline-flex items-center gap-1 rounded-sm text-inherit no-underline outline-none hover:text-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring",
          align === "right" && "flex-row-reverse",
        )}
      >
        <span>{label}</span>
        <SortArrow active={sort.key === key} dir={sort.dir} />
      </Link>
    </TableHead>
  );

  return (
    <>
      {/* Desktop: tabela. Ramka i przewijanie poziome jak dotąd — dopiero na
          wąskim md schodzimy na karty niżej (wzorzec orders/customers). */}
      <div className="border-border bg-card hidden overflow-x-auto rounded-lg border md:block">
        <Table className="min-w-[860px] border-collapse">
          <TableHeader>
            <TableRow className="hover:border-b-border">
              {/* Szerokość kolumny miniatury jest PRZYPIĘTA (w-14 = 56 px = 40 px
                  obrazu + padding). Bez tego auto-layout tabeli liczy minimalną
                  szerokość obrazu jako 0 (preflight daje `img { max-width: 100% }`),
                  kolumna zapada się do kilkunastu pikseli i miniatura wychodzi
                  paskiem — zmierzone w przeglądarce: komórka 28 px, obraz 13 px. */}
              <TableHead className="h-auto w-14 px-3.5 py-3">
                <span className="sr-only">{t("colThumbnail")}</span>
              </TableHead>
              {sortableHead(t("colName"), "nazwa")}
              {sortableHead(t("colPricePerDay"), "cena", "right")}
              <TableHead className={`${HEAD_CLASS} text-right`}>{t("colDeposit")}</TableHead>
              {sortableHead(t("colUnits"), "egzemplarze", "right")}
              {sortableHead(t("colDeployed"), "teren", "right")}
              <TableHead className={HEAD_CLASS}>{t("colActive")}</TableHead>
              <TableHead className="h-auto px-3.5 py-3">
                <span className="sr-only">{t("colActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-product-row data-product-id={row.id}>
                <TableCell data-cell="thumbnail" className="h-[52px] py-2.5 pr-0 pl-3.5">
                  <Thumbnail thumbnail={row.thumbnail} />
                </TableCell>
                <TableCell data-cell="name" className={CELL_CLASS}>
                  <Link
                    className="text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                    href={`/katalog/${row.id}`}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell
                  data-cell="price"
                  className={`${CELL_CLASS} text-right tabular-nums tracking-[0.01em]`}
                >
                  {formatMoney(row.basePriceDayGrosze, currency, locale)}
                </TableCell>
                <TableCell
                  data-cell="deposit"
                  className={`${CELL_CLASS} text-right tabular-nums tracking-[0.01em]`}
                >
                  {formatMoney(row.depositGrosze, currency, locale)}
                </TableCell>
                <TableCell
                  data-cell="units"
                  className={`${CELL_CLASS} text-right tabular-nums tracking-[0.01em]`}
                >
                  {row.unitCount}
                </TableCell>
                <TableCell
                  data-cell="deployed"
                  className={`${CELL_CLASS} text-right tabular-nums tracking-[0.01em]`}
                >
                  <DeployedValue row={row} />
                </TableCell>
                <TableCell data-cell="availability" className={CELL_CLASS}>
                  <AvailabilityBadge active={row.active} />
                </TableCell>
                <TableCell data-cell="actions" className={`${CELL_CLASS} text-right`}>
                  <ProductRowActions
                    productId={row.id}
                    labels={{
                      trigger: t("rowActions", { name: row.name }),
                      edit: t("actionEdit"),
                      units: t("unitsLink"),
                      tiers: t("tiersLink"),
                      images: t("imagesLink"),
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: stos kart (ADR-205). Ta sama tablica `rows`, jeden
          wiersz-model. Model klikalności wprost z tabeli: LINKIEM jest nazwa
          (nie cała karta), a menu akcji stoi POZA kotwicą — kontrolka
          w środku `<a>` byłaby i niepoprawnym HTML-em, i pułapką na klik
          (lekcja kart zamówień). Komplet kolumn tabeli na wierzchu: zero
          `hidden`/`<details>` chowających dane (ADR-188). */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            data-product-card
            data-product-id={row.id}
            className="border-border bg-card rounded-lg border p-4"
          >
            <div className="flex items-start gap-3">
              <span data-card-field="thumbnail" className="shrink-0">
                <Thumbnail thumbnail={row.thumbnail} />
              </span>
              <div className="min-w-0 flex-1">
                {/* `break-words`: nazwa produktu to dana pierwszorzędna —
                    zawija się w dół, nigdy nie rozpycha karty w bok i nigdy
                    nie jest ucinana wielokropkiem. */}
                <Link
                  data-card-field="name"
                  href={`/katalog/${row.id}`}
                  className="text-foreground rounded-sm font-medium break-words no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                >
                  {row.name}
                </Link>
                <div data-card-field="availability" className="mt-1.5">
                  <AvailabilityBadge active={row.active} />
                </div>
              </div>
              <span data-card-field="actions" className="-mt-1 -mr-2 shrink-0">
                <ProductRowActions
                  productId={row.id}
                  labels={{
                    trigger: t("rowActions", { name: row.name }),
                    edit: t("actionEdit"),
                    units: t("unitsLink"),
                    tiers: t("tiersLink"),
                    images: t("imagesLink"),
                  }}
                />
              </span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
              <div data-card-field="price">
                <dt className={CARD_LABEL_CLASS}>{t("colPricePerDay")}</dt>
                <dd className="text-foreground mt-0.5 text-sm tabular-nums tracking-[0.01em]">
                  {formatMoney(row.basePriceDayGrosze, currency, locale)}
                </dd>
              </div>
              <div data-card-field="deposit">
                <dt className={CARD_LABEL_CLASS}>{t("colDeposit")}</dt>
                <dd className="text-foreground mt-0.5 text-sm tabular-nums tracking-[0.01em]">
                  {formatMoney(row.depositGrosze, currency, locale)}
                </dd>
              </div>
              <div data-card-field="units">
                <dt className={CARD_LABEL_CLASS}>{t("colUnits")}</dt>
                <dd className="text-foreground mt-0.5 text-sm tabular-nums tracking-[0.01em]">
                  {row.unitCount}
                </dd>
              </div>
              <div data-card-field="deployed">
                <dt className={CARD_LABEL_CLASS}>{t("colDeployed")}</dt>
                <dd className="mt-0.5 text-sm tabular-nums tracking-[0.01em]">
                  <DeployedValue row={row} />
                </dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Wartość „dziś w terenie" — WSPÓLNA dla komórki tabeli i pola karty, żeby
 * oba warianty nie rozjechały się przy pierwszej poprawce (ta sama oś
 * `deployment`, ten sam zapis „x z y" i ten sam myślnik przy braku
 * egzemplarzy).
 */
function DeployedValue({ row }: { row: ProductsTableRow }) {
  const t = useTranslations("catalog.list");
  return (
    <span
      {...deploymentCellProps(row.deployedToday, row.unitCount)}
      className={cn(
        row.deployedToday > 0 ? "text-foreground font-medium" : "text-muted-foreground",
      )}
    >
      {row.unitCount === 0 && row.deployedToday === 0
        ? t("deployedNone")
        : t("deployedOf", { deployed: row.deployedToday, total: row.unitCount })}
    </span>
  );
}

/** Odznaka publikacji — wspólna dla obu wariantów z tego samego powodu. */
function AvailabilityBadge({ active }: { active: boolean }) {
  const t = useTranslations("catalog.list");
  return (
    <StatusBadge {...availabilityBadgeProps(active)}>
      {active ? t("activeYes") : t("activeNo")}
    </StatusBadge>
  );
}

/**
 * Miniatura albo PLACEHOLDER — nigdy dziura. Produkt bez zdjęcia dostaje
 * kafelek z ikoną, żeby kolumna nie „skakała" i żeby brak zdjęcia był
 * widoczny jako brak, a nie jako błąd ładowania.
 *
 * Rozmiar idzie ze skali (`size-10` = 40 px), nie z wartości arbitralnej —
 * kontrakt `panel-consistency-contract` trzyma szerokości w jednej notacji.
 * `loading="lazy"` + `decoding="async"`: przy stu wierszach miniatury nie
 * mają prawa blokować pierwszego malowania listy.
 */
function Thumbnail({ thumbnail }: { thumbnail: ProductThumbnail | null }) {
  if (thumbnail === null) {
    return (
      <span
        data-product-thumbnail="placeholder"
        aria-hidden="true"
        className="border-border bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-md border"
      >
        <PhotoGlyph />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- zdjęcie z publicznego bucketu Storage (goły URL publiczny, ADR-145), nie zasób lokalny next/image
    <img
      data-product-thumbnail="image"
      src={thumbnail.url}
      alt={thumbnail.alt}
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      // `min-w-10` NIE jest ozdobnikiem: preflight daje `img { max-width:
      // 100% }`, więc w auto-layoucie tabeli minimalna szerokość obrazu
      // wychodzi 0, kolumna zapada się, a miniatura schodzi do paska
      // (zmierzone: komórka 28 px, obraz 13 px). `min-width` wygrywa nad
      // `max-width` w kaskadzie, więc przywraca kolumnie realne minimum.
      className="border-border size-10 min-w-10 rounded-md border object-cover"
    />
  );
}

function PhotoGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="6.5" cy="7.5" r="1.3" fill="currentColor" />
      <path
        d="M3 12.5l3.5-3 3 2.5 2.5-2 3 2.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SortArrow({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  return (
    <span
      aria-hidden="true"
      className={cn("text-[9px] leading-none", active ? "opacity-100" : "opacity-30")}
    >
      {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
    </span>
  );
}
