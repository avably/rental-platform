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

/**
 * ILE POZYCJI KATALOGU CZYTA KREATOR.
 *
 * Do E7 było ich dwanaście — tyle, ile mieściła sekcja produktów na płótnie.
 * Sekcja sprzętu v3 czyta tę samą listę DWA RAZY: raz jako treść (przy źródle
 * „katalog") i raz jako zbiór do WSKAZANIA w szufladzie. Przy suficie 12 sprzęt
 * spoza pierwszej dwunastki alfabetu byłby nie do wybrania, a pozycja wskazana
 * wcześniej znikałaby z podglądu jako „usunięta z katalogu" — mimo że w
 * katalogu stoi.
 *
 * Sufit zostaje mimo to, i to nie jest ostrożność na zapas: to jest ODCZYT DO
 * PODGLĄDU, a katalog najemcy nie ma górnej granicy. Sześćdziesiąt pokrywa
 * z zapasem i sufit sekcji (24 wskazania), i realny katalog wypożyczalni —
 * a strona publiczna i tak czyta katalog własną drogą, bez tego limitu.
 */
const CANVAS_PRODUCTS_LIMIT = 60;

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
