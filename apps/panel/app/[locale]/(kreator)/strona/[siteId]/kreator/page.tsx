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

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";

import { SiteBuilder } from "./site-builder";

export const dynamic = "force-dynamic";

export default async function SiteBuilderPage({
  params,
}: {
  params: Promise<{ siteId: string }>;
}) {
  const { siteId } = await params;
  const ctx = await requireMemberPage(`/strona/${siteId}/kreator`);
  const data = await getSiteWithSections(siteId);

  // Wersja strony wskazana adresem NIE ISTNIEJE albo należy do innego tenanta
  // (RLS tnie wiersz — wynik ten sam, celowo nieodróżnialny). To 404, a nie
  // puste płótno: kreator bez strony nie ma czego edytować.
  if (!data) notFound();

  const products = await previewProductsFor(ctx, ctx.tenantId!);

  /*
   * PUNKTY ODBIORU DO SKOPIOWANIA W SEKCJI DOJAZDU (E5, ADR-096).
   *
   * Mapowanie wiersza bazy na wpis sekcji siedzi TUTAJ, a nie w szufladzie:
   * mini-CMS jest frameworkiem, który nie zna ani tabel, ani typów sekcji, więc
   * gdyby to on składał adres z trzech kolumn, przestałby nim być.
   *
   * TYLKO AKTYWNE punkty: punkt wyłączony w Dostawach nie przyjmuje odbiorów,
   * a strona, która go ogłasza, wysyła klienta pod zamknięte drzwi. Kolejność po
   * nazwie jest tą, którą operator widzi na ekranie punktów — po skopiowaniu
   * i tak może ją przestawić, bo treść należy już do sekcji.
   */
  const { data: pickupLocations } = await ctx.supabase
    .from("pickup_locations")
    .select("name, address_street, address_zip, address_city")
    .eq("tenant_id", ctx.tenantId!)
    .eq("active", true)
    .order("name", { ascending: true });

  const pickupEntries = (pickupLocations ?? [])
    .map((location) => ({
      label: location.name,
      address: [
        location.address_street,
        [location.address_zip, location.address_city].filter(Boolean).join(" "),
      ]
        .filter((part) => part !== null && part.trim().length > 0)
        .join(", "),
    }))
    // Punkt bez adresu nie przeszedłby schematu sekcji (adres jest jej jedynym
    // polem wymaganym), a wpis, którego zapis kończy się błędem, jest gorszy niż
    // jego brak na liście do skopiowania.
    .filter((entry) => entry.address.length > 0);

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
      /*
       * Nazwa źródła jest LUSTREM `itemsImport` z rejestru typów strukturalnych
       * (@avably/core/site) — dopisanie tu drugiego źródła nie wymaga zmiany
       * w szufladzie, a typ bez deklaracji nie dostanie cudzych danych.
       */
      importSources={{ pickupLocations: pickupEntries }}
    />
  );
}
