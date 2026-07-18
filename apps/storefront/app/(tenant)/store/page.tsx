/**
 * Storefront tenanta — RENDER sekcyjny (Zadanie 2.3b, model sekcyjny 2.3, ADR-041).
 * Zastępuje trasę echo z 2.1: czyta OPUBLIKOWANY stan strony tenanta
 * (`getPublishedSite`, warstwa danych 2.3a) i renderuje jego sekcje w wybranym
 * szablonie (classic/bold) tymi samymi komponentami `@avably/ui`, co podgląd w
 * panelu.
 *
 * BRAMKA (bez zmian względem 2.1): trasa osiągalna WYŁĄCZNIE przez rewrite z
 * middleware, który wstrzykuje `x-tenant-id` z rozwiązania server-side. Wejście
 * wprost (bez nagłówka) → 404. Odczyt `headers()` czyni render dynamicznym per
 * żądanie (konieczne pod CSP z nonce). `getPublishedSite` zwraca WYŁĄCZNIE stan
 * opublikowany (draft niewidoczny dla anona — bramka w RPC 0019), fail-closed:
 * błąd/brak strony → `null` → neutralna strona „sklep w budowie" (nie 500/404).
 *
 * PRODUKTY: publiczny (anonimowy) odczyt katalogu tenanta to seam 2.4 — do tego
 * czasu sekcja produktów renderuje sam nagłówek + stan pusty. Podgląd w panelu
 * pokazuje realny katalog (odczyt uwierzytelniony RLS).
 */
import { SiteRenderer } from "@avably/ui";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getPublishedSite } from "@/lib/site/published";
import { TENANT_ID_HEADER } from "@/lib/tenant/headers";

export default async function TenantStorePage() {
  const requestHeaders = await headers();
  const tenantId = requestHeaders.get(TENANT_ID_HEADER);
  if (!tenantId) notFound();

  const site = await getPublishedSite(tenantId);

  if (!site || site.sections.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="text-2xl font-semibold">Sklep jest w budowie</h1>
        <p className="text-muted-foreground">
          Ta wypożyczalnia przygotowuje swoją stronę. Zajrzyj wkrótce.
        </p>
      </main>
    );
  }

  // Publiczny odczyt katalogu (sekcja products) to seam 2.4 — dziś bez produktów.
  return <SiteRenderer sections={site.sections} template={site.template} products={[]} />;
}
