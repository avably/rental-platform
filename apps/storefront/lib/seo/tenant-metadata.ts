/**
 * Metadane stron tenanckich (Zadanie 2.7, ADR-044) — CZYSTE buildery.
 *
 * Tytuł i opis biorą się z tego, co najemca OPUBLIKOWAŁ (sekcja hero) plus
 * nazwa tenanta z publicznego katalogu. Nic spoza `get_published_site` /
 * `get_public_catalog` tu nie wchodzi.
 *
 * `lang` osi tenanckiej pochodzi z `tenants.locale` (nie z URL i nie z
 * przeglądarki — ADR-039), więc copy opisów też jest w locale tenanta.
 * Canonical wskazuje na HOST TENANTA (patrz lib/seo/origin.ts).
 */
import { isSectionCanvas, paintOrder } from "@avably/core/site";
import type { Metadata } from "next";

import type { PublishedSite } from "@/lib/site/published";

/**
 * Ścieżka miniatury Open Graph tenanta — lustro trasy
 * `app/(tenant)/store/og/route.tsx` (tam uzasadnienie, czemu własna trasa,
 * a nie konwencja plikowa Next).
 */
export const OG_IMAGE_PATH = "/store/og";

/**
 * Nagłówek i podtytuł pierwszej sekcji hero opublikowanej strony.
 *
 * DWIE GENERACJE TREŚCI (K2, ADR-084): sekcja v1 ma nagłówek w polu, sekcja v2
 * (płótno z elementami) ma go w ELEMENTACH. Dla v2 bierzemy pierwszy element
 * nagłówka w kolejności rysowania i pierwszy element tekstu pod nim — czyli to,
 * co czytelnik zobaczy jako pierwsze. Metadane muszą przetrwać obie generacje,
 * bo dwutorowość jest stanem docelowym aż do wygaszenia v1.
 */
export function heroText(site: PublishedSite | null): { heading?: string; subheading?: string } {
  const hero = site?.sections.find((section) => section.type === "hero");
  if (!hero || hero.type !== "hero") return {};

  if (isSectionCanvas(hero.content)) {
    const ordered = paintOrder(hero.content.elements);
    const heading = ordered.find((element) => element.kind === "heading");
    if (!heading || heading.kind !== "heading") return {};
    const lead = ordered.find((element) => element.kind === "text");
    const result: { heading?: string; subheading?: string } = { heading: heading.text };
    if (lead && lead.kind === "text") result.subheading = lead.text;
    return result;
  }

  const result: { heading?: string; subheading?: string } = { heading: hero.content.heading };
  if (hero.content.subheading) result.subheading = hero.content.subheading;
  return result;
}

/** Ucina opis do długości sensownej dla snippetu (nie w połowie słowa). */
export function clampDescription(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  const cut = normalized.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Tytuł podstrony: „{strona} — {sklep}”; sam sklep, gdy to jego strona główna. */
export function pageTitle(storeName: string, pageName?: string): string {
  return pageName ? `${pageName} — ${storeName}` : storeName;
}

export interface TenantMetadataInput {
  title: string;
  description: string;
  /** Nazwa sklepu (publiczny katalog) — `openGraph.siteName`. */
  storeName: string;
  /**
   * Czy strona sklepu jest OPUBLIKOWANA. `false` → noindex (patrz niżej).
   */
  published: boolean;
  /** Origin hosta tenanta, np. `https://acme.avably.io`; null gdy nieznany. */
  origin: string | null;
  /** Ścieżka kanoniczna strony (`/store`, `/product/<id>`, …). */
  pathname: string;
  /** Locale tenanta (`tenants.locale`) — do `openGraph.locale`. */
  locale: string;
  /**
   * Strony transakcyjne (koszyk, checkout) — zawsze noindex niezależnie od
   * publikacji: nie niosą treści, a w indeksie są wyłącznie szumem.
   */
  transactional?: boolean;
}

/**
 * Wspólna baza metadanych osi tenanckiej: canonical na hoście tenanta,
 * Open Graph typu website, tytuł i opis obcięte do długości snippetu.
 *
 * NOINDEX dla sklepu bez opublikowanej strony — DECYZJA (ADR-044). Taki sklep
 * renderuje neutralną zapowiedź, identyczną dla każdego tenanta: wpuszczenie
 * jej do indeksu produkuje treść cienką i zdublowaną między tenantami, zjada
 * budżet indeksowania i publikuje sklep, na którego publiczność najemca się
 * jeszcze nie zgodził. Po publikacji `noindex` znika sam — nie ma tu żadnego
 * przełącznika do zapamiętania.
 */
export function tenantMetadata(input: TenantMetadataInput): Metadata {
  const canonical = input.origin ? `${input.origin}${input.pathname}` : undefined;
  const description = clampDescription(input.description);
  const noindex = !input.published || input.transactional === true;

  const metadata: Metadata = {
    title: input.title,
    description,
    openGraph: {
      title: input.title,
      description,
      siteName: input.storeName,
      locale: input.locale,
      type: "website",
      ...(canonical ? { url: canonical } : {}),
      // Adres miniatury składamy SAMI z origin tenanta — patrz docblock trasy
      // `(tenant)/store/og`. Konwencja plikowa Next rozwijała go względem hosta
      // nasłuchu, przez co miniatura wskazywała nie tę subdomenę co sklep.
      ...(input.origin
        ? {
            images: [
              { url: `${input.origin}${OG_IMAGE_PATH}`, width: 1200, height: 630, alt: input.storeName },
            ],
          }
        : {}),
    },
  };
  if (noindex) metadata.robots = { index: false, follow: false };
  if (canonical) metadata.alternates = { canonical };
  return metadata;
}
