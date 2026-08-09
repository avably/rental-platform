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

import { RowActionButton } from "./row-action-button";

/**
 * Lista definicji jednej encji, w kolejności, w jakiej pola pojawią się na
 * formularzu (i — w części 2 — na umowie).
 *
 * Zarchiwizowane NIE ZNIKAJĄ z ekranu ustawień, choć znikają z formularzy:
 * operator musi widzieć, że wartości w danych mają skąd wziąć etykietę.
 */
export interface DefinitionRow {
  id: string;
  label: string;
  typeLabel: string;
  required: boolean;
  surfaces: string;
  inUse: boolean;
  archived: boolean;
  first: boolean;
  last: boolean;
  moveUpAction: Parameters<typeof RowActionButton>[0]["action"];
  moveDownAction: Parameters<typeof RowActionButton>[0]["action"];
  archiveAction: Parameters<typeof RowActionButton>[0]["action"];
}

export function DefinitionsTable({ rows, manage }: { rows: DefinitionRow[]; manage: boolean }) {
  const t = useTranslations("customFields");

  const headClass =
    "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

  return (
    <div className="border-border bg-card overflow-x-auto rounded-lg border">
      {/* Szerokość minimalna PROGIEM ZE SKALI, nie wartością arbitralną —
          wzorzec listy zamówień (U5). Kontrakt spójności ekranów pilnuje,
          żeby nowe tabele nie dokładały własnych pikseli. */}
      <Table className="min-w-3xl border-collapse">
        <TableHeader>
          <TableRow className="hover:border-b-border">
            <TableHead className={headClass}>{t("table.name")}</TableHead>
            <TableHead className={headClass}>{t("table.type")}</TableHead>
            <TableHead className={headClass}>{t("table.visibility")}</TableHead>
            <TableHead className={headClass}>{t("table.state")}</TableHead>
            <TableHead className="h-auto px-3.5 py-3">
              <span className="sr-only">{t("table.actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id} data-definition-row data-definition-id={row.id}>
              <TableCell data-cell="name" className="h-[52px] px-3.5 py-2.5">
                {manage ? (
                  <Link
                    className="text-foreground rounded-sm font-medium no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                    href={`/organizacja/pola-wlasne/${row.id}`}
                  >
                    {row.label}
                  </Link>
                ) : (
                  <span className="font-medium">{row.label}</span>
                )}
                {row.required ? (
                  <span className="text-muted-foreground ml-2 text-xs">{t("table.required")}</span>
                ) : null}
              </TableCell>
              <TableCell data-cell="type" className="h-[52px] px-3.5 py-2.5">
                {row.typeLabel}
              </TableCell>
              <TableCell data-cell="surfaces" className="h-[52px] px-3.5 py-2.5">
                {row.surfaces}
              </TableCell>
              <TableCell data-cell="state" className="h-[52px] px-3.5 py-2.5">
                <StatusBadge tone={row.archived ? "neutral" : "positive"}>
                  {row.archived ? t("table.archived") : t("table.active")}
                </StatusBadge>
                {row.inUse ? (
                  <span className="text-muted-foreground ml-2 text-xs">{t("table.inUse")}</span>
                ) : null}
              </TableCell>
              <TableCell data-cell="actions" className="h-[52px] px-3.5 py-2.5 text-right">
                {manage ? (
                  <span className="inline-flex items-start gap-2">
                    {row.archived ? null : (
                      <>
                        <RowActionButton
                          action={row.moveUpAction}
                          label={t("table.moveUp")}
                          disabled={row.first}
                        />
                        <RowActionButton
                          action={row.moveDownAction}
                          label={t("table.moveDown")}
                          disabled={row.last}
                        />
                      </>
                    )}
                    <RowActionButton
                      action={row.archiveAction}
                      label={row.archived ? t("table.restore") : t("table.archive")}
                    />
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
