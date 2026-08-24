"use client";

/**
 * Kreator importu katalogu (C3, ADR-112) — dwie fazy na JEDNYM pliku:
 * wybór pliku → podgląd (podsumowanie/błędy z numerami wierszy) → zapis.
 *
 * Plik żyje w stanie Reacta (nie w niekontrolowanym formularzu): React 19
 * resetuje formularz po akcji, co gubiłoby wybór między fazami. FormData
 * budujemy przy wysyłce, akcja i tak parsuje treść od zera w OBU fazach —
 * podgląd i zapis liczą się z tej samej treści (parser deterministyczny),
 * a podmiana pliku po podglądzie unieważnia przycisk zapisu (previewedFile).
 */
import { useActionState, useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download } from "lucide-react";

import { Button, FileField } from "@avably/ui";

import { Link } from "@/i18n/navigation";
import {
  CATALOG_IMPORT_INITIAL_STATE,
  type CatalogImportActionState,
} from "@/lib/import/action-state";
import type { CatalogImportIssue } from "@/lib/import/catalog-csv";

import { catalogImportAction } from "./actions";

/**
 * Eksportowana WYŁĄCZNIE dla testu renderowalności (round-3, #B) — pozwala
 * dowieść, że `codes.<kod>` daje zdanie, a nie surową ścieżkę klucza, wołając
 * DOKŁADNIE tę samą funkcję co render, bez powielania jej logiki w teście.
 */
export function issueMessage(
  t: ReturnType<typeof useTranslations<"catalogImport">>,
  issue: CatalogImportIssue,
): string {
  return t(`codes.${issue.code}`, {
    column: issue.column ?? "",
    value: issue.value ?? "",
  });
}

export function ImportWizard() {
  const t = useTranslations("catalogImport");
  const locale = useLocale();
  const [state, dispatch] = useActionState<CatalogImportActionState, FormData>(
    catalogImportAction,
    CATALOG_IMPORT_INITIAL_STATE,
  );
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  // Plik, którego dotyczy widoczny podgląd — podmiana pliku po podglądzie
  // wyłącza zapis do czasu nowego podglądu.
  const [previewedFile, setPreviewedFile] = useState<File | null>(null);

  const submit = (step: "preview" | "confirm") => {
    if (!file) return;
    if (step === "preview") setPreviewedFile(file);
    const data = new FormData();
    data.set("file", file);
    data.set("step", step);
    startTransition(() => dispatch(data));
  };

  if (state.phase === "done" && state.result) {
    return (
      <section className="flex flex-col gap-4" aria-live="polite">
        <div className="rounded-md border border-input bg-background p-4">
          <h2 className="text-base font-semibold">{t("done.title")}</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <li>{t("done.created", { count: state.result.created })}</li>
            <li>{t("done.updated", { count: state.result.updated })}</li>
            <li>{t("done.tiers", { count: state.result.tiers })}</li>
            <li>{t("done.categories", { count: state.result.categories })}</li>
          </ul>
        </div>
        <div>
          <Button asChild>
            <Link href="/katalog">{t("backToCatalog")}</Link>
          </Button>
        </div>
      </section>
    );
  }

  const preview =
    state.phase === "preview" && state.preview && previewedFile === file
      ? state.preview
      : undefined;
  const issues =
    state.phase === "preview" && state.issues && previewedFile === file
      ? state.issues
      : undefined;

  return (
    <section className="flex flex-col gap-4">
      {/* SZABLON CSV DO POBRANIA (uwaga właściciela #7). Pusty plik z kolumnami
          zgodnymi z importem — pobranie to zwykły GET z Content-Disposition,
          więc wystarczy odnośnik z atrybutem `download` (locale w ścieżce, bo
          route handler żyje pod segmentem [locale]). */}
      <div className="border-border bg-card flex flex-col gap-2 rounded-md border p-4">
        <Button asChild variant="secondary" size="sm" className="self-start">
          <a href={`/${locale}/katalog/import/szablon`} download>
            <Download className="size-4" aria-hidden />
            {t("templateButton")}
          </a>
        </Button>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("templateHint")}</p>
      </div>

      <FileField
        id="catalog-import-file"
        name="file"
        accept=".csv,text/csv"
        locale={locale}
        prompt={t("filePrompt")}
        hint={t("fileHint")}
        removeLabel={t("fileRemove")}
        disabled={pending}
        error={state.formError}
        onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
      />

      {issues && issues.length > 0 ? (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/5 p-4"
          role="alert"
        >
          <h2 className="text-sm font-semibold">{t("issuesTitle")}</h2>
          <ul className="mt-2 flex max-h-64 flex-col gap-1 overflow-y-auto text-sm">
            {issues.map((issue, index) => (
              <li key={`${issue.row ?? "file"}-${issue.code}-${index}`}>
                {issue.row !== undefined ? t("issueRow", { row: issue.row }) : t("issueFile")}:{" "}
                {issueMessage(t, issue)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview ? (
        <div className="rounded-md border border-input bg-background p-4" aria-live="polite">
          <h2 className="text-sm font-semibold">{t("summaryTitle")}</h2>
          <ul className="mt-2 flex flex-col gap-1 text-sm text-muted-foreground">
            <li>{t("summaryRows", { count: preview.rowCount })}</li>
            <li>{t("summaryCreated", { count: preview.created })}</li>
            <li>{t("summaryUpdated", { count: preview.updated })}</li>
            <li>{t("summaryTiers", { count: preview.tiers })}</li>
            <li>{t("summaryCategories", { count: preview.categories })}</li>
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">{t("summaryNote")}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={!file || pending}
          onClick={() => submit("preview")}
        >
          {t("previewButton")}
        </Button>
        <Button type="button" disabled={!preview || pending} onClick={() => submit("confirm")}>
          {t("confirmButton")}
        </Button>
      </div>
    </section>
  );
}
