/**
 * Trwały baner stanu rozliczeń w shellu panelu (J2 faza 2a, ADR-136;
 * licznik okna domykania — faza 2b, ADR-138).
 *
 * Renderowany dla `past_due` i `suspended` — presja dunningowa idzie NA
 * NAJEMCĘ, nigdy na jego klientów (zasada 3 okna dunningowego): sklep w
 * past_due działa normalnie (predykat ADR-134), a operator widzi w panelu
 * rzeczowy komunikat z jednym wejściem do rozliczeń. Dla `past_due` BEZ
 * odliczania dni — zegar ponowień należy do dostawcy (zasada 1). Dla
 * `suspended` W OKNIE DOMYKANIA baner mówi wprost, ile dni zostało na
 * domknięcie najmów — to jedyny licznik, jaki ten produkt pokazuje, bo to
 * jedyny zegar, który należy do nas (suspended_at + 30 dni).
 *
 * OD 2b PROP-DRIVEN: stan czyta layout (readTenantBillingState, JEDEN
 * fail-silent odczyt na żądanie shella) i dzieli go między baner a filtr
 * nawigacji. Baner pozostaje informacją, nie guardem — twardą bramką
 * statusów jest requireMember/RLS.
 */
import { closingWindowDaysLeft, isClosingWindowOpen } from "@avably/core";
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import type { TenantBillingState } from "@/lib/closing";

export async function BillingStatusBanner({ state }: { state: TenantBillingState | null }) {
  const status = state?.status ?? null;
  if (status !== "past_due" && status !== "suspended") return null;

  const t = await getTranslations("billingBanner");
  const closingOpen = status === "suspended" && isClosingWindowOpen(state?.suspendedAt ?? null);

  return (
    <div
      role="status"
      data-billing-banner={status}
      className="border-border bg-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2 md:px-6"
    >
      <p className="text-sm leading-5 font-medium">
        {status === "past_due"
          ? t("pastDue")
          : closingOpen
            ? t("suspendedClosing", { days: closingWindowDaysLeft(state?.suspendedAt ?? null) })
            : t("suspended")}
      </p>
      <Link
        href="/organizacja"
        className="text-sm font-semibold underline underline-offset-[3px]"
        data-billing-banner-cta
      >
        {t("cta")}
      </Link>
    </div>
  );
}
