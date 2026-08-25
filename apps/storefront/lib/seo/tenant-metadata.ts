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
import { isBoundAttribute, isSectionCanvas, paintOrder } from "@avably/core/site";
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
    /*
     * ELEMENT ZWIĄZANY Z KATALOGIEM NIE ODDAJE TU NICZEGO (faza 3, ADR-163).
     *
     * Metadane czytają TREŚĆ, a treść związanego elementu jest napisem
     * PROJEKTOWYM — tym, do którego render wraca po zdjęciu wiązania, i którego
     * odwiedzający nigdy nie widzi. Bez tego odsiewu opis strony w wynikach
     * wyszukiwania pokazywałby zdanie, którego nie ma na stronie.
     *
     * Wartości z katalogu też tu NIE wchodzą, i to jest decyzja, a nie brak
     * czasu: metadane powstają w `generateMetadata`, czyli osobnym przebiegu
     * przed renderem, a podstawianie ich z katalogu jest zadaniem SZABLONU
     * strony produktu (faza 5 — „meta title i meta description są polami
     * szablonu z podstawieniem"). Do tego czasu strona z całkowicie związanym
     * hero dostaje opis neutralny, a nie cudzy.
     */
    const ordered = paintOrder(hero.content.elements).filter(
      (element) => !isBoundAttribute(element, "text"),
    );
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

/**
 * TYTUŁ DOKUMENTU: „{tytuł strony} · {nazwa sklepu}”; sam sklep na jego stronie
 * głównej (S-31 audytu 2026-08-25).
 *
 * ==================== CO SIĘ ZMIENIŁO, A CO NIE ====================
 *
 * TOŻSAMOŚĆ BYŁA I JEST POPRAWNA. Audyt zgłosił „szablon tytułu używa slugu
 * subdomeny (…- godekmaciej)", ale render nigdy nie sięgał po slug: `storeName`
 * przychodzi z `tenants.name`, czyli z pola, które operator wpisuje w
 * zakładaniu organizacji OBOK slugu (`/organizacja/nowa` → `app.create_tenant`
 * przyjmuje `name` i `slug` osobno). Audytowany sklep ma po prostu NAZWĘ równą
 * swojemu uchwytowi. Innego źródła nazwy sklepu w danych nie ma:
 * `getTenantAppearance` niesie motyw i znak, a `tenants.legal_name` (0096) to
 * nazwa Z REJESTRU do faktur i umów — wystawienie jej w tytule sklepu
 * podmieniłoby markę na formę prawną („Jan Kowalski FHU"), czyli pogorszyło
 * dokładnie to, o co w tym zgłoszeniu chodzi. Fallbacku na slug też nie ma po
 * co budować: `tenants.name` jest NOT NULL.
 *
 * ZMIENIA SIĘ SEPARATOR: dywiz `-` był tu jedynym miejscem ścieżki sklepu,
 * które po F5 (typografia — pauzy zamiast dywizów) zostało przy znaku
 * łącznika. Kropka środkowa jest tym samym separatorem, którym ta ścieżka
 * rozdziela człony wszędzie indziej (`formatRentalRange`, licznik kategorii),
 * i nie myli się z dywizem w nazwie własnej („Sprzęt Bud-Mar").
 */
export const TITLE_SEPARATOR = " · ";

export function pageTitle(storeName: string, pageName?: string): string {
  return pageName ? `${pageName}${TITLE_SEPARATOR}${storeName}` : storeName;
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
