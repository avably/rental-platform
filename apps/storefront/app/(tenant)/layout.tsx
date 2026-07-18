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
 * `lang` bierze język z osi tenanckiej (tenants.locale przez getPublicCatalog,
 * 2.4b) — kupujący widzi sklep w języku najemcy. Kontekst jest `cache`'owany per
 * żądanie, więc odczyt tu i na stronie to jedno odpytanie. Fallback „pl” gdy
 * wejście spoza gałęzi tenanckiej (brak nagłówka) — strona i tak da notFound().
 */
import type { ReactNode } from "react";

import { fontVariables } from "@/app/fonts";
import { loadStorefrontContext } from "@/lib/storefront/context";

import "../globals.css";

export default async function TenantLayout({ children }: { children: ReactNode }) {
  const ctx = await loadStorefrontContext();
  return (
    <html lang={ctx?.locale ?? "pl"} className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
