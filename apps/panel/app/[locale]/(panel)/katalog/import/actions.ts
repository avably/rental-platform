"use server";

/**
 * Akcja ekranu importu katalogu (C3, ADR-112) — dwufazowo: preview → confirm.
 *
 * KOLEJNOŚĆ BRAMEK JEST KONTRAKTEM (sonda §3 briefu): najpierw sesja
 * (`requireMember` PRZED dotknięciem formularza — anon dostaje odmowę,
 * zanim jakikolwiek bajt pliku zostanie przeczytany), potem typ i rozmiar
 * pliku, dopiero potem treść. Odwrotnie niż w invoice-actions (tam walidacja
 * pól szła przed guardem) — import czyta CAŁY plik do pamięci, więc
 * odmowa musi być tańsza niż praca.
 *
 * SERVER ACTION, nie route handler (w kontrze do eksportu ADR-111): import
 * ma skutki uboczne, a akcje Next dostają ochronę origin od frameworka;
 * argument eksportu „handler, bo strumień text/csv" tu nie obowiązuje —
 * odpowiedzią jest stan formularza, nie plik.
 *
 * Tenant NIE występuje w żadnym parametrze — wyłącznie z sesji (claim JWT
 * w requireMember; RLS i app.import_catalog egzekwują go w bazie).
 */
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";

import { AuthError } from "@/lib/auth";
import type { CatalogImportActionState } from "@/lib/import/action-state";
import { ImportLimitError, IMPORT_ROW_LIMIT } from "@/lib/import/catalog-csv";
import { checkCatalogCsvFile, IMPORT_MAX_MB } from "@/lib/import/file-check";
import { planCatalogImport, runCatalogImport } from "@/lib/import/import-catalog";
import { requireMember } from "@/lib/supabase-server";

export async function catalogImportAction(
  _previous: CatalogImportActionState,
  formData: FormData,
): Promise<CatalogImportActionState> {
  // 1. Sesja — PRZED formularzem i plikiem.
  let ctx;
  try {
    ctx = await requireMember();
  } catch (err) {
    if (err instanceof AuthError) return { phase: "idle", formError: err.message };
    throw err;
  }

  const t = await getTranslations("catalogImport");

  // 2. Typ i rozmiar — przed bajtami.
  const file = formData.get("file");
  const problem = checkCatalogCsvFile(file instanceof File ? file : null);
  if (problem) {
    return { phase: "idle", formError: t(`errors.${problem}`, { mb: IMPORT_MAX_MB }) };
  }

  const step = formData.get("step") === "confirm" ? "confirm" : "preview";
  const text = await (file as File).text();
  const importCtx = { supabase: ctx.supabase, tenantId: ctx.tenantId!, role: ctx.role };

  try {
    if (step === "preview") {
      const plan = await planCatalogImport(importCtx, text);
      if (plan.rowCount === 0) return { phase: "idle", formError: t("errors.empty") };
      if (plan.issues.length > 0) return { phase: "preview", issues: plan.issues };
      return {
        phase: "preview",
        preview: {
          created: plan.created,
          updated: plan.updated,
          tiers: plan.tiers,
          categories: plan.categories,
          rowCount: plan.rowCount,
          fileName: (file as File).name,
        },
      };
    }

    const outcome = await runCatalogImport(importCtx, text);
    if (outcome.issues.length > 0) return { phase: "preview", issues: outcome.issues };
    if (!outcome.result) return { phase: "idle", formError: t("errors.empty") };
    revalidatePath("/", "layout");
    return { phase: "done", result: outcome.result };
  } catch (err) {
    if (err instanceof ImportLimitError) {
      return { phase: "idle", formError: t("errors.limit", { limit: IMPORT_ROW_LIMIT }) };
    }
    // Szczegóły odmowy bazy nie są komunikatem dla operatora — katalog
    // pozostał bez zmian (atomowość 0055), mówimy dokładnie to.
    return { phase: "idle", formError: t("errors.server") };
  }
}
