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

import type { Metadata } from "next";

import { fontVariables } from "@/app/fonts";
import { tenantOrigin } from "@/lib/seo/request-origin";
import { loadStorefrontContext } from "@/lib/storefront/context";

import "../globals.css";

/**
 * `metadataBase` na POZIOMIE LAYOUTU osi tenanckiej (Zadanie 2.7, ADR-044).
 * Next rozwija nim adresy plikowych obrazków `opengraph-image`; ustawiony
 * dopiero na stronie NIE dosięga tej rozdzielczości i miniatura wskazywałaby
 * host nasłuchu zamiast subdomeny sklepu.
 */
export async function generateMetadata(): Promise<Metadata> {
  const origin = await tenantOrigin();
  return origin ? { metadataBase: new URL(origin) } : {};
}

export default async function TenantLayout({ children }: { children: ReactNode }) {
  const ctx = await loadStorefrontContext();

  // Zdjęcia produktów leżą w Storage, czyli na INNYM origin niż dokument.
  // Bez preconnectu przeglądarka zestawia to połączenie dopiero, gdy natrafi na
  // pierwszy <img> — a to zdjęcie bywa elementem LCP (szablon `bold`). Pomiar
  // pokazał ~1 s „Load Delay” na tej ścieżce; preconnect zdejmuje z niej
  // handshake, zamiast go tylko przesuwać.
  const storageOrigin = ctx?.supabaseUrl ? safeOrigin(ctx.supabaseUrl) : null;

  return (
    <html lang={ctx?.locale ?? "pl"} className={`${fontVariables} h-full antialiased`}>
      <head>
        {storageOrigin ? (
          <link rel="preconnect" href={storageOrigin} crossOrigin="anonymous" />
        ) : null}
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}

/** Origin z konfiguracji Supabase; zły adres nie może wywrócić layoutu. */
function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
