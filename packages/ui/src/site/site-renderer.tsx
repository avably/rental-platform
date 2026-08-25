import {
  DEFAULT_SITE_STYLE,
  footerAcceptsMark,
  isSectionCanvas,
  isStructuredSection,
  sectionAnchorIds,
  styleTokensFor,
  themeTokens,
  type CanvasElement,
  type ResolvedSiteStyle,
} from "@avably/core/site";
import { Fragment, type CSSProperties, type ReactNode } from "react";

import { cn } from "../lib/cn";
import { SectionCanvasRenderer } from "./element-canvas";
import {
  CategoriesSection,
  ContactSection,
  CtaSection,
  DeliverySection,
  DirectionsSection,
  FaqSection,
  FooterSection,
  FreeformSection,
  GallerySection,
  HeroSection,
  PricingSection,
  ProductsSection,
  TestimonialsSection,
  UspSection,
} from "./sections";
import { SiteRevealScript } from "./site-reveal-script";
import { structuredRendererFor } from "./structured/registry";
import { siteStyles } from "./template";
import type {
  ContactFormBinding,
  LegacyRenderSection,
  RenderSection,
  SiteLogoRender,
  SiteMoney,
  SiteRenderLabels,
  StorefrontCategory,
  StorefrontProduct,
} from "./types";

/** Domyślne etykiety chrome (PL — domyślny język tenanta). Nadpisywalne propsem. */
export const DEFAULT_SITE_LABELS: SiteRenderLabels = {
  productsEmpty: "Katalog jest w przygotowaniu.",
  categoriesEmpty: "Kategorie są w przygotowaniu.",
  productsCatalog: "Zobacz cały katalog →",
  productsCta: "Sprawdź dostępność",
  contactEmail: "E-mail:",
  contactPhone: "Telefon:",
  contactAddress: "Adres:",
  contactMap: "Zobacz na mapie",
  directionsAddress: "Adres:",
  directionsHours: "Godziny otwarcia:",
  directionsMap: "Zobacz na mapie",
  directionsRoute: "Prowadź",
  directionsChoose: "Pokaż mapę dla:",
  directionsShowMap: "Pokaż mapę",
  directionsMapNotice: "Mapa ładuje się z serwisu zewnętrznego dopiero po kliknięciu.",
  directionsMapTitle: "Mapa: {location}",
  directionsMapPreview: "Mapa otworzy się na opublikowanej stronie.",
  galleryZoom: "Powiększ zdjęcie",
  galleryClose: "Zamknij powiększenie",
  galleryPrev: "Poprzednie zdjęcie",
  galleryNext: "Następne zdjęcie",
  galleryPosition: "Zdjęcie {current} z {total}",
  contactHours: "Godziny otwarcia:",
  pricingFrom: "od",
  pricingUnits: {
    hour: "godzina",
    day: "doba",
    week: "tydzień",
    month: "miesiąc",
    piece: "sztuka",
  },
  pricingCatalog: "Zobacz pełny katalog",
  testimonialsPrev: "Poprzednia opinia",
  testimonialsNext: "Następna opinia",
  contactForm: {
    title: "Napisz do nas",
    name: "Imię",
    email: "E-mail",
    phone: "Telefon",
    message: "Wiadomość",
    submit: "Wyślij wiadomość",
    sending: "Wysyłanie…",
    success: "Dziękujemy - wiadomość dotarła. Odpowiemy na podany adres.",
    privacyNote:
      "Podane dane wykorzystamy wyłącznie do odpowiedzi na tę wiadomość.",
    privacyLink: "Polityka prywatności",
    errors: {
      required: "To pole jest wymagane.",
      invalid: "Sprawdź, czy wpis jest poprawny.",
      tooLong: "Wpis jest za długi.",
      captcha: "Weryfikacja nie powiodła się. Spróbuj jeszcze raz.",
      rateLimited: "Za dużo wiadomości z tego miejsca. Spróbuj później.",
      expired: "Formularz był otwarty zbyt długo. Wyślij wiadomość jeszcze raz.",
      unavailable: "Ten formularz jest chwilowo niedostępny. Skorzystaj z danych kontaktowych obok.",
      server: "Nie udało się wysłać wiadomości. Spróbuj ponownie za chwilę.",
    },
  },
};

/**
 * WALUTA I ZAPIS KWOT DOMYŚLNE (E6) — para do `DEFAULT_SITE_LABELS` i z tego
 * samego powodu: rynek startowy jest polski, więc render bez wstrzykniętej
 * warstwy danych (miniatura szablonu, podgląd presetu w palecie) pokazuje
 * kwoty tak, jak zobaczy je najemca, który niczego nie zmieniał.
 */
export const DEFAULT_SITE_MONEY: SiteMoney = { currency: "PLN", locale: "pl" };

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
  categories,
  record,
  labels,
  money,
  siteImageBase,
  footerLogo,
  contactForm,
  mapEmbed,
  elementWrapper,
}: {
  section: RenderSection;
  products: StorefrontProduct[];
  categories: StorefrontCategory[];
  record?: StorefrontProduct;
  labels: SiteRenderLabels;
  money: SiteMoney;
  siteImageBase?: string;
  footerLogo?: SiteLogoRender | null;
  contactForm?: ContactFormBinding;
  mapEmbed?: boolean;
  elementWrapper?: (element: CanvasElement, children: ReactNode) => ReactNode;
}) {
  const styles = siteStyles();

  if (isStructuredSection(section.content)) {
    /*
     * SEKCJA STRUKTURALNA v3 (E1, ADR-094) — render z REJESTRU pary
     * (typ, układ). Idzie PRZED płótnem, bo jest rozpoznawalna po własnym
     * znaczniku (`v: 3`), a zbiory generacji są rozłączne.
     *
     * Brak komponentu = sekcja POMINIĘTA, nie wywrócona strona. To ta sama
     * zasada, którą `parsePublishedSite` stosuje do sekcji w nieznanym
     * kształcie: opublikowana treść sprzed zmiany rejestru nie może zabrać
     * klientowi całego sklepu. Kompletność rejestru pilnuje osobny kontrakt,
     * więc ta gałąź jest bezpiecznikiem, a nie planem na co dzień.
     *
     * Sekcja strukturalna NIE dostaje `elementWrapper` — nie ma w niej
     * elementów do zaznaczania. Kreator otwiera dla niej szufladę klikiem
     * w całą sekcję (warstwa `sectionWrapper`).
     */
    const Structured = structuredRendererFor(section.content.type, section.content.layout);
    if (!Structured) return null;
    return (
      <Structured
        content={section.content}
        styles={styles}
        siteImageBase={siteImageBase}
        labels={labels}
        money={money}
        products={products}
        categories={categories}
        sectionId={section.id}
        contactForm={contactForm}
        mapEmbed={mapEmbed}
      />
    );
  }

  if (isSectionCanvas(section.content)) {
    /*
     * ZNAK FIRMY W STOPCE NA PŁÓTNIE (ADR-167) — naprawa wady ADR-160.
     *
     * Do tej linii `footerLogo` docierał WYŁĄCZNIE do gałęzi v1 niżej, przy
     * założeniu, że stopka v1 jest jedyną, którą kreator produkuje. Jest
     * odwrotnie: kreator konwertuje każdą dodawaną sekcję na płótno
     * (`sectionCanvasFrom`), więc przełącznik „pokaż znak także w stopce" nie
     * miał ani jednej stopki, na którą mógłby zadziałać.
     *
     * Reguła „czy ta stopka znak przyjmie" jest w RDZENIU, a nie tutaj, bo
     * odpowiada na nią także ekran panelu — a ekran, który mówi co innego niż
     * render, jest tą samą wadą co przełącznik bez skutku, tylko odwróconą.
     */
    const mark =
      section.type === "footer" && footerLogo && footerAcceptsMark(section.content)
        ? footerLogo
        : null;
    // Płótno v2 (K2, ADR-084) — geometria absolutna zamiast układu z typu sekcji.
    return (
      <SectionCanvasRenderer
        canvas={section.content}
        // Stopka jest ROLĄ dokumentu w OBU generacjach treści (K6, ADR-092).
        // Bez tego landmark istniałby wyłącznie dla sekcji zapisanych przed K2,
        // czyli w praktyce dla żadnej.
        as={section.type === "footer" ? "footer" : "section"}
        mark={mark}
        styles={styles}
        products={products}
        record={record}
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
    case "categories":
      return <CategoriesSection content={legacy.content} styles={styles} />;
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
    case "footer":
      return <FooterSection content={legacy.content} styles={styles} logo={footerLogo} />;
    default: {
      // Wyczerpanie unii — nowy typ sekcji bez gałęzi zapali się w typecheck.
      const _exhaustive: never = legacy;
      return _exhaustive;
    }
  }
}

/**
 * Tryb ruchu strony (K6, ADR-092). `auto` = animacje wejścia sterowane osią
 * widoku, o ile motyw je przewiduje i czytelnik ich nie wyłączył; `off` =
 * strona stoi.
 *
 * `off` jest dla POWIERZCHNI EDYCYJNYCH: płótno kreatora i miniatury galerii
 * szablonów. Sekcja, która przenika przy każdym przewinięciu palety, nie jest
 * podglądem strony — jest migotaniem, przez które nie da się nic ustawić.
 */
export type SiteMotionMode = "auto" | "off";

/**
 * KORZEŃ STRONY NAJEMCY (K6, ADR-092) — jedno miejsce, w którym powstają
 * kontener zapytań `site`, klasa `site-root` i komplet zmiennych motywu.
 *
 * Do K6 korzeń rodził się WYŁĄCZNIE wewnątrz {@link SiteRenderer}, więc
 * wszystko, co stało obok sekcji — nagłówek sklepu, koszyk, kasa — leżało poza
 * motywem i brało paletę panelu. Wydzielenie korzenia jest całą różnicą:
 * powłoka sklepu owija się nim raz, a renderer wchodzi do środka bez własnego
 * korzenia (`asRoot={false}`), żeby zmienne i kontener nie dublowały się.
 */
export function SiteChrome({
  style = DEFAULT_SITE_STYLE,
  motion = "auto",
  revealNonce,
  className,
  children,
}: {
  style?: ResolvedSiteStyle;
  motion?: SiteMotionMode;
  /**
   * NONCE CSP POWIERZCHNI, KTÓRA CHCE ANIMACJI WEJŚCIA (ADR-097).
   *
   * Skrypt uzbrajający jest inline i musi wykonać się przed malowaniem, więc
   * potrzebuje nonce'a z nagłówka żądania — a ten znają wyłącznie trasy
   * (sklep, podgląd szkicu), nie pakiet UI. Brak nonce'a znaczy „ta powierzchnia
   * nie animuje" i jest to stan poprawny: płótno kreatora go nie podaje, więc
   * warstwa edycyjna stoi Z KONSTRUKCJI, a nie z uprzejmości wołającego
   * (bramka `motion="off"` z E8 zostaje jako drugi zamek).
   */
  revealNonce?: string;
  className?: string;
  children: ReactNode;
}) {
  const theme = themeTokens(style.theme);
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
    // z kompletów źródłowych ten właściwy dla PASA i on nakłada kroje.
    <div
      className={cn("@container/site site-root", siteStyles().page, className)}
      /*
       * Motyw jako DANE także w drzewie: `data-site-theme` jest kotwicą testów
       * i zrzutów, a `data-site-button` jest jedynym przełącznikiem, którego
       * arkusz potrzebuje do wypełnienia przycisku (pełne albo obrys). Gdyby
       * wypełnienie szło klasą z komponentu, kształt przycisku przestałby być
       * własnością motywu, a stałby się własnością kodu.
       */
      data-site-theme={style.theme}
      data-site-button={theme.shape.buttonFill}
      /*
       * Atrybut pojawia się WYŁĄCZNIE przy wyłączonym ruchu. Strona publiczna
       * nie niesie więc żadnego znacznika trybu — a reguła w arkuszu jest
       * napisana jako `:not([data-site-motion="off"])`, czyli działa domyślnie.
       */
      {...(motion === "off" ? { "data-site-motion": "off" } : {})}
      style={{ ...styleTokensFor(style) } as CSSProperties}
    >
      {/*
       * SKRYPT UZBRAJAJĄCY JAKO PIERWSZE DZIECKO KORZENIA (ADR-097).
       *
       * Miejsce nie jest kosmetyczne: przeglądarka wykonuje skrypt inline,
       * zanim sparsuje to, co stoi niżej w strumieniu, więc stan startowy
       * obowiązuje od pierwszej klatki i treść nie mignie. Ten sam skrypt
       * doładowany później (moduł, `defer`, hydracja) pokazałby sekcje,
       * a potem je schował.
       */}
      {motion !== "off" && revealNonce ? (
        <SiteRevealScript nonce={revealNonce} />
      ) : null}
      {children}
    </div>
  );
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
  categories = [],
  record,
  labels = DEFAULT_SITE_LABELS,
  money = DEFAULT_SITE_MONEY,
  className,
  siteImageBase,
  footerLogo,
  contactForm,
  mapEmbed,
  sectionWrapper,
  elementWrapper,
  asRoot = true,
  motion = "auto",
  revealNonce,
  anchors = false,
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
  /**
   * KATEGORIE NAJEMCY (Faza 7, ADR-259) — dla sekcji „kategorie", tym samym
   * szwem, co `products`. Brak = pusta tablica: sekcja kategorii pokazuje
   * wtedy sam nagłówek, a sekcje bez kategorii ją ignorują.
   */
  categories?: StorefrontCategory[];
  /**
   * KONTEKST REKORDU (faza 3, ADR-163) — pozycja, NA KTÓREJ STOI ta strona.
   *
   * Piąty szew warstwy danych i jedyny, którego wartość zmienia się MIĘDZY
   * WYŚWIETLENIAMI tej samej treści: szablon strony produktu (faza 5) rysuje
   * jedną listę sekcji raz na sprzęt, a różnicę niesie ten props. Element
   * związany z `pageProduct` czyta stąd wartość PRZY RENDERZE — w treści strony
   * zostaje samo wskazanie.
   *
   * Brak = strona nie stoi na żadnym rekordzie (strona główna, treściowa).
   * Wiązanie do rekordu strony wycina wtedy węzeł, zamiast pokazywać cokolwiek.
   */
  record?: StorefrontProduct;
  labels?: SiteRenderLabels;
  /**
   * WALUTA I ZAPIS KWOT (E6, aneks ADR-094) — sekcja cennika niesie kwoty
   * w groszach, a to, W CZYM je pokazać, jest ustawieniem najemcy, nie treścią
   * strony (patrz `SiteMoney`). Brak propsu = wartości domyślne, tak samo jak
   * przy `labels`.
   */
  money?: SiteMoney;
  className?: string;
  /**
   * Prefiks publicznego URL-a bucketa `site-images` (do bucketa włącznie).
   * Wstrzykiwany przez warstwę danych (storefront/podgląd) — hero i galeria
   * budują z niego adres zdjęcia. Brak = zdjęcia jako placeholder (0043).
   */
  siteImageBase?: string;
  /**
   * ZNAK FIRMY NAJEMCY W STOPCE (ADR-160; naprawa ADR-167) — czwarty szew
   * warstwy danych.
   *
   * Logo NIE jest treścią sekcji i celowo nie wchodzi przez `sections`: treść
   * sekcji jest daną STRONY, a najemca ma po fazie 2 wiele stron i dokładnie
   * jeden znak. Wołający decyduje też o przełączniku „pokaż w stopce" —
   * renderer dostaje albo gotowy znak, albo `null`, i nie zna reguły wyboru.
   *
   * Znak dociera do OBU generacji stopki: v1 stawia go nad nazwą firmy, płótno
   * v2 — pasem pod siatką (ADR-167). Do ADR-167 działała wyłącznie pierwsza
   * droga, a produkuje się wyłącznie druga, więc przełącznik był martwy dla
   * każdej realnej stopki. Jedyny kształt, do którego znak dalej NIE wchodzi,
   * to płótno z WŁASNYM obrazem — i to jest jedyna rzecz, o której musi
   * powiedzieć ekran panelu (`footerAcceptsMark` w rdzeniu).
   */
  footerLogo?: SiteLogoRender | null;
  /**
   * SZEW FORMULARZA KONTAKTU (E4, ADR-095) — akcja serwerowa, bilet z chwili
   * renderu i widget CAPTCHY.
   *
   * Trzecia (po `sectionWrapper` i `elementWrapper`) i ostatnia droga, którą do
   * wspólnego renderera wchodzi coś, czego pakiet UI mieć nie może. Różnica
   * wobec tamtych dwóch jest zasadnicza: te wnosi KREATOR, a tę — SKLEP.
   * Kierunek jest odwrócony, bo to sklep ma serwer, tenanta i pocztę; kreator
   * nie podaje nic i dostaje ten sam formularz jako podgląd (`inert`).
   */
  contactForm?: ContactFormBinding;
  /**
   * ZGODA NA OSADZENIE OBCEJ RAMKI (E5, ADR-096) — mapa dojazdu.
   *
   * Druga rzecz (po `contactForm`), którą do wspólnego renderera wnosi SKLEP,
   * a nie kreator, i z tego samego powodu: to sklep ma politykę CSP, która
   * wpuszcza źródło ramki dostawcy map (`maps` w @avably/security). Panel jej
   * nie ma — świadomie, bo powierzchnia edycyjna nie jest miejscem na obce
   * ramki — więc płótno i podgląd szkicu rysują w tym miejscu zdanie zamiast
   * ramki uciętej przez politykę.
   *
   * Brak zgody NIE WYŁĄCZA mechaniki: kafel, wybór punktu i przycisk stoją tak
   * samo, żeby operator widział, co dostanie klient.
   */
  mapEmbed?: boolean;
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
   *
   * Drugą rzeczą, którą owijka domyślna umie nieść, jest KOTWICA DOKUMENTU
   * (`id`) — i tylko na jawne życzenie wołającego (patrz `anchors`).
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
  /**
   * Czy renderer ma wystawić WŁASNY korzeń strony (K6, ADR-092).
   *
   * Domyślnie tak — to jest zachowanie sprzed K6 i wszystkie dotychczasowe
   * wołania (płótno kreatora, podgląd szkicu, galeria) na nim stoją. Powłoka
   * sklepu podaje `false`, bo korzeń wystawia SAMA (`SiteChrome`) — po to,
   * żeby nagłówek i koszyk stały POD nim, a nie obok. Dwa korzenie w jednym
   * drzewie znaczyłyby dwa kontenery `site` i podwójnie liczoną szerokość
   * zapytań kontenerowych.
   */
  asRoot?: boolean;
  /** Tryb ruchu — patrz {@link SiteMotionMode}. Ignorowany przy `asRoot={false}`. */
  motion?: SiteMotionMode;
  /** Nonce CSP pod skrypt uzbrajający wejście sekcji — patrz {@link SiteChrome}. */
  revealNonce?: string;
  /**
   * KOTWICE SEKCJI W DOKUMENCIE — czy owijka niesie `id` (`#produkty`,
   * `#kontakt`), na które od zawsze wskazują przyciski presetów i szablonów
   * (rejestr adresów: `SECTION_ANCHORS` w @avably/core/site).
   *
   * DOMYŚLNIE NIE, i to nie jest ostrożność — to warunek poprawności HTML.
   * Renderer strony bywa montowany po KILKA RAZY w JEDNYM dokumencie:
   * galeria szablonów pokazuje sześć miniatur stron obok siebie, a picker
   * sekcji — po jednym podglądzie na wariant. Gołe `id="produkty"` dałoby tam
   * sześć elementów o tym samym identyfikatorze, czyli dokument, w którym
   * „ta jedna kotwica" nie znaczy już nic (i w którym pierwszy skok kotwicą
   * prowadzi do miniatury w palecie, a nie do sekcji strony).
   *
   * Włącza to więc POWIERZCHNIA, która jest CAŁĄ stroną i występuje w
   * dokumencie raz: opublikowany sklep i podgląd szkicu. Płótno kreatora nie
   * dostaje kotwic świadomie — tam się stronę ustawia, a nie zwiedza, i tak
   * czy inaczej wnosi WŁASNĄ owijkę sekcji (patrz `sectionWrapper` niżej),
   * więc `id` nie miałoby jak w niej stanąć.
   *
   * Kotwice jadą na owijce DOMYŚLNEJ. Wołający z własnym `sectionWrapper` jest
   * z definicji powierzchnią edycyjną, a ta kotwic nie potrzebuje; para
   * `anchors` + własna owijka jest więc bez skutku, a nie po cichu połowiczna.
   */
  anchors?: boolean;
}) {
  /*
   * Mapa liczona RAZ na render, nie per sekcja: „pierwsza sekcja tego typu"
   * jest własnością całej listy, a nie pojedynczego elementu. `null` przy
   * wyłączonych kotwicach zamiast pustej mapy — żeby różnica „powierzchnia
   * bez kotwic" kontra „strona, na której akurat nie ma sekcji" była widoczna
   * w kodzie, a nie tylko w skutku.
   */
  const anchorById = anchors ? sectionAnchorIds(sections) : null;

  const body = sections.map((section) => {
    const content = (
      <SectionSwitch
        section={section}
        products={products}
        categories={categories}
        record={record}
        labels={labels}
        money={money}
        siteImageBase={siteImageBase}
        footerLogo={footerLogo}
        contactForm={contactForm}
        mapEmbed={mapEmbed}
        elementWrapper={
          elementWrapper
            ? (element, children) => elementWrapper(section, element, children)
            : undefined
        }
      />
    );
    const anchor = anchorById?.get(section.id);

    return (
      <Fragment key={section.id}>
        {sectionWrapper ? (
          sectionWrapper(section, content)
        ) : (
          <div data-section-id={section.id} {...(anchor ? { id: anchor } : {})}>
            {content}
          </div>
        )}
      </Fragment>
    );
  });

  if (!asRoot) return <>{body}</>;

  return (
    <SiteChrome style={style} motion={motion} revealNonce={revealNonce} className={className}>
      {body}
    </SiteChrome>
  );
}
