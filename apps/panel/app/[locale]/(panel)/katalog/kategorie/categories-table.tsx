import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@avably/ui";
import { useTranslations } from "next-intl";

import { RowActionButton } from "@/components/screens/row-action-button";
import { Link } from "@/i18n/navigation";

/**
 * Lista kategorii katalogu w kolejności prezentacji w sklepie (ADR-155).
 *
 * Kolumna „Produkty" jest tu po to, żeby usunięcie kategorii nie było ruchem
 * w ciemno: właściciel widzi, ilu produktom zdejmie przynależność, ZANIM
 * kliknie. Bez niej „Usuń" przy kategorii z 40 pozycjami wygląda tak samo jak
 * przy pustej.
 */
export interface CategoryTableRow {
  id: string;
  name: string;
  slug: string;
  productCount: number;
  first: boolean;
  last: boolean;
  moveUpAction: Parameters<typeof RowActionButton>[0]["action"];
  moveDownAction: Parameters<typeof RowActionButton>[0]["action"];
  deleteAction: Parameters<typeof RowActionButton>[0]["action"];
}

export function CategoriesTable({
  rows,
  canDelete,
}: {
  rows: CategoryTableRow[];
  /** Usuwanie zastrzeżone dla właściciela (polityka 0072) — przycisk znika. */
  canDelete: boolean;
}) {
  const t = useTranslations("catalog.categories.table");

  const headClass =
    "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      {/* Szerokość minimalna PROGIEM ZE SKALI, nie wartością arbitralną —
          wzorzec listy pól własnych i zamówień. */}
      <Table className="min-w-3xl border-collapse">
        <TableHeader>
          <TableRow className="hover:border-b-border">
            <TableHead className={headClass}>{t("name")}</TableHead>
            <TableHead className={headClass}>{t("slug")}</TableHead>
            <TableHead className={headClass}>{t("products")}</TableHead>
            <TableHead className="h-auto px-3.5 py-3">
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-category-row data-category-id={row.id}>
              <TableCell data-cell="name" className="h-[52px] px-3.5 py-2.5">
                <Link
                  className="text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                  href={`/katalog/kategorie/${row.id}`}
                >
                  {row.name}
                </Link>
              </TableCell>
              <TableCell
                data-cell="slug"
                className="text-muted-foreground h-[52px] px-3.5 py-2.5 font-mono text-[13px]"
              >
                {row.slug}
              </TableCell>
              <TableCell data-cell="products" className="h-[52px] px-3.5 py-2.5 tabular-nums">
                {row.productCount}
              </TableCell>
              <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                <span className="inline-flex items-start gap-2">
                  <RowActionButton
                    action={row.moveUpAction}
                    label={t("moveUp")}
                    disabled={row.first}
                  />
                  <RowActionButton
                    action={row.moveDownAction}
                    label={t("moveDown")}
                    disabled={row.last}
                  />
                  {canDelete ? (
                    <RowActionButton action={row.deleteAction} label={t("delete")} />
                  ) : null}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
