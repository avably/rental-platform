/**
 * Katalog tenanta na PŁÓTNO kreatora (K1, ADR-083) — sekcja „Produkty" nie
 * może pokazywać atrap: operator układa stronę wokół tego, co naprawdę ma
 * w katalogu, a kafle demonstracyjne kłamałyby o wysokości i gęstości sekcji.
 *
 * Odczyt uwierzytelniony, przez RLS (0007) — dokładnie ten sam kształt
 * `StorefrontProduct`, który dostaje sklep, więc płótno i strona publiczna
 * rysują sekcję produktów z jednego rodzaju danych.
 */
import { formatMoney } from "@avably/core";
import type { StorefrontProduct } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import type { AuthContext } from "./auth";
import { getTenantCurrency } from "./tenant-currency";

/** Limit kafli katalogu na płótnie — tyle, ile pokazuje sekcja produktów. */
const CANVAS_PRODUCTS_LIMIT = 12;

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
    .limit(CANVAS_PRODUCTS_LIMIT);

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
