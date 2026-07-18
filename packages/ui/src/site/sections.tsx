import * as React from "react";

import { cn } from "../lib/cn";
import { SafeRichText } from "./rich-text";
import type { TemplateStyles } from "./template";
import type {
  ContactContent,
  FaqContent,
  FreeformContent,
  HeroContent,
  PricingContent,
  ProductsContent,
  SiteRenderLabels,
  StorefrontProduct,
} from "./types";

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

export function HeroSection({ content, styles }: { content: HeroContent; styles: TemplateStyles }) {
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
          {products.map((product) => {
            const body = (
              <>
                {product.imageUrl ? (
                  // Pakiet UI nie zależy od next/image; storefront serwuje zdjęcia
                  // z publicznego Storage, więc zwykły <img> z lazy-loadingiem.
                  <img
                    src={product.imageUrl}
                    alt={product.imageAlt}
                    className="aspect-[4/3] w-full object-cover"
                    loading="lazy"
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
