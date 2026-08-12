/**
 * Katalog tenanta na PŁÓTNO kreatora (K1, ADR-083) — sekcja „Produkty" nie
 * może pokazywać atrap: operator układa stronę wokół tego, co naprawdę ma
 * w katalogu, a kafle demonstracyjne kłamałyby o wysokości i gęstości sekcji.
 *
 * Odczyt uwierzytelniony, przez RLS (0007) — dokładnie ten sam kształt
 * `StorefrontProduct`, który dostaje sklep, więc płótno i strona publiczna
 * rysują sekcję produktów z jednego rodzaju danych.
 */
import { customFieldDisplayRows, customFieldValuesFromColumn, formatMoney } from "@avably/core";
import type { StorefrontProduct } from "@avably/ui";
import { getLocale, getTranslations } from "next-intl/server";

import type { AuthContext } from "./auth";
import { loadCustomFieldDefinitions } from "./custom-fields";
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
  /**
   * Język ETYKIETY CENY („od {price} / doba" i zapis kwoty). Domyślnie locale
   * PANELU — na płótnie kreatora cena mówi językiem operatora. PODGLĄD SZKICU
   * podaje tu locale TENANTA (L6, ADR-102): odpowiada na pytanie „co zobaczy
   * klient", a klient sklepu EN dostaje „from PLN … / day", nie „od … / doba".
   */
  labelLocale?: string,
): Promise<StorefrontProduct[]> {
  const [t, currency, locale, definitions] = await Promise.all([
    labelLocale
      ? getTranslations({ locale: labelLocale, namespace: "site" })
      : getTranslations("site"),
    getTenantCurrency(ctx.supabase, tenantId),
    labelLocale ?? getLocale(),
    /*
     * DEFINICJE PÓL WŁASNYCH SPRZĘTU (faza 1b, ADR-154) — bez nich płótno
     * rysowałoby kafel BEZ podtytułu i cech, mimo że sklep je pokazuje.
     * Płótno przestałoby wtedy być dowodem na to, co zobaczy klient (ADR-083),
     * a operator ustawiałby wskazania na ślepo.
     */
    loadCustomFieldDefinitions(ctx.supabase, tenantId, "product"),
  ]);

  const { data: products } = await ctx.supabase
    .from("products")
    .select("id, name, description, base_price_day_grosze, custom_fields")
    .eq("tenant_id", tenantId)
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(CANVAS_PRODUCTS_LIMIT);

  // Język ZAPISU wartości (data, liczba) — ten sam, co etykieta ceny obok.
  const valueLocale = locale === "en" ? "en" : "pl";

  return (products ?? []).map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    priceLabel: t("preview.priceFrom", {
      price: formatMoney(product.base_price_day_grosze, currency, locale),
    }),
    imageUrl: null,
    imageAlt: product.name,
    /*
      GRANICA PUBLICZNA POWTÓRZONA W PODGLĄDZIE. Panel czyta tabelę wprost
      (RLS, nie RPC katalogu), więc zawężenie „tylko pola widoczne w zamawianiu"
      musi zrobić on sam — robi je `customFieldDisplayRows` powierzchnią
      `checkout`, czyli TĄ SAMĄ funkcją, której lustrem jest warunek
      `show_in_checkout` w `app.get_public_catalog` (0058). Bez tego płótno
      pokazywałoby operatorowi pola lady jako gotowe do wystawienia klientowi.
    */
    fields: customFieldDisplayRows(definitions, customFieldValuesFromColumn(product.custom_fields), {
      surface: "checkout",
      entity: "product",
      locale: valueLocale,
    }),
  }));
}
