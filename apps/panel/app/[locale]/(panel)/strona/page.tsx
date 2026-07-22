/**
 * Edytor storefrontu tenanta (Zadanie 2.3b — EDYTOR + PODGLĄD SZKICU, skóra P8b).
 *
 * Serwerowo: guard członka, utworzenie strony przy pierwszym wejściu
 * (`ensureSite`, idempotentne — tworzenie to mutacja, nie skutek uboczny
 * odczytu), odczyt szkicu (`getSiteWithSections`, warstwa danych 2.3a) i katalog
 * tenanta do podglądu. Interakcja i podgląd żyją w kliencie (`SiteEditor`),
 * który woła akcje modelu sekcyjnego 2.3a. Produkty w podglądzie to REALNY
 * katalog tenanta (odczyt uwierzytelniony RLS), nie dane demo.
 *
 * Nieudany odczyt szkicu kończy się WŁASNYM stanem (`SiteLoadError`), a nie
 * pustym edytorem: mockup `secondary-site-editor` stawia tę granicę wprost, bo
 * „nie ma sekcji” i „nie wiadomo, czy są sekcje” to dwa różne komunikaty.
 */
import { formatMoney } from "@avably/core";
import type { StorefrontProduct } from "@avably/ui";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";

import { ScreenBackLink } from "@/components/screens/screen-header";
import { ensureSite } from "@/lib/actions/site";
import { requireMemberPage } from "@/lib/member-page";
import { getSiteWithSections } from "@/lib/site-queries";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { toEditorSections } from "./content";
import { SiteEditor } from "./site-editor";
import { SiteLoadError } from "./site-load-error";

export default async function SitePage() {
  const ctx = await requireMemberPage("/strona");
  const tenantId = ctx.tenantId!;
  const t = await getTranslations("site");

  // Utworzenie strony przy pierwszym wejściu (jedna per tenant, idempotentne).
  const ensured = await ensureSite();
  const data = ensured.ok ? await getSiteWithSections() : null;

  if (!ensured.ok || !data) {
    return (
      <SiteLoadError
        backLabel={t("backHome")}
        title={t("loadErrorTitle")}
        message={ensured.ok ? t("loadError") : ensured.error}
      />
    );
  }

  const currency = await getTenantCurrency(ctx.supabase, tenantId);
  const locale = await getLocale();
  const format = await getFormatter();
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

  const publishedAtLabel = data.site.published_at
    ? format.dateTime(new Date(data.site.published_at), {
        dateStyle: "short",
        timeStyle: "short",
      })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <ScreenBackLink href="/" label={t("backHome")} />
      <SiteEditor
        siteId={data.site.id}
        template={data.site.template}
        sections={toEditorSections(data.sections)}
        previewProducts={previewProducts}
        publishedAtLabel={publishedAtLabel}
      />
    </div>
  );
}
