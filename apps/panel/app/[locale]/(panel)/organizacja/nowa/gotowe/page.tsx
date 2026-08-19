import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { SAAS_TRIAL_DAYS, tenantSubdomainHost } from "@avably/core";

import { FormMeasure } from "@/components/screens/form-measure";
import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { fetchStartCardSignals } from "@/lib/dashboard/start-card";
import { requireMemberPage } from "@/lib/member-page";
import { STORE_STATE_MESSAGE_KEYS, storeVisibilityState } from "@/lib/store-visibility";

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

  const [{ data: tenant }, signals] = await Promise.all([
    ctx.supabase
      .from("tenants")
      .select("name, slug, trial_ends_at")
      .eq("id", ctx.tenantId)
      .maybeSingle(),
    // memberPage gwarantuje tenantId — `!` odzwierciedla gwarancję guardu.
    fetchStartCardSignals(ctx.supabase, ctx.tenantId!),
  ]);

  // Guard wpuścił, ale RLS nic nie oddało — stan nie do wyświetlenia
  // (ten sam zabieg co na ekranie /organizacja).
  if (!tenant) notFound();

  const t = await getTranslations("organizationCreated");
  const locale = await getLocale();

  const storeHost = tenantSubdomainHost(tenant.slug);
  // Zdanie pod adresem wynika ze STANU (produkty? strona opublikowana?), nie
  // z frazy stałej (M-UX-01) — mapowanie sygnałów żyje w lib/store-visibility.
  const storeState = storeVisibilityState(signals);
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
    /*
      KARTA PANELU (uwaga właściciela 2026-08-19, ta sama co /organizacja/nowa):
      potwierdzenie stało na gołym tle, a blok faktów miał obrys bez białego
      tła. Całość wchodzi w białą kartę (`ScreenSection` — tytuł i treść jak
      na każdym innym ekranie panelu), blok faktów zostaje wewnętrznym blokiem
      z obrysem NA białym (precedens: kafle pulpitu). Szerokość ze wspólnej
      miary formularza — własne `max-w-*` zapala skan spójności (ADR-060).
    */
    <FormMeasure className="mx-auto">
      <ScreenSection title={t("title", { name: tenant.name })} description={t("body")}>
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
            <dd data-store-state={storeState} className="text-muted-foreground text-sm">
              {t(STORE_STATE_MESSAGE_KEYS[storeState])}
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
      </ScreenSection>
    </FormMeasure>
  );
}
