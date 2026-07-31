/**
 * Katalog tenanta do PODGLĄDU strony (kreator A3) — jedno źródło dla edytora
 * (`/strona`) i dla ramki podglądu (`/podglad-strony`).
 *
 * Wspólny helper, a nie dwa zapytania: podgląd ma być dowodem na to, co
 * zobaczy klient, więc gdyby ramka czytała katalog inaczej niż ekran, który ją
 * osadza, rozjazd byłby niewidoczny aż do publikacji. Produkty są REALNE
 * (odczyt uwierzytelniony, przez RLS), nie demonstracyjne.
 */
import { formatMoney } from "@avably/core";
import type { StorefrontProduct } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import type { AuthContext } from "./auth";
import { getTenantCurrency } from "./tenant-currency";

/** Limit kafli katalogu w podglądzie — tyle, ile pokazuje sekcja produktów. */
const PREVIEW_PRODUCTS_LIMIT = 12;

export async function previewProductsFor(
  ctx: AuthContext,
  tenantId: string,
): Promise<StorefrontProduct[]> {
  const [t, currency, locale] = await Promise.all([
    getTranslations("site"),
    getTenantCurrency(ctx.supabase, tenantId),
    getLocale(),
  ]);

  const { data: products } = await ctx.supabase
    .from("products")
    .select("id, name, description, base_price_day_grosze")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(PREVIEW_PRODUCTS_LIMIT);

  return (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceLabel: t("preview.priceFrom", {
      price: formatMoney(product.base_price_day_grosze, currency, locale),
    }),
    imageUrl: null,
    imageAlt: product.name,
  }));
}
