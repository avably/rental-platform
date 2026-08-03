import {
  DEFAULT_SITE_STYLE,
  isSectionCanvas,
  styleTokensFor,
  themeTokens,
  type CanvasElement,
  type ResolvedSiteStyle,
} from "@avably/core/site";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { SectionCanvasRenderer } from "./element-canvas";
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
import { siteStyles } from "./template";
import type {
  LegacyRenderSection,
  RenderSection,
  SiteRenderLabels,
  StorefrontProduct,
} from "./types";

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

/**
 * DWUTOROWOŚĆ TREŚCI (K2, ADR-084) — jedno rozpoznanie wersji na cały system.
 *
 * Sekcja zapisana od K2 jest PŁÓTNEM z elementami (`version: 2`); sekcje
 * zapisane wcześniej zostają w kształcie v1 i renderują się dotychczasowymi
 * komponentami, dopóki nie przejdzie ich konwersja (plan wygaszenia w ADR-084).
 * Rozstrzyga JEDNA funkcja z `@avably/core/site` — gdyby każde z trzech miejsc
 * (render, edytor, walidacja) pytało „prawie tak samo", rozjazd byłby kwestią
 * czasu, a nie możliwości.
 */
function SectionSwitch({
  section,
  products,
  labels,
  siteImageBase,
  elementWrapper,
}: {
  section: RenderSection;
  products: StorefrontProduct[];
  labels: SiteRenderLabels;
  siteImageBase?: string;
  elementWrapper?: (element: CanvasElement, children: ReactNode) => ReactNode;
}) {
  const styles = siteStyles();

  if (isSectionCanvas(section.content)) {
    // Płótno v2 (K2, ADR-084) — geometria absolutna zamiast układu z typu sekcji.
    return (
      <SectionCanvasRenderer
        canvas={section.content}
        styles={styles}
        products={products}
        labels={labels}
        siteImageBase={siteImageBase}
        elementWrapper={elementWrapper}
      />
    );
  }

  // Jedyne rzutowanie: `isSectionCanvas` wyżej odsiał treść v2, ale zawężenie
  // POLA nie przeżywa przełącznika po `type`, który zawęża CAŁĄ sekcję.
  const legacy = section as LegacyRenderSection;
  switch (legacy.type) {
    case "hero":
      return <HeroSection content={legacy.content} styles={styles} siteImageBase={siteImageBase} />;
    case "products":
      return (
        <ProductsSection content={legacy.content} products={products} labels={labels} styles={styles} />
      );
    case "pricing":
      return <PricingSection content={legacy.content} styles={styles} />;
    case "faq":
      return <FaqSection content={legacy.content} styles={styles} />;
    case "contact":
      return <ContactSection content={legacy.content} labels={labels} styles={styles} />;
    case "freeform":
      return <FreeformSection content={legacy.content} styles={styles} />;
    case "testimonials":
      return <TestimonialsSection content={legacy.content} styles={styles} />;
    case "gallery":
      return <GallerySection content={legacy.content} styles={styles} siteImageBase={siteImageBase} />;
    case "usp":
      return <UspSection content={legacy.content} styles={styles} />;
    case "cta":
      return <CtaSection content={legacy.content} styles={styles} />;
    case "directions":
      return <DirectionsSection content={legacy.content} labels={labels} styles={styles} />;
    case "delivery":
      return <DeliverySection content={legacy.content} styles={styles} />;
    default: {
      // Wyczerpanie unii — nowy typ sekcji bez gałęzi zapali się w typecheck.
      const _exhaustive: never = legacy;
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
  style = DEFAULT_SITE_STYLE,
  products = [],
  labels = DEFAULT_SITE_LABELS,
  className,
  siteImageBase,
  sectionWrapper,
  elementWrapper,
}: {
  sections: RenderSection[];
  /**
   * STYL STRONY (K5, ADR-090) — motyw, akcent i para krojów.
   *
   * JEDYNE wejście wyglądu. Do K5 obok stylu stał osobny props `template`
   * i to ON rozstrzygał o klasach sekcji; od ADR-090 klas jest jeden zestaw,
   * a różnice niesie motyw jako ZMIENNE na korzeniu strony. Props zniknął
   * świadomie: gdyby został, mielibyśmy dwa źródła prawdy o wyglądzie i pytanie
   * „co wygrywa, gdy szablon mówi co innego niż motyw stylu".
   *
   * Wołający czyta styl z `resolveSiteStyle(style, template)` — kolumna
   * `sites.template` wchodzi tam jako FALLBACK strony sprzed ADR-090, więc
   * strona zastana nie zmienia ani jednego piksela.
   *
   * Brak propsu = motyw zastany `classic`, czyli dokładnie to, czym strona
   * była przed wprowadzeniem motywów.
   */
  style?: ResolvedSiteStyle;
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
  /**
   * OWIJKA ELEMENTU płótna v2 (K2, ADR-084) — drugi szew warstwy edycyjnej,
   * o piętro niżej niż `sectionWrapper`. Kreator wnosi przez niego zaznaczenie,
   * osiem uchwytów rozmiaru i nasłuch przeciągania; sklep nie podaje nic i nie
   * ma czym tej warstwy wnieść nawet przypadkiem (kontrakt w apps/storefront).
   *
   * Sekcja jest PIERWSZYM argumentem, bo edytor trzyma szkice per sekcja —
   * bez niej owijka wiedziałaby, KTÓRY element rusza, ale nie GDZIE go zapisać.
   */
  elementWrapper?: (section: RenderSection, element: CanvasElement, children: ReactNode) => ReactNode;
}) {
  const styles = siteStyles();
  const theme = themeTokens(style.theme);
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
    //
    // KORZEŃ NIESIE TEŻ STYL (K5, ADR-090). Zmienne źródłowe akcentu jadą tu
    // jako właściwości niestandardowe, a nie jako kolory na elementach — element
    // z własnym heksem zamroziłby jeden odcień na zawsze i wypadłby spod bramki
    // kontrastu. Klasa `site-root` jest zaczepieniem dla arkusza: to on wybiera
    // z dwóch kompletów źródłowych ten właściwy dla PASA i on nakłada kroje.
    <div
      className={cn("@container/site site-root", styles.page, className)}
      /*
       * Motyw jako DANE także w drzewie: `data-site-theme` jest kotwicą testów
       * i zrzutów, a `data-site-button` jest jedynym przełącznikiem, którego
       * arkusz potrzebuje do wypełnienia przycisku (pełne albo obrys). Gdyby
       * wypełnienie szło klasą z komponentu, kształt przycisku przestałby być
       * własnością motywu, a stałby się własnością kodu.
       */
      data-site-theme={style.theme}
      data-site-button={theme.shape.buttonFill}
      style={{ ...styleTokensFor(style) } as CSSProperties}
    >
      {sections.map((section) => (
        <Fragment key={section.id}>
          {wrap(
            section,
            <SectionSwitch
              section={section}
              products={products}
              labels={labels}
              siteImageBase={siteImageBase}
              elementWrapper={
                elementWrapper
                  ? (element, children) => elementWrapper(section, element, children)
                  : undefined
              }
            />,
          )}
        </Fragment>
      ))}
    </div>
  );
}
