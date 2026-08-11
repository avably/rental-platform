/**
 * Trwały baner stanu rozliczeń w shellu panelu (J2 faza 2a, ADR-136).
 *
 * Renderowany dla `past_due` i `suspended` — presja dunningowa idzie NA
 * NAJEMCĘ, nigdy na jego klientów (zasada 3 okna dunningowego): sklep w
 * past_due działa normalnie (predykat ADR-134), a operator widzi w panelu
 * rzeczowy komunikat z jednym wejściem do rozliczeń. BEZ odliczania dni —
 * zegar ponowień należy do dostawcy (zasada 1); własny licznik okna
 * domykania doda faza 2b.
 *
 * `suspended` obsłużony defensywnie: dziś statusy zamykające panel kierują
 * na /organizacja-zawieszona (ADR-107), więc shell tego stanu zwykle nie
 * renderuje — ale okno domykania 2b otworzy część panelu i baner ma tam
 * być od pierwszego dnia, nie dopisany po fakcie.
 *
 * FAIL-SILENT: baner to informacja, nie guard — awaria odczytu nie może
 * wywrócić shella (twardą bramką statusów pozostaje requireMember/RLS).
 */
import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getAuthContext } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function BillingStatusBanner() {
  let status: string | null;
  try {
    const supabase = await createSupabaseServerClient();
    const ctx = await getAuthContext(supabase);
    if (!ctx?.tenantId) return null;
    const { data } = await supabase
      .from("tenants")
      .select("status")
      .eq("id", ctx.tenantId)
      .maybeSingle();
    status = (data as { status: string } | null)?.status ?? null;
  } catch {
    return null;
  }

  if (status !== "past_due" && status !== "suspended") return null;

  const t = await getTranslations("billingBanner");
  const messageKey = status === "past_due" ? "pastDue" : "suspended";

  return (
    <div
      role="status"
      data-billing-banner={status}
      className="border-border bg-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2 md:px-6"
    >
      <p className="text-sm leading-5 font-medium">{t(messageKey)}</p>
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
