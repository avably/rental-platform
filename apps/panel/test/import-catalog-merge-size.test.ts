import { describe, expect, it, vi } from "vitest";

import type { ExportContext } from "@/lib/export/common";
import { CATALOG_CSV_HEADER } from "@/lib/export/catalog";
import { CSV_BOM } from "@/lib/export/csv";
import { runCatalogImport } from "@/lib/import/import-catalog";

/**
 * Bramka rozmiaru 8 kB po SCALENIU (znaleziska #8/#11).
 *
 * Podgląd liczy rozmiar mapy pól własnych tylko z PLIKU (mode:"create"), a baza
 * egzekwuje na mapie PO SCALENIU z wartościami zapisanymi (zarchiwizowane /
 * spoza kolumn pliku). Dla wiersza AKTUALIZUJĄCEGO podgląd bywa zielony, a
 * `import_catalog` pada 23514 i cofa całą partię. Dowodzimy, że taki błąd wraca
 * jako ZDANIE DLA OPERATORA (issue), a nie surowy rzut 500.
 */

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Plik z jednym NOWYM produktem (pusty product_id) — plan nie tyka bazy. */
function csvNewProduct(): string {
  const fields: Record<string, string> = {
    name: "Agregat",
    base_price_day_grosze: "10000",
    deposit_grosze: "5000",
    auto_increment_multiplier: "1.0",
    buffer_before_days: "1",
    buffer_after_days: "1",
    active: "true",
  };
  const header = CATALOG_CSV_HEADER.join(";");
  const dataRow = CATALOG_CSV_HEADER.map((name) => fields[name] ?? "").join(";");
  return `${CSV_BOM}${[header, dataRow].join("\r\n")}\r\n`;
}

function ctxWithRpcError(error: { code?: string; message?: string }): ExportContext {
  return {
    tenantId: TENANT,
    supabase: {
      schema: () => ({ rpc: vi.fn(async () => ({ data: null, error })) }),
    },
  } as unknown as ExportContext;
}

describe("runCatalogImport — rozmiar po scaleniu", () => {
  it("23514 z import_catalog wraca jako issue (badCustomField), nie rzut (#8)", async () => {
    const ctx = ctxWithRpcError({ code: "23514", message: "value too long for type jsonb" });

    const outcome = await runCatalogImport(ctx, csvNewProduct());

    expect(outcome.result).toBeUndefined();
    expect(outcome.issues.some((issue) => issue.code === "badCustomField")).toBe(true);
  });

  it("23514 NIE niesie `row` — problem jest PLIKOWY, nie wiersza nagłówka (round-3, #B)", async () => {
    // Rewert do `row: 1` renderowałby w wizardzie "Wiersz 1: …" — a wiersz 1 to
    // NAGŁÓWEK (catalog-csv.ts:85), w którym tego błędu nie ma: 23514 pochodzi
    // ze SCALENIA po stronie bazy, gdzie numer wiersza jest nieosiągalny
    // (partia jest jedną transakcją). Brak `row` → wizard pokazuje "Cały plik".
    const ctx = ctxWithRpcError({ code: "23514", message: "value too long for type jsonb" });

    const outcome = await runCatalogImport(ctx, csvNewProduct());

    const issue = outcome.issues.find((candidate) => candidate.code === "badCustomField");
    expect(issue?.row, "row:1 sugerowałby błąd w nagłówku, którego nie ma").toBeUndefined();
  });

  it("inny błąd zapisu nadal rzuca (bez maskowania nieznanych awarii)", async () => {
    const ctx = ctxWithRpcError({ code: "40001", message: "serialization failure" });

    await expect(runCatalogImport(ctx, csvNewProduct())).rejects.toThrow(/zapis nie powiódł się/);
  });
});
