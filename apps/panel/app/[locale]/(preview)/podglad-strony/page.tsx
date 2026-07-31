/**
 * PODGLĄD SZKICU JAKO OSOBNY DOKUMENT (kreator A3) — treść ramki osadzonej w
 * edytorze `/strona`.
 *
 * Grupa `(preview)` stoi POZA `(panel)`, więc podgląd nie dostaje shella
 * panelu: w ramce ma być sama strona sklepu, bez sidebara i belki. Adres nie
 * niesie nazwy grupy, więc trasa to po prostu `/podglad-strony`.
 *
 * DLACZEGO OSOBNY DOKUMENT, SKORO PODGLĄD DA SIĘ WYRENDEROWAĆ NA MIEJSCU:
 * media queries storefrontu reagują na szerokość OKNA, a nie kontenera.
 * Podgląd renderowany bezpośrednio w kolumnie edytora pokazywałby więc układ
 * desktopowy ściśnięty do wąskiej kolumny, a przełącznik „mobile" byłby
 * dekoracją. Własny dokument w ramce daje własny viewport — i to jest jedyny
 * powód, dla którego ta trasa istnieje.
 *
 * `force-dynamic` NIE JEST OZDOBĄ: layout locale ma `generateStaticParams`,
 * więc trasa bez tego pinu poszłaby w statyczny prerender, a CSP z nonce per
 * żądanie odmówiłaby wykonania skryptów z prerenderu — strona wyszłaby
 * niezhydratowana, bez jednego błędu (odkrycie ze spike'u C0). Zapytania idą
 * i tak przez cookies sesji, ale pin zostaje jawny, bo pilnuje CSP, nie danych.
 */
import { notFound } from "next/navigation";

import { SitePreview } from "@/app/[locale]/(panel)/strona/site-preview";
import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";

import { ScrollToSection } from "./scroll-to-section";

export const dynamic = "force-dynamic";

export default async function SiteDraftPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const ctx = await requireMemberPage("/podglad-strony");
  const data = await getSiteWithSections();

  // Brak strony to nie pusty podgląd, tylko 404 ramki: stronę zakłada wejście
  // na edytor (`ensureSite`), więc ramka bez niej znaczy, że ktoś wszedł na
  // adres podglądu z ręki.
  if (!data) notFound();

  const products = await previewProductsFor(ctx, ctx.tenantId!);
  const { focus } = await searchParams;

  return (
    <>
      <SitePreview
        sections={toEditorSections(data.sections)}
        template={data.site.template}
        products={products}
      />
      <ScrollToSection sectionId={focus ?? null} />
    </>
  );
}
