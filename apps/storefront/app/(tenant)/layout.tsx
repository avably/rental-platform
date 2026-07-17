/**
 * Root layout osi TENANCKIEJ (Zadanie 2.1, ADR-039) — osobny od osi
 * marketingowej (`app/[locale]/layout.tsx`). To są DWIE niezależne osie: sklep
 * tenanta bierze język z `tenants.locale`, nie z prefiksu URL ani z
 * przeglądarki, więc nie może dziedziczyć layoutu locale. Route group
 * `(tenant)` nie wchodzi do ścieżki; oba layouty są rootami (brak
 * `app/layout.tsx` — wzorzec next-intl), każdy renderuje własny `<html>`.
 *
 * MINIMALNY z rozmysłem: pełna powłoka storefrontu (fonty, globalny CSS,
 * nawigacja) to Zadanie 2.4 w pasie prezentacji. Tu jest tylko szkielet pod
 * dowód, że routing i izolacja działają.
 */
import type { ReactNode } from "react";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
