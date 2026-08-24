import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { FormMeasure } from "@/components/screens/form-measure";
import { ReadList } from "@/components/screens/read-list";
import { ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";
import { SecondaryStatusChip } from "@/lib/secondary-status";

import { HubTile } from "./hub-tile";

/**
 * Ekran organizacji jako HUB (uwaga właściciela 2026-08-24, ADR-238).
 *
 * Właściciel: „strona organizacja to powinien być tylko hub do podstron".
 * Wcześniej ten ekran mieszał KARTĘ KONTA, PEŁNE ROZLICZENIA (cennik, checkout,
 * portal) i linki do podstron w jedną ścianę ustawień. Teraz jest punktem
 * wejścia: u góry ZWIĘZŁA tożsamość organizacji (nazwa + stan konta w dwóch
 * wierszach), a niżej KAFELKI do podstron i powiązanych ekranów.
 *
 * CO SIĘ PRZENIOSŁO (reorganizacja układu, NIE zmiana funkcji):
 *   • Dane organizacji (nazwa/język + wiersze kontekstu, edycja właściciela U12)
 *     → `/organizacja/dane` (komponenty `organization-*` bez zmian).
 *   • Plan i rozliczenia (cennik ze stałej, checkout, portal, zmiana planu)
 *     → `/organizacja/plan` (komponenty billing bez zmian).
 * Pola własne były już podstroną (`/organizacja/pola-wlasne`). Umowy, dostawy,
 * e-maile i płatności ZOSTAJĄ pod „Ustawieniami" (kanał/konfiguracja sklepu) —
 * to nie sprawy konta organizacji, więc hub ich nie dubluje.
 *
 * OKNO DOMYKANIA (ADR-138): hub zachowuje opt-in `{ closing: true }`, bo jest
 * jedyną drogą, którą zawieszony tenant dochodzi do płatności — a ta mieszka
 * teraz na `/organizacja/plan` (również z opt-in). Pozostałe kafelki przy
 * otwartym oknie kończą się odmową guardu (odmowa domyślna) i to jest OK: droga
 * do zapłaty jest otwarta, reszta nie musi być.
 *
 * BELKA jest jedynym `h1` (ADR-060) — hub nie renderuje `t("title")`; tytułem
 * pierwszej karty jest NAZWA organizacji, nie słowo „Organizacja".
 */
export default async function OrganizationPage() {
  const ctx = await requireMemberPage("/organizacja", { closing: true });

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("id, name, status, subscriptions(plan_id, status)")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  // Członek BEZ widocznego tenanta to stan nie do wyświetlenia — guard wpuścił,
  // ale RLS nic nie oddało. 404 zamiast pustego huba z myślnikami.
  if (!tenant) notFound();

  const t = await getTranslations("organization");

  // PostgREST oddaje relację jeden-do-jednego raz jako obiekt, raz jako tablicę
  // (jak w `lib/superadmin.ts`).
  const subscriptionRaw = (tenant as { subscriptions?: unknown }).subscriptions;
  const subscription = (Array.isArray(subscriptionRaw) ? subscriptionRaw[0] : subscriptionRaw) as
    | { plan_id: string | null; status: string | null }
    | null
    | undefined;

  // Status ze słownika, nie surową kolumną; nieznana wartość spada na surową.
  const statusLabel = (value: string) => {
    const path = `statusValue.${value}` as Parameters<typeof t>[0];
    return t.has(path) ? t(path) : value;
  };

  // Tożsamość SKRÓTOWO: plan + stan konta (brak wiersza subscriptions = trial,
  // stan pierwszej klasy — ADR-135; szczegóły z datą pokazuje podstrona planu).
  const identityRows = [
    { label: t("plan"), value: subscription?.plan_id ?? t("statusValue.trialing") },
    { label: t("status"), value: statusLabel(tenant.status) },
  ];

  // Zespół (zaproszenia) to ekran WŁAŚCICIELA (ownerOnly w nawigacji) — hub
  // odzwierciedla uprawnienia i nie pokazuje kafelka roli bez dostępu. Bramką
  // pozostaje serwer na docelowym ekranie, kafelek jest filtrem widoku.
  const owner = ctx.role === "owner";

  const tiles = [
    { href: "/organizacja/dane", title: t("hub.dataTitle"), description: t("hub.dataDescription") },
    { href: "/organizacja/plan", title: t("billing.title"), description: t("billing.description") },
    {
      href: "/organizacja/pola-wlasne",
      title: t("customFieldsTitle"),
      description: t("customFieldsDescription"),
    },
    ...(owner
      ? [{ href: "/zaproszenia", title: t("hub.teamTitle"), description: t("hub.teamDescription") }]
      : []),
    { href: "/ustawienia-api", title: t("apiKeysTitle"), description: t("apiKeysDescription") },
    { href: "/eksport-danych", title: t("dataExportTitle"), description: t("dataExportDescription") },
    {
      href: "/bezpieczenstwo",
      title: t("hub.securityTitle"),
      description: t("hub.securityDescription"),
    },
  ];

  return (
    <FormMeasure className="flex flex-col gap-4" data-organization-hub>
      <ScreenSection
        data-organization-identity
        title={tenant.name}
        status={
          tenant.status === "active" ? (
            <SecondaryStatusChip axis="organization" value="active" />
          ) : undefined
        }
        description={t("hub.description")}
      >
        <ReadList rows={identityRows} />
      </ScreenSection>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {tiles.map((tile) => (
          <HubTile
            key={tile.href}
            href={tile.href}
            title={tile.title}
            description={tile.description}
          />
        ))}
      </div>
    </FormMeasure>
  );
}
