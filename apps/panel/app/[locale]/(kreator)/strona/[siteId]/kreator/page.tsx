/**
 * TRASA KREATORA STRON `/strona/[siteId]/kreator` (K1, ADR-083; segment wersji
 * od 0048/ADR-093) — pełny ekran.
 *
 * Grupa `(kreator)` stoi POZA `(panel)`, więc trasa nie dostaje powłoki panelu:
 * na płótnie buduje się stronę sklepu i każdy piksel sidebara jest tu zabrany
 * z tej pracy. Nazwa grupy nie wchodzi do adresu — trasa to po prostu
 * `/strona/[siteId]/kreator`, a zakładka „Strona sklepu" (`/strona`) jest listą
 * wersji, z której się tu wchodzi. Segment `[siteId]` jest OBOWIĄZKOWY, odkąd
 * wersji może być wiele — bez niego kreator nie miałby czym wybrać strony.
 *
 * `force-dynamic` NIE JEST OZDOBĄ: layout locale ma `generateStaticParams`, więc
 * bez pinu Next.js wciągnąłby kreator w statyczny prerender, a CSP panelu
 * (nonce per żądanie + `strict-dynamic`) odmówiłaby wykonania skryptów
 * wypieczonych z nonce'em z czasu builda. Strona wyrenderowałaby się poprawnie
 * i NIE zhydratowała — bez jednego błędu w konsoli (odkrycie ze spike'u C0).
 * Kreator bez hydracji to martwe płótno, więc pin pilnuje testem, nie komentarzem.
 *
 * Bramka wejścia jest ta sama, co na reszcie tras tenanta (`requireMemberPage`);
 * właściwą izolacją danych pozostaje RLS (0019), nie ten guard.
 */
import { resolveSiteStyle } from "@avably/core/site";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { requireMemberPage } from "@/lib/member-page";
import { catalogProductEntries, pickupLocationEntries } from "@/lib/site-import-sources";
import { previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";
import { getTenantCurrency } from "@/lib/tenant-currency";

import { SiteBuilder } from "./site-builder";

export const dynamic = "force-dynamic";

export default async function SiteBuilderPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const locale = await getLocale();
  const ctx = await requireMemberPage(`/strona/${siteId}/kreator`);
  const data = await getSiteWithSections(siteId);

  // Wersja strony wskazana adresem NIE ISTNIEJE albo należy do innego tenanta
  // (RLS tnie wiersz — wynik ten sam, celowo nieodróżnialny). To 404, a nie
  // puste płótno: kreator bez strony nie ma czego edytować.
  if (!data) notFound();

  const products = await previewProductsFor(ctx, ctx.tenantId!);

  /*
   * WALUTA I ZAPIS KWOT NAJEMCY (E6, aneks ADR-094). Jedna wartość na dwa
   * cele: płótno rysuje nią cennik dokładnie tak, jak zobaczy go klient,
   * a szuflada przelicza nią to, co operator wpisuje w polu ceny. Locale bierze
   * się z PANELU, bo to jego język operator ma pod klawiaturą — a waluta
   * z ustawienia najemcy, bo to ona stoi w katalogu, kasie i na fakturach.
   */
  const money = { currency: await getTenantCurrency(ctx.supabase, ctx.tenantId!), locale };

  /*
   * PUNKTY ODBIORU DO SKOPIOWANIA W SEKCJI DOJAZDU (E5, ADR-096).
   *
   * Trasa CZYTA wiersze, a o tym, które z nich stają się wpisami sekcji,
   * rozstrzyga czysta `pickupLocationEntries` — łącznie z odsiewem punktów
   * NIEAKTYWNYCH. Zapytanie celowo nie filtruje samo (delta recenzji PM do
   * PR #186): reguła w warunku SQL była niewidoczna dla każdego testu, więc jej
   * wycięcie przechodziło całą siatkę na zielono.
   *
   * Sortowanie zostaje tutaj — kolejność to własność ODCZYTU (operator widzi
   * punkty po nazwie na ekranie Dostaw), a nie reguła produktowa.
   */
  const { data: pickupLocations } = await ctx.supabase
    .from("pickup_locations")
    .select("name, address_street, address_zip, address_city, active")
    .eq("tenant_id", ctx.tenantId!)
    .order("name", { ascending: true });

  const pickupEntries = pickupLocationEntries(pickupLocations ?? []);

  return (
    <SiteBuilder
      siteId={data.site.id}
      siteName={data.site.name}
      /*
       * Styl SZKICU. Kolumna `sites.template` wchodzi tu jako FALLBACK stron
       * sprzed ADR-090 — dzięki temu strona zastana renderuje się motywem
       * zastanym, czyli dokładnie tak, jak wyglądała.
       */
      style={resolveSiteStyle(data.site.style_draft, data.site.template)}
      sections={toEditorSections(data.sections)}
      products={products}
      money={money}
      /*
       * Nazwa źródła jest LUSTREM `itemsImport` / `itemsPick` z rejestru typów
       * strukturalnych (@avably/core/site) — dopisanie tu drugiego źródła nie
       * wymaga zmiany w szufladzie, a typ bez deklaracji nie dostanie cudzych
       * danych.
       *
       * Katalog do WSKAZANIA składamy z tej samej listy, którą dostaje płótno:
       * podgląd kreatora i selektor szuflady widzą wtedy dokładnie ten sam
       * sprzęt, więc pozycja wskazana w szufladzie na pewno narysuje się na
       * płótnie (i odwrotnie — brak pozycji w jednym miejscu znaczy brak w obu).
       */
      importSources={{
        pickupLocations: pickupEntries,
        catalogProducts: catalogProductEntries(products),
      }}
    />
  );
}
