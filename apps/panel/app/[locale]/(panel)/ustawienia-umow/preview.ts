/**
 * Podgląd umowy na danych przykładowych (U10, ADR-151).
 *
 * ══ CO TO JEST, A CZEGO NIE JEST ══
 *
 * To jest ŚCIEŻKA GENEROWANIA UMOWY z odciętą trwałością. Ten sam builder
 * propsów (`buildContractPdfProps`), ten sam renderer (`renderContractPdf`,
 * a więc ten sam szablon `packages/pdf/src/contract-template.tsx`) — różnica
 * jest wyłącznie w wejściu (zamówienie przykładowe zamiast wiersza z bazy)
 * i w wyjściu (bajty do przeglądarki zamiast pliku w koszu i wiersza
 * w rejestrze). Gdyby podgląd miał własny szablon, byłby wart mniej niż nic:
 * pokazywałby dokument, którego system nie wygeneruje.
 *
 * ══ PODGLĄD NIE ZOSTAWIA ŚLADU ══
 *
 * Świadomie NIE woła `generateContract` z `zamowienia/[id]/contract-service`:
 * tamta ścieżka wgrywa plik do koszyka `rental-contracts` i wstawia wiersz do
 * `contract_documents`. Podgląd nie tworzy dokumentu, nie zużywa numeracji
 * i nie ma po nim czego sprzątać. Jedyne operacje na bazie to DWA ODCZYTY
 * niżej — pilnuje tego test `contract-preview.test.ts`.
 *
 * ══ ZAWĘŻENIE PO NAJEMCY JEST W ZAPYTANIU ══
 *
 * RLS jest bramką, ale nie jedyną warstwą: oba odczyty filtrują po
 * `tenant_id`/`id` JAWNIE i kończą się `maybeSingle()`. Zdjęcie filtra zapala
 * sondę izolacji z imienia — bez filtra klient service-role widzi wiersze
 * dwóch najemców, a `maybeSingle()` oddaje wtedy błąd zamiast cudzych danych.
 */
import type { Locale } from "@avably/core";
import { renderContractPdf, type ContractPdfProps } from "@avably/pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildContractPdfProps } from "@/app/[locale]/(panel)/zamowienia/[id]/contract-document";
import {
  CONTRACT_DOCUMENT_SETTINGS_KEY,
  contractDocumentSettingsFromRows,
} from "@/lib/contract-settings";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { contractPreviewOrderRow } from "./preview-sample";

/**
 * Renderer wstrzykiwany, wzorem `contractServiceDeps` — z DOMYŚLNĄ wartością
 * wskazującą prawdziwy renderer pakietu PDF. Test trzyma tożsamość tej
 * referencji (`toBe(renderContractPdf)`): podmiana na lokalną kopię szablonu
 * przestaje być zmianą, której nikt nie zauważy.
 */
export interface ContractPreviewDeps {
  render(props: ContractPdfProps): Promise<Uint8Array>;
}

export function contractPreviewDeps(): ContractPreviewDeps {
  return { render: renderContractPdf };
}

export interface ContractPreviewInput {
  tenantId: string;
  /** Dzień „dzisiaj" w zapisie `YYYY-MM-DD` — podaje wołający, nie ten moduł. */
  today: string;
}

/** Nazwa pliku podglądu — mówi wprost, czym jest, także po pobraniu na dysk. */
export const CONTRACT_PREVIEW_FILENAME: Record<Locale, string> = {
  pl: "podglad-umowy-przyklad.pdf",
  en: "contract-preview-sample.pdf",
};

interface TenantRow {
  name: string;
  locale: Locale;
}

/**
 * Propsy umowy przykładowej: prawdziwe dane firmy i warunki najemcy,
 * przykładowe zamówienie.
 *
 * Rzuca `ContractSettingsError`, gdy najemca nie ma jeszcze poprawnych
 * ustawień umów — ekran pokazuje wtedy prośbę o ich uzupełnienie zamiast
 * dokumentu z dziurami.
 */
export async function loadContractPreviewProps(
  supabase: SupabaseClient,
  input: ContractPreviewInput,
): Promise<ContractPdfProps> {
  const [settingsResult, tenantResult, currency] = await Promise.all([
    supabase
      .from("tenant_settings")
      .select("key,value")
      .eq("tenant_id", input.tenantId)
      .eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY)
      .maybeSingle(),
    supabase.from("tenants").select("name,locale").eq("id", input.tenantId).maybeSingle(),
    getTenantCurrency(supabase, input.tenantId),
  ]);

  // Błąd odczytu NIE jest równoznaczny z brakiem konfiguracji i nie wolno go
  // uciszyć: `maybeSingle()` oddaje błąd także wtedy, gdy zapytanie objęło
  // więcej niż jednego najemcę — czyli dokładnie w chwili, w której zawężenie
  // przestało działać. Cichy `catch` zamieniłby wyciek w pusty ekran.
  if (settingsResult.error) {
    throw new Error(`Nie udało się odczytać ustawień umów: ${settingsResult.error.message}`);
  }
  if (tenantResult.error) {
    throw new Error(`Nie udało się odczytać danych organizacji: ${tenantResult.error.message}`);
  }

  const settingsRow = settingsResult.data as { key: string; value: unknown } | null;
  const settings = contractDocumentSettingsFromRows(settingsRow ? [settingsRow] : []);
  const tenant = tenantResult.data as TenantRow | null;
  if (!tenant) throw new Error("Organizacja nie istnieje.");

  return buildContractPdfProps({
    tenant: { name: tenant.name },
    tenantLocale: tenant.locale,
    currency,
    settings,
    order: contractPreviewOrderRow({ locale: tenant.locale, today: input.today, currency }),
    // Pola własne CELOWO puste: wypełnia je konkretne zamówienie (i konkretny
    // klient), więc podgląd nie ma czym ich wypełnić bez zmyślania wartości.
    // Sekcja dodatkowa znika wtedy z dokumentu w całości — tak samo jak
    // u najemcy, który pól własnych nie założył (patrz `hasExtras` w szablonie).
    customFieldDefinitions: [],
  });
}

/** Bajty PDF-a podglądu — ta sama funkcja renderu co przy prawdziwej umowie. */
export async function renderContractPreview(
  deps: ContractPreviewDeps,
  supabase: SupabaseClient,
  input: ContractPreviewInput,
): Promise<{ bytes: Uint8Array; filename: string }> {
  const props = await loadContractPreviewProps(supabase, input);
  return { bytes: await deps.render(props), filename: CONTRACT_PREVIEW_FILENAME[props.locale] };
}
