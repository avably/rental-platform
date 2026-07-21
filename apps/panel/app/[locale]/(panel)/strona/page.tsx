/**
 * Edytor storefrontu tenanta (Zadanie 2.3b — EDYTOR + PODGLĄD DRAFTU).
 *
 * Serwerowo: guard członka, utworzenie strony przy pierwszym wejściu
 * (`ensureSite`, idempotentne — tworzenie to mutacja, nie skutek uboczny
 * odczytu), odczyt draftu (`getSiteWithSections`, warstwa danych 2.3a) i katalog
 * tenanta do podglądu. Interakcja i podgląd żyją w kliencie (`SiteEditor`),
 * który woła akcje modelu sekcyjnego 2.3a. Produkty w podglądzie to REALNY
 * katalog tenanta (odczyt uwierzytelniony RLS), nie dane demo.
 */
import { formatMoney } from "@avably/core";
import type { StorefrontProduct } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ensureSite } from "@/lib/actions/site";
import { requireMemberPage } from "@/lib/member-page";
import { getSiteWithSections } from "@/lib/site-queries";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { toEditorSections } from "./content";
import { SiteEditor } from "./site-editor";

export default async function SitePage() {
  const ctx = await requireMemberPage("/strona");
  const tenantId = ctx.tenantId!;
  const t = await getTranslations("site");

  // Utworzenie strony przy pierwszym wejściu (jedna per tenant, idempotentne).
  const ensured = await ensureSite();
  const data = ensured.ok ? await getSiteWithSections() : null;

  if (!ensured.ok || !data) {
    return (
      <div className="flex flex-col gap-4">
        <Link className="text-sm underline" href="/">
          {t("backHome")}
        </Link>
        <p role="alert" className="text-sm text-destructive">
          {ensured.ok ? t("loadError") : ensured.error}
        </p>
      </div>
    );
  }

  const currency = await getTenantCurrency(ctx.supabase, tenantId);
  const locale = await getLocale();
  const { data: products } = await ctx.supabase
    .from("products")
    .select("id, name, description, base_price_day_grosze")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(12);

  const previewProducts: StorefrontProduct[] = (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceLabel: t("preview.priceFrom", {
      price: formatMoney(product.base_price_day_grosze, currency, locale),
    }),
    imageUrl: null,
    imageAlt: product.name,
  }));

  return (
    <div className="flex flex-col gap-6">
      <Link className="text-sm underline" href="/">
        {t("backHome")}
      </Link>
      <SiteEditor
        siteId={data.site.id}
        template={data.site.template}
        sections={toEditorSections(data.sections)}
        previewProducts={previewProducts}
      />
    </div>
  );
}
