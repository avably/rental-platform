import { cn } from "../lib/cn";
import {
  ContactSection,
  FaqSection,
  FreeformSection,
  HeroSection,
  PricingSection,
  ProductsSection,
} from "./sections";
import { getTemplateStyles } from "./template";
import type { RenderSection, SiteRenderLabels, SiteTemplate, StorefrontProduct } from "./types";

/** Domyślne etykiety chrome (PL — domyślny język tenanta). Nadpisywalne propsem. */
export const DEFAULT_SITE_LABELS: SiteRenderLabels = {
  productsEmpty: "Katalog jest w przygotowaniu.",
  contactEmail: "E-mail:",
  contactPhone: "Telefon:",
  contactAddress: "Adres:",
  contactMap: "Zobacz na mapie",
};

function SectionSwitch({
  section,
  products,
  labels,
  template,
}: {
  section: RenderSection;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  template: SiteTemplate;
}) {
  const styles = getTemplateStyles(template);
  switch (section.type) {
    case "hero":
      return <HeroSection content={section.content} styles={styles} />;
    case "products":
      return (
        <ProductsSection content={section.content} products={products} labels={labels} styles={styles} />
      );
    case "pricing":
      return <PricingSection content={section.content} styles={styles} />;
    case "faq":
      return <FaqSection content={section.content} styles={styles} />;
    case "contact":
      return <ContactSection content={section.content} labels={labels} styles={styles} />;
    case "freeform":
      return <FreeformSection content={section.content} styles={styles} />;
    default: {
      // Wyczerpanie unii — nowy typ sekcji bez gałęzi zapali się w typecheck.
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

/**
 * Renderuje listę sekcji w wybranym szablonie. Sekcje MUSZĄ być już
 * przefiltrowane (włączone) i posortowane po `position` przez wołającego —
 * storefront oddaje opublikowane (zwrotka getPublishedSite), podgląd panelu
 * oddaje włączony draft. Renderer jest czysto prezentacyjny, więc oba widoki
 * są tym samym kodem; różni je tylko szablon i źródło danych.
 */
export function SiteRenderer({
  sections,
  template,
  products = [],
  labels = DEFAULT_SITE_LABELS,
  className,
}: {
  sections: RenderSection[];
  template: SiteTemplate;
  products?: StorefrontProduct[];
  labels?: SiteRenderLabels;
  className?: string;
}) {
  const styles = getTemplateStyles(template);
  return (
    <div className={cn(styles.page, className)}>
      {sections.map((section) => (
        <SectionSwitch
          key={section.id}
          section={section}
          products={products}
          labels={labels}
          template={template}
        />
      ))}
    </div>
  );
}
