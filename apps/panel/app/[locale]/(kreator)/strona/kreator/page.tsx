/**
 * TRASA KREATORA STRON `/strona/kreator` (K1, ADR-083) — pełny ekran.
 *
 * Grupa `(kreator)` stoi POZA `(panel)`, więc trasa nie dostaje powłoki panelu:
 * na płótnie buduje się stronę sklepu i każdy piksel sidebara jest tu zabrany
 * z tej pracy. Nazwa grupy nie wchodzi do adresu — trasa to po prostu
 * `/strona/kreator`, a zakładka „Strona sklepu" (`/strona`) jest jej launcherem.
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
import { notFound } from "next/navigation";

import { toEditorSections } from "@/app/[locale]/(panel)/strona/content";
import { requireMemberPage } from "@/lib/member-page";
import { previewProductsFor } from "@/lib/site-preview-data";
import { getSiteWithSections } from "@/lib/site-queries";

import { SiteBuilder } from "./site-builder";

export const dynamic = "force-dynamic";

export default async function SiteBuilderPage() {
  const ctx = await requireMemberPage("/strona/kreator");
  const data = await getSiteWithSections();

  // Stronę zakłada wejście na launcher (`ensureSite`), więc jej brak znaczy, że
  // ktoś wszedł na adres kreatora z ręki — to 404, a nie puste płótno.
  if (!data) notFound();

  const products = await previewProductsFor(ctx, ctx.tenantId!);

  return (
    <SiteBuilder
      siteId={data.site.id}
      template={data.site.template}
      sections={toEditorSections(data.sections)}
      products={products}
    />
  );
}
