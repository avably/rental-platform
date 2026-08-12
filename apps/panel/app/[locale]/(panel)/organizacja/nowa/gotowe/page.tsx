import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { SAAS_TRIAL_DAYS, tenantSubdomainHost } from "@avably/core";

import { Link } from "@/i18n/navigation";
import { requireMemberPage } from "@/lib/member-page";

/**
 * Potwierdzenie założenia organizacji (ADR-153, N5c).
 *
 * Do tej naprawy `createTenantAction` kończyła nagim `redirect("/")`: tenant
 * powstawał, zegar 14 dni ruszał, subdomena `slug.avably.io` rejestrowała się
 * u dostawcy — i człowiek nie dowiadywał się o NICZYM z tych trzech rzeczy.
 * Ten ekran mówi je wprost, w chwili, w której są prawdziwe.
 *
 * ODCZYT bez nowych uprawnień: klient sesji członka, RLS `tenants` jako
 * bramka (polityka `id = app.tenant_id()`), te same kolumny co ekran
 * /organizacja. Zero service-role, zero nowych zapytań poza tym jednym.
 *
 * GUARD: `requireMemberPage` — sesja BEZ organizacji nie ma tu czego oglądać
 * i wraca na pulpit (tam czeka wejście do zakładania). Ekran jest więc
 * bezpieczny także wtedy, gdy ktoś wklei adres z pamięci.
 *
 * `force-dynamic`: layout `[locale]` ma `generateStaticParams`, a treść
 * zależy od sesji i od bazy — bez pinu Next wciągnąłby trasę w statyczny
 * prerender (ADR-083).
 */
export const dynamic = "force-dynamic";

export default async function TenantCreatedPage() {
  const ctx = await requireMemberPage("/organizacja/nowa/gotowe");

  const { data: tenant } = await ctx.supabase
    .from("tenants")
    .select("name, slug, trial_ends_at")
    .eq("id", ctx.tenantId)
    .maybeSingle();

  // Guard wpuścił, ale RLS nic nie oddało — stan nie do wyświetlenia
  // (ten sam zabieg co na ekranie /organizacja).
  if (!tenant) notFound();

  const t = await getTranslations("organizationCreated");
  const locale = await getLocale();

  const storeHost = tenantSubdomainHost(tenant.slug);
  // Data końca okresu próbnego pochodzi z BAZY (`tenants.trial_ends_at`,
  // 0066/ADR-135), nie z „dziś + 14": to jedno źródło prawdy dla zegara,
  // a ekran ma nie wymyślać własnej arytmetyki. Gdy kolumna jest pusta
  // (rzecz teoretyczna — create_tenant zawsze ją ustawia), pomijamy CAŁY
  // wiersz zamiast pokazywać myślnik albo datę zmyśloną.
  const trialEndsAt = tenant.trial_ends_at
    ? new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Warsaw",
      }).format(new Date(tenant.trial_ends_at))
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.02em]">
          {t("title", { name: tenant.name })}
        </h2>
        <p className="text-muted-foreground mt-3 text-sm">{t("body")}</p>
      </div>

      <dl className="border-border flex flex-col gap-4 rounded-md border p-4">
        <div className="flex flex-col gap-1">
          <dt className="text-muted-foreground text-sm">{t("storeAddressLabel")}</dt>
          <dd className="text-sm font-medium">
            <a
              data-store-address
              href={`https://${storeHost}`}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-[3px]"
            >
              {storeHost}
            </a>
          </dd>
          <dd className="text-muted-foreground text-sm">{t("storeAddressNote")}</dd>
        </div>
        {trialEndsAt ? (
          <div className="flex flex-col gap-1">
            <dt className="text-muted-foreground text-sm">{t("trialLabel")}</dt>
            <dd data-trial-ends-at className="text-sm font-medium">
              {t("trialValue", { date: trialEndsAt })}
            </dd>
            <dd className="text-muted-foreground text-sm">
              {t("trialNote", { days: SAAS_TRIAL_DAYS })}
            </dd>
          </div>
        ) : null}
      </dl>

      <p>
        <Link
          href="/"
          data-tenant-created-cta
          className="bg-primary text-primary-foreground inline-flex cursor-pointer items-center rounded-md border border-transparent px-4 py-2 text-sm font-semibold outline-none transition-[color,background-color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)] hover:underline hover:underline-offset-[3px] focus-visible:border-foreground focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-ring"
        >
          {t("cta")}
        </Link>
      </p>
    </div>
  );
}
