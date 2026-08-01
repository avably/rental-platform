import { Fragment, type ReactNode } from "react";

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
  sectionWrapper,
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
  /**
   * OWIJKA SEKCJI — jedyny szew, przez który kreator (ADR-083) dokłada swoją
   * warstwę edycyjną: obrys, pływający pasek narzędzi, uchwyt przeciągania,
   * miejsce na „+ Dodaj sekcję". Renderer zostaje JEDEN dla sklepu i dla
   * płótna; drugi renderer znaczyłby, że płótno przestaje być dowodem na to,
   * co zobaczy klient, i każdy nowy typ sekcji trzeba by pisać dwa razy.
   *
   * Domyślna owijka to sama KOTWICA `data-section-id` — przezroczysta
   * wizualnie (`styles.page` nie rozstawia dzieci, odstępy niosą same sekcje),
   * a potrzebna, żeby cokolwiek dało się w tym dokumencie znaleźć i przewinąć.
   * Storefront NIE podaje własnej owijki, więc do publicznego renderu nie ma
   * czym wnieść ani jednego elementu edycyjnego (kontrakt w apps/storefront).
   */
  sectionWrapper?: (section: RenderSection, children: ReactNode) => ReactNode;
}) {
  const styles = getTemplateStyles(template);
  const wrap =
    sectionWrapper ??
    ((section: RenderSection, children: ReactNode) => (
      <div data-section-id={section.id}>{children}</div>
    ));

  return (
    // KONTENER ZAPYTAŃ SEKCJI (`site`, ADR-085) — miara, względem której układa
    // się KAŻDA sekcja. Warianty responsywne i skale typografii patrzą odtąd na
    // szerokość TEGO pudełka, a nie okna: w sklepie to praktycznie szerokość
    // strony (render bez zmian), a na płótnie kreatora zwężonym do 390 px —
    // realna szerokość telefonu. Nazwa `site` odcina przyszłe zagnieżdżone
    // kontenery (np. karta z własnym `@container`) od przejęcia zapytań sekcji.
    <div className={cn("@container/site", styles.page, className)}>
      {sections.map((section) => (
        <Fragment key={section.id}>
          {wrap(
            section,
            <SectionSwitch
              section={section}
              products={products}
              labels={labels}
              template={template}
              siteImageBase={siteImageBase}
            />,
          )}
        </Fragment>
      ))}
    </div>
  );
}
