import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenHeader } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

import { OrganizationCard } from "../organization-card";
import { OrganizationEditForm } from "../organization-edit-form";

/**
 * Dane organizacji — podstrona huba `/organizacja` (uwaga właściciela
 * 2026-08-24, ADR-238).
 *
 * RELOKACJA, NIE ZMIANA FUNKCJI: dawniej ta karta stała na szczycie ekranu
 * organizacji. Po przebudowie na hub tożsamość na hubie jest SKRÓTOWA (nazwa +
 * stan), a PEŁNE dane i edycja właściciela mieszkają tutaj. Ścieżka zapisu jest
 * ta sama co w U12/ADR-225: `OrganizationEditForm` woła RPC
 * `app.update_organization` (0093), wąską i bramkowaną właścicielem. Staff
 * dostaje odczytową `OrganizationCard`. Komponenty `organization-*` zostają w
 * katalogu `organizacja/` bez zmian — ta strona tylko je składa.
 *
 * ODCZYT idzie istniejącym wzorcem (klient z sesją członka, RLS jako bramka:
 * `tenants` — `id = app.tenant_id()`; `subscriptions` — `tenant_id =
 * app.tenant_id()`). Zapis idzie RPC, nie szeroką polityką UPDATE.
 */
export default async function OrganizationDataPage() {
  const ctx = await requireMemberPage("/organizacja/dane");

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("id, name, slug, status, locale, created_at, subscriptions(plan_id, status)")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  if (!tenant) notFound();

  const t = await getTranslations("organization");
  const locale = await getLocale();

  const subscriptionRaw = (tenant as { subscriptions?: unknown }).subscriptions;
  const subscription = (Array.isArray(subscriptionRaw) ? subscriptionRaw[0] : subscriptionRaw) as
    | { plan_id: string | null; status: string | null }
    | null
    | undefined;

  const createdAt = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(tenant.created_at));

  const label = (key: "statusValue" | "localeValue", value: string) => {
    const path = `${key}.${value}` as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : value;
  };

  // Wiersze kontekstu konta, których tą ścieżką NIE zmienia się
  // (slug/plan/status/data) — wspólne dla obu wariantów karty.
  const contextRows: { label: string; value: string; numeric?: boolean }[] = [
    { label: t("slug"), value: tenant.slug },
    { label: t("plan"), value: subscription?.plan_id ?? t("statusValue.trialing") },
    { label: t("status"), value: label("statusValue", tenant.status) },
    { label: t("createdAt"), value: createdAt, numeric: true },
  ];

  const card =
    ctx.role === "owner" ? (
      <OrganizationEditForm
        defaults={{ name: tenant.name, locale: tenant.locale }}
        status={tenant.status}
        rows={contextRows}
      />
    ) : (
      <OrganizationCard
        name={tenant.name}
        status={tenant.status}
        rows={[
          { label: t("name"), value: tenant.name },
          ...contextRows,
          { label: t("locale"), value: label("localeValue", tenant.locale) },
        ]}
      />
    );

  return (
    <FormMeasure className="flex flex-col gap-4">
      <ScreenHeader
        back={{ href: "/organizacja", label: t("backToHub") }}
        title={t("hub.dataTitle")}
      />
      {card}
    </FormMeasure>
  );
}
