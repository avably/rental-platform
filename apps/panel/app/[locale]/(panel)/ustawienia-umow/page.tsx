import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  CONTRACT_DOCUMENT_SETTINGS_KEY,
  contractDocumentSettingsFromRows,
  type ContractDocumentSettings,
} from "@/lib/contract-settings";
import { requireMemberPage } from "@/lib/member-page";

import { ContractSettingsForm } from "./contract-settings-form";

export default async function ContractSettingsPage() {
  const context = await requireMemberPage("/ustawienia-umow");
  const t = await getTranslations("contractSettings");
  const { data } = await context.supabase
    .from("tenant_settings")
    .select("key,value")
    .eq("tenant_id", context.tenantId)
    .eq("key", CONTRACT_DOCUMENT_SETTINGS_KEY);

  let settings: ContractDocumentSettings | null = null;
  try {
    settings = contractDocumentSettingsFromRows(data ?? []);
  } catch {
    // Brak konfiguracji jest prawidłowym stanem początkowym.
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <Link className="text-sm underline" href="/">{t("backLink")} ↩</Link>
      </header>
      <p className="text-sm text-muted-foreground">{t("intro")}</p>
      {context.role === "owner" ? (
        <ContractSettingsForm defaults={settings} />
      ) : (
        <section className="space-y-3 rounded border p-4 text-sm">
          <p className="text-muted-foreground">{t("readOnly")}</p>
          {settings ? (
            <>
              <p><strong>{t("address")}:</strong> {settings.address}</p>
              <p><strong>{t("nip")}:</strong> {settings.nip ?? "—"}</p>
              <p><strong>{t("email")}:</strong> {settings.email}</p>
              <p><strong>{t("termsVersion")}:</strong> {settings.terms_version}</p>
              <p className="whitespace-pre-wrap"><strong>{t("termsBody")}:</strong> {settings.terms_body}</p>
            </>
          ) : <p>{t("missing")}</p>}
        </section>
      )}
    </div>
  );
}
