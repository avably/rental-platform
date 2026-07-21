import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenHeader, ScreenSection } from "@/components/screens/screen-header";
import { requireMemberPage } from "@/lib/member-page";

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

  const rows: { label: string; value: string; numeric?: boolean }[] = [
    { label: t("name"), value: tenant.name },
    { label: t("slug"), value: tenant.slug },
    { label: t("plan"), value: subscription?.plan_id ?? t("planMissing") },
    { label: t("status"), value: tenant.status },
    { label: t("createdAt"), value: createdAt, numeric: true },
    { label: t("locale"), value: tenant.locale },
  ];

  return (
    <div className="flex flex-col gap-4">
      <ScreenHeader title={t("title")} />
      <ScreenSection title={undefined} description={undefined}>
        <p className="text-muted-foreground text-sm">{t("description")}</p>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.label} className="flex flex-col gap-1" data-field={row.label}>
              <dt className="text-muted-foreground text-[11px] leading-[14px] font-semibold tracking-[0.06em] uppercase">
                {row.label}
              </dt>
              {/* Slug i status są z natury tekstem, nie liczbą — klasa cyfr
                  tabelarycznych idzie WYŁĄCZNIE tam, gdzie są dane liczbowe
                  (ADR-053 D3), czyli tu na datę. */}
              <dd className={row.numeric ? "text-sm tabular-nums" : "text-sm"}>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-muted-foreground text-[13px] leading-[18px]">{t("readOnly")}</p>
      </ScreenSection>
    </div>
  );
}
