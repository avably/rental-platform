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
import { SafeRichText } from "./rich-text";
import type { TemplateStyles } from "./template";
import type {
  ContactContent,
  CtaContent,
  DeliveryContent,
  DirectionsContent,
  FaqContent,
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
 * Publiczny URL zdjęcia sekcji z bucketa `site-images`. `base` (prefiks do
 * bucketa włącznie) wstrzykuje warstwa danych (storefront/podgląd panelu) —
 * pakiet UI nie zna adresu Supabase. Bez `base` zdjęcia degradują się do
 * placeholderu (jak produkt bez imageUrl), więc render nie zależy od Storage.
 */
function siteImageUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

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
          <a href={content.ctaHref} className={styles.cta}>
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
      {products.length === 0 ? (
        <p className="mt-8 text-muted-foreground">{labels.productsEmpty}</p>
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
                  <div className="aspect-[4/3] w-full bg-muted" aria-hidden="true" />
                )}
                <div className="flex flex-col gap-1 p-4">
                  <h3 className={styles.cardTitle}>{product.name}</h3>
                  <p className={styles.cardPrice}>{product.priceLabel}</p>
                  {product.description ? (
                    <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
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
      {content.note ? <p className="mt-6 text-base text-muted-foreground">{content.note}</p> : null}
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
              <div className="mt-3 text-muted-foreground">
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
        <ul className="mt-8 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={index} className={styles.subtleCard}>
              <blockquote className="text-lg">{item.quote}</blockquote>
              <p className="mt-4 text-sm font-medium">{item.author}</p>
              {item.role ? <p className="text-muted-foreground text-sm">{item.role}</p> : null}
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
            <li key={index} className="overflow-hidden rounded-lg border bg-card">
              {siteImageBase ? (
                <img
                  src={siteImageUrl(siteImageBase, item.imagePath)}
                  alt={item.alt}
                  className="aspect-[4/3] w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="aspect-[4/3] w-full bg-muted" aria-hidden="true" />
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
        <ul className="mt-10 grid list-none grid-cols-1 gap-8 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item, index) => {
            const Icon = USP_ICON_COMPONENTS[item.icon] ?? Star;
            return (
              <li key={index} className="flex flex-col gap-3">
                <span className={styles.iconTile}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className={styles.cardTitle}>{item.title}</h3>
                <p className="text-muted-foreground text-sm">{item.text}</p>
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
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{content.heading}</h2>
        {content.text ? <p className="mt-3 max-w-2xl opacity-80">{content.text}</p> : null}
        <a href={content.buttonHref} className={styles.cta}>
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
        <ul className="mt-8 grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={index} className={styles.subtleCard}>
              <h3 className={styles.cardTitle}>{item.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm">{item.text}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </SectionShell>
  );
}
