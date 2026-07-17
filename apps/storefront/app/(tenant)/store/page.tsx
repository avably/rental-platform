/**
 * Trasa echo storefrontu tenanta (Zadanie 2.1, ADR-039) — DOWÓD, że routing
 * host→tenant i izolacja działają. Middleware przepisuje `<slug>.avably.io` na
 * `/store` i wstrzykuje rozwiązany `x-tenant-id` / `x-tenant-slug`. Strona je
 * odczytuje i pokazuje.
 *
 * Pełna treść storefrontu (katalog) to Zadanie 2.4; ISR / revalidateTag per
 * tenant zostają jako seam — świadomie NIE budowane teraz. Strona pokazuje
 * SLUG (z hosta) i tenant_id (z rozwiązania) — nazwy tenanta NIE, bo anon nie
 * ma prawa do danych tenanta (0017 zwraca sam uuid; nazwa to Zadanie 2.4+ z
 * własną, autoryzowaną ścieżką odczytu).
 *
 * BRAMKA: trasa jest osiągalna WYŁĄCZNIE przez rewrite z middleware, który
 * wstrzykuje nagłówek. Wejście wprost (np. `www.avably.io/store`) trafia tu bez
 * `x-tenant-id` → 404. To druga warstwa obrony obok strip'owania w middleware:
 * gdyby kiedyś nagłówek przeciekł, brak wartości i tak kończy się 404, nie echem.
 */
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { TENANT_ID_HEADER, TENANT_SLUG_HEADER } from "@/lib/tenant/headers";

// CSP wymaga nonce per żądanie; statyczny HTML nie może go nadać skryptom Next.
export const dynamic = "force-dynamic";

export default async function TenantEchoPage() {
  const requestHeaders = await headers();
  const tenantId = requestHeaders.get(TENANT_ID_HEADER);
  const tenantSlug = requestHeaders.get(TENANT_SLUG_HEADER);

  if (!tenantId) notFound();

  return (
    <main>
      <h1>Avably — storefront tenanta</h1>
      <p>Routing host→tenant działa. To jest trasa echo (Zadanie 2.1).</p>
      <dl>
        <dt>tenant_id</dt>
        <dd data-testid="tenant-id">{tenantId}</dd>
        <dt>slug</dt>
        <dd data-testid="tenant-slug">{tenantSlug}</dd>
      </dl>
    </main>
  );
}
