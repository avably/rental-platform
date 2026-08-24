import { getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import {
  CONTRACT_DOCUMENT_SETTINGS_KEY,
  contractDocumentSettingsFromRows,
  type ContractDocumentSettings,
} from "@/lib/contract-settings";
import { requireMemberPage } from "@/lib/member-page";

import { CompanyIdentityCard, type CompanyIdentity } from "./company-identity-card";
import { ContractPreviewCard } from "./contract-preview-card";
import { ContractReadOnly } from "./contract-read-only";
import { ContractSettingsForm } from "./contract-settings-form";

export default async function ContractSettingsPage() {
  const context = await requireMemberPage("/ustawienia-umow");
  const t = await getTranslations("contractSettings");

  // Dwa niezależne źródła: warunki umowy (tenant_settings.contract_document)
  // oraz tożsamość firmy z rejestru (public.tenants — legal_name/nip/regon,
  // ADR-234). Adres firmy do umowy zostaje w contract_document; NIP z rejestru
  // służy przyciskowi „Pobierz z GUS" jako domyślne źródło zapytania.
  const [settingsResult, tenantResult] = await Promise.all([
    context.supabase
      .from("tenant_settings")
      .select("key,value")
      .eq("tenant_id", context.tenantId)
      .eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY),
    context.supabase
      .from("tenants")
      .select("name,legal_name,nip,regon")
      .eq("id", context.tenantId)
      .maybeSingle(),
  ]);

  let settings: ContractDocumentSettings | null = null;
  try {
    settings = contractDocumentSettingsFromRows(settingsResult.data ?? []);
  } catch {
    // Brak konfiguracji jest prawidłowym stanem początkowym.
  }

  const tenantRow = tenantResult.data as {
    name: string;
    legal_name: string | null;
    nip: string | null;
    regon: string | null;
  } | null;
  const identity: CompanyIdentity = {
    name: tenantRow?.name ?? "",
    legalName: tenantRow?.legal_name ?? null,
    nip: tenantRow?.nip ?? null,
    regon: tenantRow?.regon ?? null,
  };

  // Standard P7 (ADR-060): jedyny H1 niesie belka (trasa jest pozycją
  // nawigacji, więc tytuł rozwiązuje się sam), a szerokość kontenera należy do
  // layoutu. P8: krótsza miara formularza przestaje być wyjątkiem tego ekranu
  // i idzie wspólnym mechanizmem `--form-line-measure`.
  //
  // Widok członka zespołu to LISTA ODCZYTOWA, nie wyłączony formularz: te same
  // dane, jawnie bez akcji — atrapa „Zapisz", która oddaje odmowę z RLS, jest
  // gorsza od jej braku (mockup `data-contract-mode="member-read-only"`).
  // Podgląd umowy (U10, ADR-151) dostają OBIE role: pokazuje dokładnie te dane,
  // które ekran i tak już wyświetla, więc nie udostępnia członkowi zespołu
  // niczego nowego — a to on najczęściej tłumaczy klientowi, co jest w umowie.
  return (
    <FormMeasure className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <CompanyIdentityCard identity={identity} />
      {context.role === "owner" ? (
        <ContractSettingsForm defaults={settings} companyNip={identity.nip} />
      ) : (
        <ContractReadOnly settings={settings} />
      )}
      <ContractPreviewCard available={settings !== null} />
    </FormMeasure>
  );
}
