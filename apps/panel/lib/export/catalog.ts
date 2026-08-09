/**
 * Eksport katalogu do CSV (C2, ADR-111) — FORMAT WYMIANY pod re-import (C3).
 *
 * Kształt PŁASKI (long): jeden wiersz = produkt × próg cenowy. Produkt bez
 * progów daje jeden wiersz z pustymi kolumnami `tier_*`; produkt z N progami
 * daje N wierszy z powtórzonymi polami produktu. Re-import grupuje po
 * `product_id` (pola produktu z pierwszego wiersza grupy, progi z wierszy
 * o niepustym `tier_days`). Odrzucone: progi jako kolumny (tier_1_days…) —
 * sztywny sufit liczby progów i puste kolumny w każdym wierszu.
 *
 * `tier_multiplier` to SUROWA wartość `pricing_tiers.multiplier` — cena
 * CAŁKOWITA progu w krotności `base_price_day_grosze` (ADR-018), NIE mnożnik
 * dzienny i NIE wyliczona kwota. Eksportujemy dane, nie pochodne: wyliczanie
 * ceny i dzielenie jej z powrotem przy imporcie wprowadzałoby błąd
 * zaokrągleń. Kropka dziesiętna (format maszynowy, nie prezentacja).
 */
import { customFieldValuesFromColumn } from "@avably/core";

import { buildCsv, type CsvValue } from "./csv";
import {
  exportFilename,
  fetchAllPages,
  ExportLimitError,
  EXPORT_ROW_LIMIT,
  type ExportContext,
  type ExportFile,
} from "./common";
import {
  customFieldCells,
  customFieldHeader,
  loadExportCustomFields,
} from "./custom-fields";

export const CATALOG_CSV_HEADER = [
  "product_id",
  "name",
  "description",
  "base_price_day_grosze",
  "deposit_grosze",
  "auto_increment_multiplier",
  "buffer_before_days",
  "buffer_after_days",
  "active",
  "tier_days",
  "tier_multiplier",
  "tier_label",
  "tier_sort_order",
] as const;

interface CatalogTierRow {
  tier_days: number;
  multiplier: number;
  label: string | null;
  sort_order: number;
}

interface CatalogProductRow {
  custom_fields: unknown;
  id: string;
  name: string;
  description: string | null;
  base_price_day_grosze: number;
  deposit_grosze: number;
  auto_increment_multiplier: number;
  buffer_before_days: number;
  buffer_after_days: number;
  active: boolean;
  pricing_tiers: CatalogTierRow[] | null;
}

export async function exportCatalogCsv(ctx: ExportContext): Promise<ExportFile> {
  // WYŁĄCZNIE definicje ŻYWE: ten plik wraca importem, a kolumna pod
  // definicją zarchiwizowaną byłaby kolumną, której nie wolno edytować
  // (patrz nagłówek lib/export/custom-fields.ts).
  const customFields = await loadExportCustomFields(ctx.supabase, ctx.tenantId, "product", {
    includeArchived: false,
  });

  const products = await fetchAllPages<CatalogProductRow>(async (from, to) => {
    const { data, error } = await ctx.supabase
      .from("products")
      .select(
        "id, name, description, base_price_day_grosze, deposit_grosze, auto_increment_multiplier, buffer_before_days, buffer_after_days, active, custom_fields, pricing_tiers(tier_days, multiplier, label, sort_order)",
      )
      .eq("tenant_id", ctx.tenantId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error(`Eksport katalogu: odczyt nie powiódł się (${error.code}).`);
    return (data ?? []) as unknown as CatalogProductRow[];
  });

  const csvRows: CsvValue[][] = [];
  for (const product of products) {
    const base: CsvValue[] = [
      product.id,
      product.name,
      product.description,
      product.base_price_day_grosze,
      product.deposit_grosze,
      product.auto_increment_multiplier,
      product.buffer_before_days,
      product.buffer_after_days,
      product.active,
    ];
    // Kolumny dynamiczne powtarzają się w KAŻDYM wierszu grupy — kształt
    // płaski (produkt × próg) powiela pola produktu, a pole własne jest
    // polem produktu. Import bierze je z PIERWSZEGO wiersza grupy.
    const cells = customFieldCells(customFields, customFieldValuesFromColumn(product.custom_fields));
    const tiers = [...(product.pricing_tiers ?? [])].sort((a, b) => a.tier_days - b.tier_days);
    if (tiers.length === 0) {
      csvRows.push([...base, null, null, null, null, ...cells]);
    } else {
      for (const tier of tiers) {
        csvRows.push([...base, tier.tier_days, tier.multiplier, tier.label, tier.sort_order, ...cells]);
      }
    }
    // Limit dotyczy WIERSZY CSV (produkt × próg), nie liczby produktów —
    // stronicowanie pilnuje odczytu, ten warunek pilnuje wyniku.
    if (csvRows.length > EXPORT_ROW_LIMIT) throw new ExportLimitError();
  }

  return {
    filename: exportFilename("catalog"),
    csv: buildCsv([...CATALOG_CSV_HEADER, ...customFieldHeader(customFields)], csvRows),
  };
}
