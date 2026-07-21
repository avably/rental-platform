"use client";

/**
 * Edytor progów cenowych z PODGLĄDEM WYCENY NA ŻYWO.
 *
 * Decyzja produktowa (ADR-022): platforma nie narzuca modelu rozliczania —
 * kształt progów jest wyborem najemcy (gęste progi = rozliczanie dzienne,
 * rzadkie = pakiety). Rolą edytora jest POKAZAĆ skutki tego kształtu, zanim
 * zobaczy je klient: tabela podglądu liczy cenę każdej długości najmu.
 *
 * Cała arytmetyka podglądu żyje w ./preview.ts i woła calculatePrice
 * z @avably/core — ten komponent wyłącznie formatuje wyniki (formatMoney).
 *
 * Semantyka mnożnika (ADR-018): CENA CAŁKOWITA progu w krotności ceny
 * dziennej, NIE mnożnik dzienny — kolumna „cena progu” pokazuje wynikową
 * kwotę przy każdym wierszu, bo błędna interpretacja daje ceny ~7× wyższe
 * i przechodzi wszystkie CHECK-i.
 */
import { formatMoney, type CurrencyCode } from "@avably/core";
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
import { useLocale, useTranslations } from "next-intl";
import { useActionState, useId, useRef, useState } from "react";

import type { FormState } from "@/lib/form-state";

import {
  buildPreviewRows,
  rowsToEngineTiers,
  tierPriceGrosze,
  type TierRowValues,
  type TiersPricingParams,
} from "./preview";

const initialState: FormState = {};

interface EditorRow extends TierRowValues {
  key: number;
}

export function TiersEditor({
  action,
  initialRows,
  pricing,
  currency,
}: {
  action: (prevState: FormState, formData: FormData) => Promise<FormState>;
  initialRows: TierRowValues[];
  pricing: TiersPricingParams;
  currency: CurrencyCode;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const t = useTranslations("catalog.tiers");
  const locale = useLocale();
  const idPrefix = useId();

  const [rows, setRows] = useState<EditorRow[]>(() =>
    initialRows.map((row, index) => ({ ...row, key: index })),
  );
  // Licznik kluczy w ref, nie w stanie: dwa addRow w jednym batchu Reacta
  // odczytałyby ten sam stan i dałyby DWA wiersze o wspólnym kluczu — edycja
  // jednego pisałaby do obu. Ref inkrementuje się synchronicznie.
  const nextKeyRef = useRef(initialRows.length);

  const updateRow = (key: number, field: keyof TierRowValues, value: string) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  };

  const addRow = () => {
    const key = nextKeyRef.current;
    nextKeyRef.current += 1;
    setRows((current) => [
      ...current,
      { key, tierDays: "", multiplier: "", label: "", sortOrder: String(current.length) },
    ]);
  };

  const removeRow = (key: number) => {
    setRows((current) => current.filter((row) => row.key !== key));
  };

  const engineTiers = rowsToEngineTiers(rows);
  const invalidRowCount = rows.length - engineTiers.length;
  const previewRows = buildPreviewRows(engineTiers, pricing);

  const tierPriceLabel = (row: EditorRow): string => {
    const grosze = tierPriceGrosze(row, pricing);
    return grosze === null ? "—" : formatMoney(grosze, currency, locale);
  };

  const serializedRows = JSON.stringify(
    rows.map(({ tierDays, multiplier, label, sortOrder }) => ({
      tierDays,
      multiplier,
      label,
      sortOrder,
    })),
  );

  return (
    <div className="flex flex-col gap-8">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="tiers" value={serializedRows} />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("colDays")}</TableHead>
              <TableHead>{t("colMultiplier")}</TableHead>
              <TableHead>{t("colTierPrice")}</TableHead>
              <TableHead>{t("colLabel")}</TableHead>
              <TableHead>{t("colSortOrder")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("colRowActions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-gray-600">
                  {t("emptyEditor")}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell>
                    <Input
                      aria-label={t("colDays")}
                      inputMode="numeric"
                      className="w-24"
                      value={row.tierDays}
                      onChange={(event) => updateRow(row.key, "tierDays", event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={t("colMultiplier")}
                      inputMode="decimal"
                      className="w-24"
                      aria-describedby={`${idPrefix}-multiplier-hint`}
                      value={row.multiplier}
                      onChange={(event) => updateRow(row.key, "multiplier", event.target.value)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    {tierPriceLabel(row)}
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={t("colLabel")}
                      className="min-w-40"
                      maxLength={200}
                      value={row.label}
                      onChange={(event) => updateRow(row.key, "label", event.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label={t("colSortOrder")}
                      inputMode="numeric"
                      className="w-20"
                      value={row.sortOrder}
                      onChange={(event) => updateRow(row.key, "sortOrder", event.target.value)}
                    />
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

        <p id={`${idPrefix}-multiplier-hint`} className="text-xs text-gray-500">
          {t("multiplierHint")}
        </p>

        {state.formError ? (
          <p role="alert" className="text-sm text-red-600">
            {state.formError}
          </p>
        ) : null}
        {state.fieldErrors
          ? Object.entries(state.fieldErrors).map(([field, message]) => (
              <p key={field} role="alert" className="text-sm text-red-600">
                {message}
              </p>
            ))
          : null}
        {state.success ? (
          <p role="status" className="text-sm text-green-700">
            {t("saved")}
          </p>
        ) : null}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={addRow}>
            {t("addRow")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold">{t("previewTitle")}</h2>
        <p className="text-sm text-gray-600">{t("previewIntro")}</p>
        {invalidRowCount > 0 ? (
          <p role="status" className="text-sm text-amber-700">
            {t("previewSkippedRows", { count: invalidRowCount })}
          </p>
        ) : null}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("previewColDays")}</TableHead>
              <TableHead>{t("previewColRental")}</TableHead>
              <TableHead>{t("previewColPerDay")}</TableHead>
              <TableHead>{t("previewColAppliedTier")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {previewRows.map(({ days, rentalGrosze, appliedTierDays }) => (
              <TableRow key={days}>
                <TableCell>{days}</TableCell>
                <TableCell className="font-medium">
                  {formatMoney(rentalGrosze, currency, locale)}
                </TableCell>
                <TableCell>
                  {formatMoney(Math.round(rentalGrosze / days), currency, locale)}
                </TableCell>
                <TableCell>
                  {appliedTierDays === null
                    ? t("previewBasePrice")
                    : t("previewAppliedTier", { days: appliedTierDays })}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}
