import { Button } from "@avably/ui";
import { PartyPopper } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";

import { ScreenSection } from "@/components/screens/screen-header";
import { Link } from "@/i18n/navigation";
import { fetchProductUnits } from "@/lib/catalog/card-query";
import { deploymentCellProps } from "@/lib/catalog/deployed-today";
import { requireMemberPage } from "@/lib/member-page";
import {
  LAUNCH_STEP_HREFS,
  fetchLaunchSignals,
  isPublishGateOpen,
  launchSteps,
  publishGateSignals,
} from "@/lib/onboarding/launch";
import { warsawToday } from "@/lib/orders/order-dates";

import { saveUnitsAction } from "./actions";
import { UnitsEditor } from "./units-editor";

/**
 * NAGRODA PO OSIĄGNIĘCIU MINIMUM SPRZEDAŻOWEGO (uwaga właściciela #8, ADR-237).
 *
 * Operator dodający egzemplarze jest zwykle na ostatnim kroku onboardingu przed
 * uruchomieniem sklepu — a po skompletowaniu wszystkiego brakowało mu sygnału
 * „gotowe, ruszaj". Ten baner pokazuje się DOKŁADNIE wtedy, gdy soft-gate
 * publikacji jest otwarty (regulamin + aktywny produkt + dostawa), a sklep NIE
 * jest jeszcze opublikowany — czyli w chwili, w której jedyne, co zostało, to
 * uruchomienie w kreatorze.
 *
 * Stan onboardingu NIE jest liczony tu drugi raz: bierzemy go z istniejącego
 * `fetchLaunchSignals` / `launchSteps` / `isPublishGateOpen` (jedno źródło
 * prawdy, ADR-228/229). Błąd odczytu jest cichy (jak reszta fail-silent
 * odczytów shella) — baner-nagroda po prostu się nie pokaże, bo nagroda pokazana
 * na fałszywym stanie jest gorsza niż jej brak.
 */
async function shouldShowLaunchReward(
  supabase: Awaited<ReturnType<typeof requireMemberPage>>["supabase"],
  tenantId: string,
): Promise<boolean> {
  try {
    const signals = await fetchLaunchSignals(supabase, tenantId);
    const steps = launchSteps(signals);
    const storePublished = steps.find((step) => step.key === "appearance")?.done ?? false;
    return isPublishGateOpen(publishGateSignals(signals)) && !storePublished;
  } catch {
    return false;
  }
}

/**
 * Zakładka „Egzemplarze" karty produktu (U8b, ADR-146).
 *
 * Powrót do produktu i nazwa rekordu niesie `../layout.tsx` — tu zostaje sama
 * treść. Stan egzemplarzy (na którym zamówieniu wisi sztuka i kiedy wraca)
 * czytamy TĄ SAMĄ funkcją, która liczy dostępność na karcie
 * (`lib/catalog/card-query.ts`), żeby liczba „X z N" i kolumna stanu nie
 * mogły się rozjechać.
 */
export default async function ProductUnitsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireMemberPage(`/katalog/${id}/egzemplarze`);

  const { data: product } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .maybeSingle();

  if (!product) notFound();

  const { units, unitCount, deployedToday } = await fetchProductUnits(
    ctx.supabase,
    ctx.tenantId!,
    product.id,
    { today: warsawToday() },
  );

  const locale = await getLocale();
  const t = await getTranslations("catalog.units");
  const showReward = await shouldShowLaunchReward(ctx.supabase, ctx.tenantId!);

  return (
    <div className="flex flex-col gap-4">
      {showReward ? (
        <section
          data-launch-reward
          className="border-status-positive-border bg-status-positive-bg flex flex-col gap-3 rounded-lg border p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <PartyPopper className="text-status-positive-fg mt-0.5 size-6 shrink-0" aria-hidden />
            <div className="flex flex-col gap-1">
              <h2 className="text-status-positive-fg text-base leading-[22px] font-semibold">
                {t("rewardTitle")}
              </h2>
              <p className="text-status-positive-fg text-sm leading-[20px]">{t("rewardBody")}</p>
            </div>
          </div>
          <Button asChild className="shrink-0">
            <Link href={LAUNCH_STEP_HREFS.appearance}>{t("rewardCta")}</Link>
          </Button>
        </section>
      ) : null}

      <ScreenSection
        data-product-units
        title={t("heading")}
        status={
          unitCount === 0 ? null : (
            <span
              {...deploymentCellProps(deployedToday, unitCount)}
              className="text-muted-foreground text-sm tabular-nums"
            >
              {t("deployedOf", { deployed: deployedToday, total: unitCount })}
            </span>
          )
        }
        description={t("intro")}
      >
        <UnitsEditor
          action={saveUnitsAction.bind(null, product.id)}
          initialRows={units}
          locale={locale}
        />
      </ScreenSection>
    </div>
  );
}
