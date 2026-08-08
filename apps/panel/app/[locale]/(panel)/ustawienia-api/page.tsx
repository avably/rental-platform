/**
 * Ekran kluczy publicznego API (M1, ADR-108) — wzorzec ustawienia-domen.
 *
 * Lista dla KAŻDEGO członka (prefiksy i etykiety nie są sekretem — surowego
 * klucza w bazie nie ma), mutacje wyłącznie owner — spójnie z RLS 0053,
 * które jest tu bramką (UI wyłącznie odzwierciedla rolę, jak w płatnościach).
 *
 * Daty formatowane na serwerze (locale operatora), surowy klucz nigdy nie
 * przechodzi przez ten plik — istnieje tylko w odpowiedzi akcji generującej.
 */
import { tenantSubdomainHost } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenBackLink } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { ApiKeysPanel, type ApiKeyRow } from "./api-keys-panel";

export default async function ApiSettingsPage() {
  const ctx = await requireMemberPage("/ustawienia-api");
  const t = await getTranslations("apiSettings");
  const locale = await getLocale();

  const { data: rows } = await ctx.supabase
    .from("api_keys")
    .select("id, name, key_prefix, created_at, revoked_at, last_used_at")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false });

  const formatDate = (value: string | null): string | null =>
    value
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "Europe/Warsaw",
        }).format(new Date(value))
      : null;

  const apiKeys: ApiKeyRow[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    keyPrefix: row.key_prefix as string,
    createdAt: formatDate(row.created_at as string) ?? "—",
    revokedAt: formatDate((row.revoked_at as string | null) ?? null),
    lastUsedAt: formatDate((row.last_used_at as string | null) ?? null),
  }));

  // Baza adresowa API = host subdomeny sklepu (informacyjnie; API działa na
  // każdym hoście storefrontu tego najemcy).
  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("slug")
    .eq("id", ctx.tenantId)
    .maybeSingle();
  const apiBaseUrl = tenant?.slug
    ? `https://${tenantSubdomainHost(tenant.slug as string)}/api/v1/`
    : null;

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={`← ${t("backLink")}`} />
      <ApiKeysPanel apiKeys={apiKeys} isOwner={ctx.role === "owner"} apiBaseUrl={apiBaseUrl} />
    </FormMeasure>
  );
}
