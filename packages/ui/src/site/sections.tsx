import type { UspIcon } from "@avably/core/site";
import {
  BadgeCheck,
  CalendarCheck,
  Clock,
  CreditCard,
  Headphones,
  type LucideIcon,
  MapPin,
  Package,
  ShieldCheck,
  Sparkles,
  Star,
  ThumbsUp,
  Truck,
  Wrench,
} from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";
import { siteImageUrl } from "./image-url";
import { externalLinkRel } from "./links";
import { SafeRichText } from "./rich-text";
import type { TemplateStyles } from "./template";
import type {
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
 * Allowlista ikon USP (ADR-082) → komponenty `lucide`. Zamknięty zbiór lustrem
 * USP_ICONS z core; klucz spoza mapy (nie powinien przejść Zoda) degraduje do
 * neutralnej gwiazdki, więc render nigdy nie pęka na treści.
 */
const USP_ICON_COMPONENTS: Record<UspIcon, LucideIcon> = {
  truck: Truck,
  "shield-check": ShieldCheck,
  clock: Clock,
  "badge-check": BadgeCheck,
  wrench: Wrench,
  headphones: Headphones,
  "map-pin": MapPin,
  "credit-card": CreditCard,
  package: Package,
  "calendar-check": CalendarCheck,
  sparkles: Sparkles,
  "thumbs-up": ThumbsUp,
};

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
      <div className={styles.container}>{children}</div>
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
  return <h2 className={styles.sectionHeading}>{heading}</h2>;
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
      <div className={styles.container}>
        <h1 className={styles.heroHeading}>{content.heading}</h1>
        {content.subheading ? <p className={styles.heroSubheading}>{content.subheading}</p> : null}
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
              <summary className={styles.faqQuestion}>{item.q}</summary>
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
              <blockquote className="text-lg">{item.quote}</blockquote>
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
            const Icon = USP_ICON_COMPONENTS[item.icon] ?? Star;
            return (
              <li key={index} className="flex flex-col gap-3">
                <span className={styles.iconTile}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className="site-text-muted text-sm">{item.text}</p>
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
          {content.heading}
        </h2>
        {content.text ? <p className="mt-3 max-w-2xl opacity-80">{content.text}</p> : null}
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
}: {
  content: FooterContent;
  styles: TemplateStyles;
}) {
  const details = [content.address, content.phone, content.email, content.hours].filter(
    (line): line is string => Boolean(line),
  );
  const links = content.links ?? [];
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerInner}>
          <div className="grid gap-8 @min-[40rem]/site:grid-cols-2">
            <div>
              <p className={styles.footerName}>{content.businessName}</p>
              {details.length > 0 ? (
                <ul className="site-text-muted mt-3 list-none space-y-1 p-0 text-sm">
                  {details.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </div>
            {links.length > 0 ? (
              <nav aria-label={content.businessName}>
                <ul className="list-none space-y-2 p-0 text-sm @min-[40rem]/site:text-right">
                  {links.map((link, index) => (
                    <li key={index}>
                      <a className={styles.footerLink} href={link.href} rel={externalLinkRel(link.href)}>
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
      <p className={styles.lead}>{content.text}</p>
      {items.length > 0 ? (
        <ul className="mt-8 grid list-none grid-cols-1 gap-6 p-0 @min-[40rem]/site:grid-cols-2">
          {items.map((item, index) => (
            <li key={index} className={styles.subtleCard}>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className="site-text-muted mt-2 text-sm">{item.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionShell>
  );
}
