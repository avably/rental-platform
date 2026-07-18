/**
 * Root layout osi TENANCKIEJ (Zadanie 2.1, ADR-039; render sekcyjny 2.3b).
 * Osobny od osi marketingowej (`app/[locale]/layout.tsx`) — sklep tenanta bierze
 * język z `tenants.locale`, nie z prefiksu URL, więc nie dziedziczy layoutu
 * locale. Route group `(tenant)` nie wchodzi do ścieżki; oba layouty są rootami
 * (wzorzec next-intl), każdy renderuje własny `<html>`.
 *
 * 2.3b dokłada design system: globalny CSS (`@avably/ui` + Tailwind) i zmienne
 * fontów, bez których szablony sekcji nie miałyby tokenów. Powłoka jest wciąż
 * cienka — render treści robią komponenty sekcji.
 *
 * SZEW: `lang` jest tymczasowo stałe „pl" (domyślny język tenanta). Gdy oś
 * tenancka będzie nieść `tenants.locale` (nagłówek z middleware), podmienimy je
 * na język tenanta — bez wpływu na render sekcji (treść jest autorska).
 */
import type { ReactNode } from "react";

import { fontVariables } from "@/app/fonts";

import "../globals.css";

export default function TenantLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
