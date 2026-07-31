import { cn } from "../lib/cn";
import {
  ContactSection,
  CtaSection,
  DeliverySection,
  DirectionsSection,
  FaqSection,
  FreeformSection,
  GallerySection,
  HeroSection,
  PricingSection,
  ProductsSection,
  TestimonialsSection,
  UspSection,
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
  directionsAddress: "Adres:",
  directionsHours: "Godziny otwarcia:",
  directionsMap: "Zobacz na mapie",
};

function SectionSwitch({
  section,
  products,
  labels,
  template,
  siteImageBase,
}: {
  section: RenderSection;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  template: SiteTemplate;
  siteImageBase?: string;
}) {
  const styles = getTemplateStyles(template);
  switch (section.type) {
    case "hero":
      return <HeroSection content={section.content} styles={styles} siteImageBase={siteImageBase} />;
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
    case "testimonials":
      return <TestimonialsSection content={section.content} styles={styles} />;
    case "gallery":
      return <GallerySection content={section.content} styles={styles} siteImageBase={siteImageBase} />;
    case "usp":
      return <UspSection content={section.content} styles={styles} />;
    case "cta":
      return <CtaSection content={section.content} styles={styles} />;
    case "directions":
      return <DirectionsSection content={section.content} labels={labels} styles={styles} />;
    case "delivery":
      return <DeliverySection content={section.content} styles={styles} />;
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
  siteImageBase,
}: {
  sections: RenderSection[];
  template: SiteTemplate;
  products?: StorefrontProduct[];
  labels?: SiteRenderLabels;
  className?: string;
  /**
   * Prefiks publicznego URL-a bucketa `site-images` (do bucketa włącznie).
   * Wstrzykiwany przez warstwę danych (storefront/podgląd) — hero i galeria
   * budują z niego adres zdjęcia. Brak = zdjęcia jako placeholder (0043).
   */
  siteImageBase?: string;
}) {
  const styles = getTemplateStyles(template);
  return (
    <div className={cn(styles.page, className)}>
      {sections.map((section) => (
        /*
          Owijka z `data-section-id` (kreator A3): podgląd w panelu przewija
          ramkę do WŁAŚNIE ZAPISANEJ sekcji, a bez kotwicy nie ma czego w tym
          dokumencie szukać. Wizualnie przezroczysta — `styles.page` nie
          rozstawia dzieci (odstępy niosą same sekcje przez `styles.section`),
          więc dodatkowy blok niczego nie przesuwa. Kotwica siedzi w rendererze
          WSPÓLNYM ze storefrontem świadomie: drugi renderer dla podglądu
          znaczyłby, że podgląd przestaje być dowodem na to, co zobaczy klient.
        */
        <div key={section.id} data-section-id={section.id}>
          <SectionSwitch
            section={section}
            products={products}
            labels={labels}
            template={template}
            siteImageBase={siteImageBase}
          />
        </div>
      ))}
    </div>
  );
}
