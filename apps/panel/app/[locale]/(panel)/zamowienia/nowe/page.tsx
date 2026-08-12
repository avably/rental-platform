import type { IsoDate } from "@avably/core";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { loadPanelCustomFields } from "@/lib/custom-fields";
import { requireMemberPage } from "@/lib/member-page";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { createOrderAction } from "../actions";
import { OrderWizard } from "./order-wizard";
import { fetchOrderWizardData } from "./wizard-query";

export default async function NewOrderPage() {
  const ctx = await requireMemberPage("/zamowienia/nowe");
  const customFields = await loadPanelCustomFields(ctx.supabase, ctx.tenantId!, "order");

  // „Dziś" w UTC — spójnie z IsoDate silnika (doby bez strefy). To odczyt
  // zegara, nie arytmetyka dat: całą arytmetykę robi buildDayMap silnikiem.
  const today = new Date().toISOString().slice(0, 10) as IsoDate;

  // Wszystkie odczyty kreatora (zawężone do najemcy) siedzą w jednej funkcji —
  // wołanej dokładnie tak przez sondę izolacji, patrz `wizard-query.ts`.
  const data = await fetchOrderWizardData(ctx.supabase, ctx.tenantId!, today);

  const currency = await getTenantCurrency(ctx.supabase, ctx.tenantId!);
  const locale = await getLocale();
  const t = await getTranslations("orders.form");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-end gap-3">
        <Link className="text-sm underline" href="/zamowienia">
          {t("backToList")}
        </Link>
      </header>

      {data.products.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("noProducts")}</p>
      ) : (
        <OrderWizard
          action={createOrderAction}
          customers={data.customers}
          customersTruncated={data.customersTruncated}
          products={data.products}
          locations={data.locations}
          currency={currency}
          locale={locale}
          deliveryPricing={data.deliveryPricing}
          paymentAccountConnected={data.paymentAccountConnected}
          customFields={customFields}
        />
      )}
    </div>
  );
}
