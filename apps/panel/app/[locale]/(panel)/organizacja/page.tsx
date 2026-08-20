import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { isLiveSaasSubscriptionStatus, stripeBillingAvailability } from "@avably/core";

import { ManageBillingSection } from "@/components/billing/manage-billing-section";
import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

import { SaasCheckoutCta } from "./checkout-cta";
import { OrganizationCard } from "./organization-card";
import { OrganizationEditForm } from "./organization-edit-form";
import { PlanBillingSection } from "./plan-billing-section";

/**
 * Ekran organizacji (ADR-059; edycja właściciela U12/ADR-225).
 *
 * ADR-056 odnotował odstępstwo: pozycja „Organizacja" w nawigacji celowała w
 * `/organizacja/nowa`, bo ekranu organizacji NIE BYŁO. Ten plik zamyka tamten
 * dług — `nav.ts` wraca na `/organizacja`, a identyfikator pozycji zostaje
 * nietknięty, więc kontrakt struktury z artefaktem jest dalej zielony.
 *
 * WŁAŚCICIEL edytuje NAZWĘ i JĘZYK (U12): karta `OrganizationEditForm` woła RPC
 * `app.update_organization` (0093) — jedyną, wąską ścieżkę zapisu do `tenants`,
 * bramkowaną właścicielem i ograniczoną do dwóch kolumn. Slug/plan/status
 * zostają ODCZYTOWE (slug siedzi w adresie sklepu — jego zmiana to osobny
 * moduł domen; status i plan są własnością platformy). STAFF widzi kartę
 * `OrganizationCard` — tę samą co dotąd, bez ani jednej kontrolki.
 *
 * ODCZYT idzie ISTNIEJĄCYM wzorcem: klient z sesją członka i RLS jako bramka
 * (`tenants` — polityka `id = app.tenant_id()`; `subscriptions` — `tenant_id =
 * app.tenant_id()`). Zapis idzie RPC — nie service-role i nie szeroka polityka
 * UPDATE (ta oddałaby ownerowi status/plan/slug).
 */
export default async function OrganizationPage() {
  // Opt-in okna domykania (ADR-138): /organizacja jest i tak read-only,
  // a sekcja rozliczeń (2a) to jedyna droga zapłaty przywracającej dostęp.
  const ctx = await requireMemberPage("/organizacja", { closing: true });

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("id, name, slug, status, locale, created_at, trial_ends_at, subscriptions(plan_id, status)")
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
    | { plan_id: string | null; status: string | null }
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

  // Wiersze, których właściciel NIE zmienia tą ścieżką (slug/plan/status/data)
  // — kontekst konta wspólny dla obu wariantów karty.
  const contextRows: { label: string; value: string; numeric?: boolean }[] = [
    { label: t("slug"), value: tenant.slug },
    // Brak wiersza subscriptions = TRIAL (stan pierwszej klasy, nie brak
    // danych — ADR-135); szczegóły z datą pokazuje sekcja „Plan i rozliczenia".
    { label: t("plan"), value: subscription?.plan_id ?? t("statusValue.trialing") },
    { label: t("status"), value: label("statusValue", tenant.status) },
    { label: t("createdAt"), value: createdAt, numeric: true },
  ];

  // Owner edytuje name+locale (RPC 0093); staff dostaje kartę odczytową z
  // KOMPLETEM wierszy (name/locale wracają jako odczyt, nie pole).
  const organizationCard =
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
      {organizationCard}

      {/* Plan i rozliczenia (J2 faza 1: ADR-135; CTA checkoutu: faza 2a,
          ADR-136) — stan konta + cennik ze stałej @avably/core. CTA
          WYŁĄCZNIE dla ownera, przy dostępnym torze płatności i braku
          żywej subskrypcji; guardem akcji jest requireBillingOwner (K1),
          widoczność tutaj to UX, nie bramka. */}
      <PlanBillingSection
        subscription={
          subscription ? { planId: subscription.plan_id, status: subscription.status } : null
        }
        trialEndsAt={tenant.trial_ends_at}
        checkoutCta={
          ctx.role === "owner" &&
          stripeBillingAvailability().available &&
          !(subscription?.status && isLiveSaasSubscriptionStatus(subscription.status)) ? (
            <SaasCheckoutCta />
          ) : undefined
        }
      />

      {/* Zarządzanie abonamentem (J2 faza 3, ADR-152) — Portal klienta,
          zmiana planu, reaktywacja. Karta bramkuje się SAMA (requireBillingOwner
          + stan projekcji) i przy braku czegokolwiek do zrobienia nie renderuje
          nic, więc ekran organizacji zostaje czystym odczytem tam, gdzie był. */}
      <ManageBillingSection />

      {/* Klucze publicznego API (M1, ADR-108). Od M2 (ADR-110) ekran ma
          własną pozycję „Integracje" w grupie KANAŁY — ten link ZOSTAJE jako
          drugie wejście, bo klucz API to poświadczenie CAŁEJ organizacji,
          jak członkostwo, i operator szuka go także tutaj. */}
      <ScreenSection title={t("apiKeysTitle")} description={t("apiKeysDescription")}>
        <Link href="/ustawienia-api" className="text-sm font-medium underline underline-offset-[3px]">
          {t("apiKeysLink")}
        </Link>
      </ScreenSection>

      {/* Pola własne (C6-A1, ADR-118). Bez własnej pozycji w menu — struktura
          nawigacji jest kontraktem z artefaktem Fazy 2, a pola własne opisują
          kształt danych CAŁEJ organizacji (klient, zamówienie i produkt
          naraz), więc nie należą do żadnego pojedynczego ekranu operacyjnego.
          Wejście jest stąd, wzorcem `punkty-odbioru` i `katalog/import`. */}
      <ScreenSection title={t("customFieldsTitle")} description={t("customFieldsDescription")}>
        <Link
          href="/organizacja/pola-wlasne"
          className="text-sm font-medium underline underline-offset-[3px]"
        >
          {t("customFieldsLink")}
        </Link>
      </ScreenSection>

      {/* Eksport danych (C2, ADR-111). Od M2 (ADR-110) ekran ma pozycję
          „Eksport danych" w grupie ORGANIZACJA; ten link ZOSTAJE jako drugie
          wejście, bo „zabierz SWOJE dane" dotyczy całej organizacji. */}
      <ScreenSection title={t("dataExportTitle")} description={t("dataExportDescription")}>
        <Link href="/eksport-danych" className="text-sm font-medium underline underline-offset-[3px]">
          {t("dataExportLink")}
        </Link>
      </ScreenSection>
    </FormMeasure>
  );
}
