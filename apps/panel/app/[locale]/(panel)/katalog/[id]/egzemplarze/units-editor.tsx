"use client";

/**
 * EDYTOR EGZEMPLARZY — JEDEN ZAPIS ZAMIAST N FORMULARZY (U8b, ADR-146).
 *
 * Przed U8b każdy egzemplarz był osobnym `<form>` z własnym „Zapisz", własnym
 * „Usuń" i POWTÓRZONYM tym samym zdaniem pomocy: przy dwunastu sztukach ekran
 * niósł dwanaście identycznych akapitów i zmuszał do dwunastu zapisów, żeby
 * poprawić numery po dostawie. Forma jest teraz ta sama, co w edytorze progów
 * cenowych (`../progi/tiers-editor.tsx`): tabela w stanie klienta, jedno
 * ukryte pole z JSON-em, jeden submit. Zdanie pomocy stoi RAZ, nad tabelą.
 *
 * KOLUMNA STANU nie jest ozdobą: bez niej operator nie wie, czego NIE MOŻE
 * usunąć. Egzemplarz wiszący na zamówieniu odrzuci baza (`order_items_unit_fk`
 * bez `ON DELETE`), a usunięcie w ogóle wymaga roli właściciela — lepiej
 * pokazać to przed kliknięciem niż komunikatem po.
 *
 * USUNIĘCIE JEST ODROCZONE DO ZAPISU. „Usuń" zdejmuje wiersz z tabeli
 * i dopisuje jego identyfikator do listy usuwanych; baza dowiaduje się o tym
 * dopiero przy submicie. Dzięki temu jedna operacja („popraw numery, wyrzuć
 * dwa złomy") jest jednym zapisem, a nie trzema — a nieudane usunięcie wraca
 * komunikatem NAD tabelą i wiersz pojawia się z powrotem po odświeżeniu.
 */
import {
  Button,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@avably/ui";
import { useTranslations } from "next-intl";
import { useActionState, useId, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";
import type { ProductUnitRow } from "@/lib/catalog/card-query";
import { DateRangeField } from "@/lib/fields/date-fields";
import type { FormState } from "@/lib/form-state";

const initialState: FormState = {};

interface EditorRow {
  key: number;
  /** `null` = wiersz dołożony w edytorze, jeszcze nie w bazie. */
  id: string | null;
  serialNumber: string;
  unavailableFrom: string;
  unavailableTo: string;
  unavailableReason: string;
  deployment: ProductUnitRow["deployment"];
}

const HEAD_CLASS =
  "h-auto px-3.5 py-3 text-[11px] leading-[14px] font-semibold tracking-[0.06em] text-muted-foreground uppercase";

export function UnitsEditor({
  action,
  initialRows,
  locale,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initialRows: ProductUnitRow[];
  locale: string;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.units");
  const idPrefix = useId();

  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialRows.map((row, index) => ({ ...row, key: index })),
  );
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  // Licznik kluczy w ref, nie w stanie: dwa `addRow` w jednym batchu Reacta
  // odczytałyby ten sam stan i dały DWA wiersze o wspólnym kluczu — edycja
  // jednego pisałaby do obu (lekcja z edytora progów).
  const nextKeyRef = useRef(initialRows.length);

  const updateRow = (key: number, field: "serialNumber" | "unavailableReason", value: string) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  };

  const updateWindow = (key: number, next: { from: string; to: string }) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, unavailableFrom: next.from, unavailableTo: next.to } : row,
      ),
    );
  };

  const addRow = () => {
    const key = nextKeyRef.current;
    nextKeyRef.current += 1;
    setRows((current) => [
      ...current,
      {
        key,
        id: null,
        serialNumber: "",
        unavailableFrom: "",
        unavailableTo: "",
        unavailableReason: "",
        deployment: null,
      },
    ]);
  };

  const removeRow = (key: number) => {
    setRows((current) => {
      const row = current.find((candidate) => candidate.key === key);
      // Wiersz JESZCZE nieistniejący w bazie znika bez śladu — nie ma czego
      // usuwać, więc nie zgłaszamy go akcji.
      if (row?.id) setRemovedIds((ids) => (ids.includes(row.id!) ? ids : [...ids, row.id!]));
      return current.filter((candidate) => candidate.key !== key);
    });
  };

  const serializedRows = JSON.stringify(
    rows.map(({ id, serialNumber, unavailableFrom, unavailableTo, unavailableReason }) => ({
      id,
      serialNumber,
      unavailableFrom,
      unavailableTo,
      unavailableReason,
    })),
  );

  // Data zwrotu to kolumna `date` (bez strefy) — formatujemy ją w UTC, tak
  // jak termin na karcie klienta, żeby północ w Europe/Warsaw nie cofnęła dnia.
  const formatDay = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${iso}T00:00:00Z`));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="units" value={serializedRows} />
      <input type="hidden" name="removedUnitIds" value={JSON.stringify(removedIds)} />

      <p id={`${idPrefix}-window-hint`} className="text-muted-foreground text-[13px] leading-[18px]">
        {t("windowHint")}
      </p>

      <div className="border-border bg-card overflow-x-auto rounded-lg border">
        <Table className="min-w-3xl border-collapse">
          <TableHeader>
            <TableRow className="hover:border-b-border">
              <TableHead className={HEAD_CLASS}>{t("colSerial")}</TableHead>
              <TableHead className={HEAD_CLASS}>{t("colWindow")}</TableHead>
              <TableHead className={HEAD_CLASS}>{t("colReason")}</TableHead>
              <TableHead className={HEAD_CLASS}>{t("colState")}</TableHead>
              <TableHead className="h-auto px-3.5 py-3">
                <span className="sr-only">{t("colRowActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t("emptyEditor")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} data-unit-row data-unit-id={row.id ?? undefined}>
                  <TableCell>
                    <Input
                      aria-label={t("colSerial")}
                      className="min-w-40"
                      maxLength={100}
                      value={row.serialNumber}
                      onChange={(event) => updateRow(row.key, "serialNumber", event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    {/* Nazwy pól ukrytych są UNIKALNE per wiersz i akcja ich
                        NIE czyta — kontraktem wysyłki jest JSON w polu `units`.
                        `DateRangeField` jest jedynym dozwolonym wejściem daty
                        w panelu (zakaz natywnego `input type="date"`), a jego
                        API wymaga nazw, więc nadajemy im własną przestrzeń
                        zamiast N razy powtarzać `unavailableFrom`. */}
                    <DateRangeField
                      id={`${idPrefix}-window-${row.key}`}
                      fromName={`unitWindowFrom-${row.key}`}
                      toName={`unitWindowTo-${row.key}`}
                      from={row.unavailableFrom}
                      to={row.unavailableTo}
                      onChange={(next) => updateWindow(row.key, next)}
                      describedBy={`${idPrefix}-window-hint`}
                      className="min-w-52"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={t("colReason")}
                      className="min-w-40"
                      maxLength={500}
                      value={row.unavailableReason}
                      onChange={(event) =>
                        updateRow(row.key, "unavailableReason", event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell data-unit-state={row.deployment ? "deployed" : "shelf"}>
                    {row.deployment ? (
                      <span className="flex flex-col">
                        <Link
                          href={`/zamowienia/${row.deployment.orderId}`}
                          aria-label={t("openOrder", { number: row.deployment.orderNumber })}
                          className="text-foreground w-fit rounded-sm font-medium tabular-nums no-underline outline-none hover:underline hover:underline-offset-[3px] focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
                        >
                          {row.deployment.orderNumber}
                        </Link>
                        <span className="text-muted-foreground text-[13px] leading-[18px] tabular-nums">
                          {t("stateReturns", { date: formatDay(row.deployment.endDate) })}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-sm">{t("stateOnShelf")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button type="button" variant="ghost" onClick={() => removeRow(row.key)}>
                      {t("removeRow")}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {removedIds.length > 0 ? (
        <p role="status" className="text-status-attention-fg text-sm">
          {t("removalPending", { count: removedIds.length })}
        </p>
      ) : null}

      {state.formError ? (
        <p role="alert" className="text-destructive text-sm">
          {state.formError}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="text-status-positive-fg text-sm">
          {t("saved")}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={addRow}>
          {t("addRow")}
        </Button>
        <Button type="submit" loading={pending} disabled={pending}>
          {t("save")}
        </Button>
      </div>
    </form>
  );
}
