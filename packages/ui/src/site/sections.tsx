import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  CANVAS_PAD_COLUMNS,
  type SectionCanvas,
} from "@avably/core/site";
import * as React from "react";

import { cn } from "../lib/cn";
import { siteImageUrl } from "./image-url";
import { externalLinkRel } from "./links";
import { bindOrphans } from "./orphans";
import { SiteProductAvailabilityMark } from "./product-availability";
import { siteIconComponent } from "./site-icons";
import { SafeRichText } from "./rich-text";
import type { TemplateStyles } from "./template";
import type {
  CategoriesContent,
  ContactContent,
  CtaContent,
  DeliveryContent,
  DirectionsContent,
  FaqContent,
  FooterContent,
  FreeformContent,
  GalleryContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SiteLogoRender,
  SiteRenderLabels,
  StorefrontProduct,
  TestimonialsContent,
  UspContent,
} from "./types";

/**
 * Prawda o adresie zdjęcia sekcji mieszka od E3 w `./image-url` (plik BEZ ani
 * jednej klasy — patrz tamten nagłówek). Re-eksport zostaje, bo `siteImageUrl`
 * jest publicznym wejściem pakietu od 0043 i wołają je oba produkty.
 */
export { siteImageUrl };


/**
 * Prezentacyjne komponenty sekcji storefrontu. Każdy dostaje swoją treść
 * (kształt z @avably/core/site) + `styles` bieżącego szablonu. Komponenty są
 * czyste (bez stanu, bez fetchowania, bez klienta) — dlatego renderują się
 * identycznie w sklepie publicznym i w podglądzie panelu, a strona storefrontu
 * zostaje serwerowa (mniej skryptów pod CSP z nonce). FAQ używa natywnego
 * <details> zamiast klienta z tego samego powodu.
 */

function SectionShell({
  styles,
  className,
  children,
}: {
  styles: TemplateStyles;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(styles.section, className)}>
      {/* `data-section-reveal` — podmiot animacji wejścia (addendum E9); patrz
          komentarz przy regule w site.css. */}
      <div data-section-reveal="stagger" className={styles.container}>
        {children}
      </div>
    </section>
  );
}

/**
 * WARIANTY RESPONSYWNE W TYM PLIKU SĄ KONTENEROWE (`@min-[40rem]/site:`,
 * `@min-[64rem]/site:`), nie viewportowe — patrz `template.ts` i ADR-085.
 * `sm:`/`lg:` reagują na szerokość OKNA, więc płótno kreatora (kontener 390 px
 * w oknie 1440 px) pokazywałoby układ desktopowy ściśnięty do szerokości
 * telefonu. Kontrakt `site-container-contract.test.ts` odrzuca powrót do nich.
 */
function SectionHeading({ heading, styles }: { heading?: string; styles: TemplateStyles }) {
  if (!heading) return null;
  // `bindOrphans` — sieroty (S-47): warstwa renderu, treść najemcy nietknięta.
  return <h2 className={styles.sectionHeading}>{bindOrphans(heading)}</h2>;
}

export function HeroSection({
  content,
  styles,
  siteImageBase,
}: {
  content: HeroContent;
  styles: TemplateStyles;
  siteImageBase?: string;
}) {
  return (
    <section className={styles.heroSection}>
      <div data-section-reveal="stagger" className={styles.container}>
        <h1 className={styles.heroHeading}>{bindOrphans(content.heading)}</h1>
        {content.subheading ? (
          <p className={styles.heroSubheading}>{bindOrphans(content.subheading)}</p>
        ) : null}
        {content.ctaText && content.ctaHref ? (
          <a href={content.ctaHref} rel={externalLinkRel(content.ctaHref)} className={styles.cta}>
            {content.ctaText}
          </a>
        ) : null}
        {content.imagePath && siteImageBase ? (
          // Zdjęcie hero jest DEKORACYJNE (nagłówek niesie treść) — alt puste,
          // eager (element bywa LCP wysoko na stronie). Placeholder gdy brak
          // bazy URL (podgląd bez Storage) — render nie zależy od Storage.
          <img
            src={siteImageUrl(siteImageBase, content.imagePath)}
            alt=""
            className="mt-10 aspect-[16/9] w-full rounded-lg object-cover"
            loading="eager"
            fetchPriority="high"
          />
        ) : null}
      </div>
    </section>
  );
}

export function ProductsSection({
  content,
  products,
  labels,
  styles,
}: {
  content: ProductsContent;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  styles: TemplateStyles;
}) {
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      <ProductCards products={products} labels={labels} styles={styles} />
    </SectionShell>
  );
}

/**
 * SAMA SIATKA KART katalogu, bez powłoki sekcji i bez nagłówka. Wydzielona,
 * bo używają jej DWIE generacje treści: sekcja `products` (v1) i element
 * `catalog` płótna v2 (K2, ADR-084), gdzie nagłówek jest osobnym, ruchomym
 * elementem. Klasy siatki (warianty kontenerowe, ADR-085) zostają TUTAJ.
 */
export function ProductCards({
  products,
  labels,
  styles,
}: {
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  styles: TemplateStyles;
}) {
  return (
    <>
      {products.length === 0 ? (
        <p className="mt-8 site-text-muted">{labels.productsEmpty}</p>
      ) : (
        <ul className={cn(styles.productGrid, "list-none p-0")}>
          {products.map((product, index) => {
            // PIERWSZA karta ładuje się ŁAPCZYWIE (Zadanie 2.7). W szablonie
            // `bold` sekcja produktów wchodzi wysoko, więc to jej zdjęcie bywa
            // elementem LCP — a `loading="lazy"` odkłada je za pierwsze
            // malowanie i psuje pomiar. Pozostałe karty zostają leniwe: leżą
            // pod zgięciem i ich wczesne pobranie tylko zabierałoby pasmo.
            const eager = index === 0;
            const body = (
              <>
                {product.imageUrl ? (
                  // Pakiet UI nie zależy od next/image; storefront serwuje zdjęcia
                  // z publicznego Storage, więc zwykły <img>.
                  <img
                    src={product.imageUrl}
                    alt={product.imageAlt}
                    className="aspect-[4/3] w-full object-cover"
                    loading={eager ? "eager" : "lazy"}
                    fetchPriority={eager ? "high" : undefined}
                  />
                ) : (
                  <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
                )}
                {/* Ciaśniejszy padding w wąskim kontenerze: przy dwóch
                    kolumnach na telefonie karta ma ~160 px, więc 16 px z każdej
                    strony zjadałoby piątą część miary tekstu. */}
                <div className="flex flex-col gap-1 p-3 @min-[40rem]/site:p-4">
                  <h3 className={styles.cardTitle}>{product.name}</h3>
                  <p className={styles.cardPrice}>{product.priceLabel}</p>
                  {/*
                    DOSTĘPNOŚĆ W WYBRANYM TERMINIE (faza 5, ADR-180) — ta sama
                    linia, co na kaflu sekcji strukturalnej. Karta v1 rysuje się
                    dziś w elemencie katalogu płótna v2, więc pominięcie jej
                    tutaj gasiłoby liczby POŁOWIE najemców, bez jednego błędu.
                  */}
                  <SiteProductAvailabilityMark
                    productId={product.id}
                    className="site-availability mt-1"
                  />
                  {product.description ? (
                    <p className="mt-2 line-clamp-3 text-sm site-text-muted">
                      {product.description}
                    </p>
                  ) : null}
                </div>
              </>
            );
            return (
              <li key={product.id} className={styles.card}>
                {/* Link do podstrony produktu tylko na storefroncie publicznym
                    (href obecny); podgląd panelu renderuje kartę statycznie. */}
                {product.href ? (
                  <a href={product.href} className="flex flex-1 flex-col focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {body}
                  </a>
                ) : (
                  body
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/**
 * KATEGORIE — GENERACJA v1 (Faza 7, ADR-259).
 *
 * Sekcja kategorii rodzi się WYŁĄCZNIE jako strukturalna (v3) albo płótno (v2),
 * bo to nowy typ bez historii — kształtu v1 nie zapisze żaden zapis. Ten
 * komponent istnieje dla wyczerpania unii `SectionType` w rendererze (każdy typ
 * ma gałąź) i renderuje SAM nagłówek: kafle kategorii niesie render
 * strukturalny (`categories-grid`), a nie ta droga. Treść v1 nie zna kategorii,
 * więc nie ma tu skąd wziąć kafli — i nie udaje, że ma.
 */
export function CategoriesSection({
  content,
  styles,
}: {
  content: CategoriesContent;
  styles: TemplateStyles;
}) {
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
    </SectionShell>
  );
}

export function PricingSection({
  content,
  styles,
}: {
  content: PricingContent;
  styles: TemplateStyles;
}) {
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      {content.note ? <p className="mt-6 text-base site-text-muted">{content.note}</p> : null}
    </SectionShell>
  );
}

export function FaqSection({ content, styles }: { content: FaqContent; styles: TemplateStyles }) {
  const items = content.items.filter((item) => item.q.trim() !== "");
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      {items.length > 0 ? (
        <div className="mt-8 flex flex-col gap-3">
          {items.map((item, index) => (
            <details key={index} className={styles.faqItem}>
              <summary className={styles.faqQuestion}>{bindOrphans(item.q)}</summary>
              <div className="mt-3 site-text-muted">
                <SafeRichText body={item.a} />
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </SectionShell>
  );
}

export function ContactSection({
  content,
  labels,
  styles,
}: {
  content: ContactContent;
  labels: SiteRenderLabels;
  styles: TemplateStyles;
}) {
  const mapsHref = content.mapQuery
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(content.mapQuery)}`
    : null;
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      <dl className="mt-8 flex flex-col gap-3 text-base">
        {content.email ? (
          <div className="flex gap-2">
            <dt className="font-medium">{labels.contactEmail}</dt>
            <dd>
              <a className="underline" href={`mailto:${content.email}`}>
                {content.email}
              </a>
            </dd>
          </div>
        ) : null}
        {content.phone ? (
          <div className="flex gap-2">
            <dt className="font-medium">{labels.contactPhone}</dt>
            <dd>
              <a className="underline" href={`tel:${content.phone.replace(/\s+/g, "")}`}>
                {content.phone}
              </a>
            </dd>
          </div>
        ) : null}
        {content.address ? (
          <div className="flex gap-2">
            <dt className="font-medium">{labels.contactAddress}</dt>
            <dd className="whitespace-pre-line">{content.address}</dd>
          </div>
        ) : null}
        {mapsHref ? (
          <div>
            <a className="underline" href={mapsHref} target="_blank" rel="noreferrer noopener">
              {labels.contactMap}
            </a>
          </div>
        ) : null}
      </dl>
    </SectionShell>
  );
}

export function FreeformSection({
  content,
  styles,
}: {
  content: FreeformContent;
  styles: TemplateStyles;
}) {
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      <SafeRichText body={content.body} className="mt-6 text-base" />
    </SectionShell>
  );
}

// -----------------------------------------------------------------------
// Sekcje z 0043 (kreator A2, ADR-082) — te same komponenty w obu szablonach.
// -----------------------------------------------------------------------

export function TestimonialsSection({
  content,
  styles,
}: {
  content: TestimonialsContent;
  styles: TemplateStyles;
}) {
  const items = content.items ?? [];
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      {items.length > 0 ? (
        <ul className="mt-8 grid list-none grid-cols-1 gap-6 p-0 @min-[40rem]/site:grid-cols-2">
          {items.map((item, index) => (
            <li key={index} className={styles.subtleCard}>
              <blockquote className="text-lg">{bindOrphans(item.quote)}</blockquote>
              <p className="mt-4 text-sm font-medium">{item.author}</p>
              {item.role ? <p className="site-text-muted text-sm">{item.role}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionShell>
  );
}

export function GallerySection({
  content,
  styles,
  siteImageBase,
}: {
  content: GalleryContent;
  styles: TemplateStyles;
  siteImageBase?: string;
}) {
  const items = content.items ?? [];
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      {items.length > 0 ? (
        <ul className={cn(styles.productGrid, "list-none p-0")}>
          {items.map((item, index) => (
            <li key={index} className="site-card overflow-hidden">
              {siteImageBase ? (
                <img
                  src={siteImageUrl(siteImageBase, item.imagePath)}
                  alt={item.alt}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionShell>
  );
}

export function UspSection({ content, styles }: { content: UspContent; styles: TemplateStyles }) {
  const items = content.items ?? [];
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      {items.length > 0 ? (
        <ul className="mt-10 grid list-none grid-cols-1 gap-8 p-0 @min-[40rem]/site:grid-cols-2 @min-[64rem]/site:grid-cols-3">
          {items.map((item, index) => {
            const Icon = siteIconComponent(item.icon);
            return (
              <li key={index} className="flex flex-col gap-3">
                <span className={styles.iconTile}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{bindOrphans(item.title)}</h3>
                <p className="site-text-muted text-sm">{bindOrphans(item.text)}</p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </SectionShell>
  );
}

export function CtaSection({ content, styles }: { content: CtaContent; styles: TemplateStyles }) {
  return (
    <SectionShell styles={styles}>
      <div className={styles.ctaBanner}>
        <h2 className="text-2xl font-bold tracking-tight break-words @min-[40rem]/site:text-3xl">
          {bindOrphans(content.heading)}
        </h2>
        {content.text ? <p className="mt-3 max-w-2xl opacity-80">{bindOrphans(content.text)}</p> : null}
        <a href={content.buttonHref} rel={externalLinkRel(content.buttonHref)} className={styles.cta}>
          {content.buttonLabel}
        </a>
      </div>
    </SectionShell>
  );
}

export function DirectionsSection({
  content,
  labels,
  styles,
}: {
  content: DirectionsContent;
  labels: SiteRenderLabels;
  styles: TemplateStyles;
}) {
  return (
    <SectionShell styles={styles}>
      <dl className="flex flex-col gap-3 text-base">
        <div className="flex gap-2">
          <dt className="font-medium">{labels.directionsAddress}</dt>
          <dd className="whitespace-pre-line">{content.address}</dd>
        </div>
        {content.hours ? (
          <div className="flex gap-2">
            <dt className="font-medium">{labels.directionsHours}</dt>
            <dd className="whitespace-pre-line">{content.hours}</dd>
          </div>
        ) : null}
        {content.mapsUrl ? (
          <div>
            {/* Tylko LINK do map — bez osadzania obcych skryptów/iframe (ADR-082). */}
            <a className="underline" href={content.mapsUrl} target="_blank" rel="noreferrer noopener">
              {labels.directionsMap}
            </a>
          </div>
        ) : null}
      </dl>
    </SectionShell>
  );
}

/**
 * TELEFON I E-MAIL STOPKI JAKO AKCJE, NIE NAPISY (S-29 audytu 2026-08-25).
 *
 * Stopka jest na większości tras JEDYNYM miejscem z danymi kontaktowymi,
 * a telefon — głównym kanałem domykania rezerwacji w tym biznesie. Napis,
 * którego nie da się tapnąć, każe klientowi przepisywać numer ręcznie.
 *
 * Funkcja rozpoznaje CAŁY napis (po przycięciu), nie fragmenty zdania:
 * treść stopki niesie te dane jako OSOBNE linie/elementy (v1: pola `phone`
 * i `email`; płótno v2: osobne elementy tekstu z konwersji `footerCanvas`),
 * więc dopasowanie całości nie ma jak trafić w „ul. Betonowa 21" ani w notę
 * „© …". Numer normalizujemy do `tel:` bez spacji i interpunkcji (RFC 3966),
 * z zachowanym wiodącym `+`.
 */
const CONTACT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_PHONE = /^\+?[0-9(][0-9\s()-]{5,}$/;

export function siteContactHref(text: string): string | null {
  const value = text.trim();
  if (CONTACT_EMAIL.test(value)) return `mailto:${value}`;
  if (!CONTACT_PHONE.test(value)) return null;
  const normalized = value.replace(/[^\d+]/g, "");
  const digits = normalized.replace(/\D/g, "").length;
  // Poniżej 7 cyfr to nie jest numer, do którego da się zadzwonić (np. kod
  // pocztowy w osobnej linii); powyżej 15 łamie E.164 — zostaje napisem.
  if (digits < 7 || digits > 15) return null;
  return `tel:${normalized}`;
}

/**
 * TA SAMA NAPRAWA DLA STOPKI NA PŁÓTNIE (S-29) — a to jest stopka, którą
 * najemcy MAJĄ: kreator zapisuje każdą sekcję jako płótno v2 (lekcja
 * z `footer-mark.test.tsx`), a `footerCanvas` kładzie telefon i e-mail jako
 * OSOBNE elementy tekstu. Zamiast uczyć render płótna telefonów, treść dostaje
 * RUN Z ADRESEM — dokładnie ten kształt, którym operator sam robi link w tekście
 * (`FormattedText` w element-canvas) — więc render zostaje jeden i głupi.
 *
 * Przekształcenie jest CZYSTE i RENDER-TIME (treść w bazie bez zmian) oraz
 * ZACHOWAWCZE: element z własnymi runami operatora zostaje nietknięty — jego
 * pogrubienia i linki są jego decyzją, nie naszą.
 */
export function linkifyFooterContact(canvas: SectionCanvas): SectionCanvas {
  let changed = false;
  const elements = canvas.elements.map((element) => {
    if (element.kind !== "text") return element;
    if (element.runs && element.runs.length > 0) return element;
    const href = siteContactHref(element.text);
    if (!href) return element;
    changed = true;
    return { ...element, runs: [{ text: element.text, href }] };
  });
  return changed ? { ...canvas, elements } : canvas;
}

/**
 * STOPKA (K6, ADR-092). Znacznik `<footer>`, a nie `<section>` — to nie jest
 * kolejna sekcja treści, tylko ROLA w dokumencie, i czytnik ekranu ma prawo
 * o tym wiedzieć. Stąd własna powłoka zamiast `SectionShell`.
 *
 * Kreska NAD treścią, nie tło pod nią: stopka domyka stronę, a nie otwiera
 * kolejny wątek. Pas (`muted`, `inverted`…) wybiera operator jak w każdej
 * innej sekcji — ta klasa go nie narzuca.
 */
export function FooterSection({
  content,
  styles,
  logo,
  currentPath,
}: {
  content: FooterContent;
  styles: TemplateStyles;
  /**
   * ZNAK FIRMY NAJEMCY (ADR-160) — wchodzi SZWEM, a nie treścią stopki.
   *
   * Gdyby logo siedziało w `footerContentSchema`, byłoby polem SEKCJI, czyli
   * osobną kopią na każdej stronie najemcy — a znak jest jeden. Dlatego wchodzi
   * tą samą drogą, co `siteImageBase`: wstrzykuje go warstwa danych.
   *
   * `null` (albo brak) znaczy „najemca nie ma znaku ALBO zgasił go w stopce"
   * — dwa różne powody, jeden render: stopka wygląda dokładnie tak, jak
   * wyglądała. Placeholdera „tu wstaw logo" na żywym sklepie nie ma.
   */
  logo?: SiteLogoRender | null;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52 audytu 2026-08-25) — odnośnik
   * stopki o tym adresie dostaje `aria-current="page"` i wagę zamiast być
   * klikiem, który przeładowuje tę samą stronę. Brak = bez oznaczeń
   * (powierzchnie podglądu nie mają „bieżącej strony").
   */
  currentPath?: string;
}) {
  /*
    Telefon i e-mail jadą z ADRESEM AKCJI (S-29): `tel:` po normalizacji,
    `mailto:` wprost. Adres i godziny zostają napisami — patrz `siteContactHref`.
  */
  const details = [content.address, content.phone, content.email, content.hours]
    .filter((line): line is string => Boolean(line))
    .map((line) => ({ line, href: siteContactHref(line) }));
  const links = content.links ?? [];
  return (
    <footer className={styles.footer}>
      {/* `block`, nie `stagger`: kontener stopki ma DOKŁADNIE JEDNO dziecko,
          więc kaskada nie miałaby czego kaskadować — udawałaby ruch, którego
          nie ma. Kontrakt pilnuje, że `stagger` dostają tylko pudełka o co
          najmniej dwóch dzieciach. */}
      <div data-section-reveal="block" className={styles.container}>
        <div className={styles.footerInner}>
          <div className="grid gap-8 @min-[40rem]/site:grid-cols-2">
            <div>
              {logo ? (
                // Pudełko o STAŁEJ wysokości (`.site-logo`) — plik o dowolnych
                // proporcjach nie rozpycha stopki i nie robi skoku układu.
                <img className="site-logo mb-4" src={logo.src} alt={logo.alt} />
              ) : null}
              <p className={styles.footerName}>{content.businessName}</p>
              {details.length > 0 ? (
                <ul className="site-text-muted mt-3 list-none space-y-1 p-0 text-sm">
                  {details.map((item, index) => (
                    <li key={index}>
                      {item.href ? (
                        // Kolor dziedziczy z wiersza (przygaszony jak dotąd),
                        // podkreślenie niesie afordancję — wzorzec sekcji
                        // kontaktu wyżej w tym pliku.
                        <a className="underline underline-offset-2" href={item.href}>
                          {item.line}
                        </a>
                      ) : (
                        item.line
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {links.length > 0 ? (
              <nav aria-label={content.businessName}>
                <ul className="list-none space-y-2 p-0 text-sm @min-[40rem]/site:text-right">
                  {links.map((link, index) => (
                    <li key={index}>
                      <a
                        /*
                          Self-link (S-52): waga zamiast podkreślenia, bo
                          `.site-link` jest podkreślony zawsze (site.css).
                        */
                        className={cn(styles.footerLink, "aria-[current=page]:font-semibold")}
                        href={link.href}
                        rel={externalLinkRel(link.href)}
                        aria-current={currentPath && link.href === currentPath ? "page" : undefined}
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ) : null}
          </div>
          <p className="site-text-muted mt-10 text-sm">{content.legal}</p>
        </div>
      </div>
    </footer>
  );
}

/**
 * PAS ZNAKU FIRMY POD PŁÓTNEM STOPKI (ADR-167).
 *
 * Stopka v1 ma dla znaku miejsce z projektu (wyżej, nad nazwą firmy). Stopka na
 * PŁÓTNIE go nie ma i mieć nie może: jej geometria jest ABSOLUTNA, więc każdy
 * prostokąt wskazany wewnątrz siatki albo przykrywa cudzy element, albo zostaje
 * w pustce, którą operator zaprojektował jako pustkę. Dlatego znak dostaje pas
 * w PRZEPŁYWIE, poza siatką — jedyne miejsce w tej sekcji, które nie należy do
 * niczyjego układu.
 *
 * POD siatką, a nie nad nią. Nad siatką znak stanąłby przed KRESKĄ, którą
 * stopka odcina się od poprzedniej sekcji (`footerCanvas` stawia `divider` jako
 * pierwszy element) — czyli wizualnie po stronie treści strony, a nie stopki.
 * Pod siatką jest ostatnią rzeczą w dokumencie i czyta się jako podpis.
 *
 * Pas dzieli z płótnem SUFIT SZEROKOŚCI i PAS TREŚCI, i bierze obie liczby
 * z tych samych stałych rdzenia, z których liczy je siatka — znak wyrównany
 * „na oko" rozjeżdżałby się z kolumną stopki przy każdej zmianie marginesu.
 *
 * `-mt-6` DOMYKA PAS DO TREŚCI STOPKI (S-44 audytu 2026-08-25). Płótno kończy
 * się marginesem `BOTTOM` (10 wierszy siatki, ~80 px przy pasie projektowym),
 * więc znak stawał tak daleko pod notą „© …", że czytał się jako OSOBNY,
 * osierocony pas — a jest podpisem TEJ stopki. Ujemny margines wciąga go
 * w pusty margines płótna (mniejszy niż `BOTTOM` z zapasem, więc nie ma jak
 * najechać na treść siatki) i stopka domyka się jednym rytmem.
 */
export function FooterMark({ logo }: { logo: SiteLogoRender }) {
  return (
    <div data-footer-mark className="mx-auto -mt-6 w-full pb-10" style={{ maxWidth: CANVAS_DESIGN_WIDTH_PX }}>
      {/*
        DWA POZIOMY, A NIE JEDEN — i to jest warunek wyrównania, nie zdobienie.
        Procentowy odstęp rozwiązuje się względem SZEROKOŚCI BLOKU ZAWIERAJĄCEGO,
        a nie własnej. Postawiony na pudełku z `max-width` liczyłby się od
        szerokości stopki (np. 1280 px), a nie od pasa płótna (1152 px) — i znak
        stawał o kilkanaście pikseli na prawo od kolumny, w której stoi nazwa
        firmy. Złapane na zrzucie, bo w drzewie tego nie widać.
      */}
      <div style={{ paddingInline: `${(CANVAS_PAD_COLUMNS / CANVAS_COLUMNS) * 100}%` }}>
        {/* Pudełko o STAŁEJ wysokości (`.site-logo`) — plik o dowolnych
            proporcjach nie rozpycha stopki i nie robi skoku układu. */}
        <img className="site-logo" src={logo.src} alt={logo.alt} />
      </div>
    </div>
  );
}

export function DeliverySection({
  content,
  styles,
}: {
  content: DeliveryContent;
  styles: TemplateStyles;
}) {
  const items = content.items ?? [];
  return (
    <SectionShell styles={styles}>
      <SectionHeading heading={content.heading} styles={styles} />
      <p className={styles.lead}>{bindOrphans(content.text)}</p>
      {items.length > 0 ? (
        <ul className="mt-8 grid list-none grid-cols-1 gap-6 p-0 @min-[40rem]/site:grid-cols-2">
          {items.map((item, index) => (
            <li key={index} className={styles.subtleCard}>
              <h3 className={styles.cardTitle}>{bindOrphans(item.title)}</h3>
              <p className="site-text-muted mt-2 text-sm">{bindOrphans(item.text)}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionShell>
  );
}
