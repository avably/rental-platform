import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { OrganizationCard } from "./organization-card";

/**
 * Ekran organizacji (ADR-059) — TYLKO DO ODCZYTU.
 *
 * ADR-056 odnotował odstępstwo: pozycja „Organizacja" w nawigacji celowała w
 * `/organizacja/nowa`, bo ekranu organizacji NIE BYŁO. Ten plik zamyka tamten
 * dług — `nav.ts` wraca na `/organizacja`, a identyfikator pozycji zostaje
 * nietknięty, więc kontrakt struktury z artefaktem jest dalej zielony.
 *
 * ZERO MUTACJI, ZERO ATRAP EDYCJI. Zmiana nazwy czy sluga tenanta pociąga za
 * sobą decyzje, których produkt jeszcze nie podjął (slug siedzi w adresie
 * sklepu i w subdomenie — patrz moduł domen), a przycisk „Zapisz", który
 * niczego nie zapisuje, łamałby tę samą regułę, przez którą dashboard jest
 * uczciwym placeholderem. Ekran mówi wprost, że jest do odczytu.
 *
 * ODCZYT idzie ISTNIEJĄCYM wzorcem: klient z sesją członka i RLS jako bramka
 * (`tenants` — polityka `id = app.tenant_id()`; `subscriptions` — `tenant_id =
 * app.tenant_id()`). Żadnych nowych uprawnień, żadnego service-role.
 */
export default async function OrganizationPage() {
  const ctx = await requireMemberPage("/organizacja");

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("id, name, slug, status, locale, created_at, subscriptions(plan_id, status)")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  // Członek BEZ widocznego tenanta to stan nie do wyświetlenia — guard
  // wpuścił, ale RLS nic nie oddało. 404 zamiast pustego szkieletu z myślnikami.
  if (!tenant) notFound();

  const t = await getTranslations("organization");
  const locale = await getLocale();

  // PostgREST oddaje relację jeden-do-jednego raz jako obiekt, raz jako
  // tablicę (zależnie od wnioskowania o kardynalności) — ten sam zabieg co
  // w `lib/superadmin.ts`.
  const subscriptionRaw = (tenant as { subscriptions?: unknown }).subscriptions;
  const subscription = (Array.isArray(subscriptionRaw) ? subscriptionRaw[0] : subscriptionRaw) as
    | { plan_id: string | null }
    | null
    | undefined;

  const createdAt = new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Warsaw",
  }).format(new Date(tenant.created_at));

  // Status i język idą ze słownika, nie surową wartością kolumny: „trialing"
  // i „pl" to nazwy z bazy, a ekran czyta operator. Nieznana wartość spada na
  // surową — lepiej pokazać `past_due` niż pustkę po brakującym kluczu.
  const label = (key: "statusValue" | "localeValue", value: string) => {
    const path = `${key}.${value}` as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : value;
  };

  const rows: { label: string; value: string; numeric?: boolean }[] = [
    { label: t("name"), value: tenant.name },
    { label: t("slug"), value: tenant.slug },
    { label: t("plan"), value: subscription?.plan_id ?? t("planMissing") },
    { label: t("status"), value: label("statusValue", tenant.status) },
    { label: t("createdAt"), value: createdAt, numeric: true },
    { label: t("locale"), value: label("localeValue", tenant.locale) },
  ];

  return (
    <FormMeasure className="flex flex-col gap-4">
      <OrganizationCard name={tenant.name} status={tenant.status} rows={rows} />

      {/* Klucze publicznego API (M1, ADR-108). Od M2 (ADR-110) ekran ma
          własną pozycję „Integracje" w grupie KANAŁY — ten link ZOSTAJE jako
          drugie wejście, bo klucz API to poświadczenie CAŁEJ organizacji,
          jak członkostwo, i operator szuka go także tutaj. */}
      <ScreenSection title={t("apiKeysTitle")} description={t("apiKeysDescription")}>
        <Link href="/ustawienia-api" className="text-sm font-medium underline underline-offset-[3px]">
          {t("apiKeysLink")}
        </Link>
      </ScreenSection>

      {/* Eksport danych (C2, ADR-111) — ten sam wzorzec wejścia co klucze
          API: ekran spoza grup nawigacji, a organizacja to naturalny dom
          („zabierz SWOJE dane" dotyczy całej organizacji). */}
      <ScreenSection title={t("dataExportTitle")} description={t("dataExportDescription")}>
        <Link href="/eksport-danych" className="text-sm font-medium underline underline-offset-[3px]">
          {t("dataExportLink")}
        </Link>
      </ScreenSection>
    </FormMeasure>
  );
}
