import {
  PRODUCTS_CATALOG_HREF,
  productsCatalogLinkVisible,
  type ProductsStructuredContent,
} from "@avably/core/site";

import { cn } from "../../lib/cn";
import { SiteProductAvailabilityMark } from "../product-availability";
import type { TemplateStyles } from "../template";
import type { SiteRenderLabels, StorefrontProduct, StorefrontProductField } from "../types";

/**
 * WSPÓLNE CZĘŚCI OBU UKŁADÓW SPRZĘTU (E7, aneks ADR-094).
 *
 * Siatka i lista różnią się KSZTAŁTEM POZYCJI i niczym więcej: wybór pozycji,
 * sufit liczby, stan pusty i odnośnik do katalogu są w obu takie same. Gdyby
 * każdy plik układu miał własną kopię wyboru, jedna z dwóch prędzej czy później
 * zgubiłaby warunek odnośnika — a to jest informacja HANDLOWA, nie detal
 * wyglądu: sekcja pokazująca sześć z dwudziestu pozycji i milcząca o reszcie
 * zataja, że reszta istnieje.
 *
 * ZERO HEKSÓW: kolor bierze się z ról motywu przez klasy arkusza (`site-*`).
 */

/**
 * POZYCJE, KTÓRE SEKCJA ODDAJE DO DOKUMENTU.
 *
 * ==================== TRZY ŹRÓDŁA, JEDNO WYJŚCIE ====================
 *
 *   • `catalog` — pierwsze `limit` pozycji katalogu w jego własnej kolejności;
 *   • `picked` — WYŁĄCZNIE wskazane pozycje, w kolejności wskazania (a nie
 *     w kolejności katalogu: skoro operator ustawił je w szufladzie, to jest
 *     jego decyzja, a nie przypadek alfabetu);
 *   • `category` (ADR-254) — pozycje przypisane do JEDNEJ kategorii
 *     (`content.categoryId`), w kolejności katalogu. Filtr czyta `categoryIds`
 *     POZYCJI, więc dopasowanie idzie z tej samej koperty, którą rysuje sklep.
 *
 * ==================== ŹRÓDŁA ROZŁĄCZNE ====================
 *
 * Każde źródło czyta INNE pole treści: `picked` bierze `items`, `category`
 * bierze `categoryId`, `catalog` żadnego. Gałęzie nie mieszają się — kategoria
 * NIE nadpisuje ręcznej listy, a jedynie decyduje, że w tym stanie liczy się
 * `categoryId`. Ręcznie wskazane pozycje przeżywają więc przełączenie na
 * „kategorię" i z powrotem, bo nikt ich nie tyka.
 *
 * KATEGORIA BEZ WSKAZANIA (albo pozycja bez `categoryIds`) nie pasuje do
 * niczego → sekcja pustoszeje. To ten sam uczciwy stan, co pusty katalog:
 * render pokazuje „w przygotowaniu", zamiast zgadywać, którą kategorię chciał
 * operator.
 *
 * ==================== POZYCJA, KTÓREJ JUŻ NIE MA ====================
 *
 * Wskazanie, do którego nie ma dziś produktu (pozycja usunięta albo wyłączona
 * w katalogu), po prostu WYPADA. Alternatywy są dwie i obie gorsze: kafel
 * zastępczy kłamałby o ofercie, a błąd renderu zabrałby klientowi całą stronę
 * przez jedną pozycję skasowaną w panelu. Operator widzi ubytek w podglądzie
 * kreatora, bo płótno czyta ten sam katalog, co sklep.
 */
export function visibleProductsFor(
  content: ProductsStructuredContent,
  products: readonly StorefrontProduct[],
): StorefrontProduct[] {
  let chosen: StorefrontProduct[];
  if (content.source === "picked") {
    chosen = content.items
      .map((item) => products.find((product) => product.id === item.productId))
      .filter((product): product is StorefrontProduct => product !== undefined);
  } else if (content.source === "category") {
    const categoryId = content.categoryId;
    chosen = categoryId
      ? products.filter((product) => (product.categoryIds ?? []).includes(categoryId))
      : [];
  } else {
    chosen = [...products];
  }
  return chosen.slice(0, content.limit);
}

/**
 * ODNOŚNIK DO PEŁNEGO KATALOGU — WARUNEK NA DANYCH, nie przełącznik operatora
 * (uzasadnienie przy `productsCatalogLinkVisible` w rdzeniu).
 *
 * Odnośnik jest LINKIEM, nie przyciskiem akcji: prowadzi do innego widoku tego
 * samego sklepu, a nie uruchamia operacji. Wypełniony akcentem konkurowałby
 * z przyciskiem rezerwacji w katalogu, do którego ma dopiero doprowadzić — ta
 * sama zasada, co przy odnośniku pod cennikiem (E6).
 */
export function ProductsCatalogLink({
  shown,
  catalogSize,
  labels,
}: {
  shown: number;
  catalogSize: number;
  labels: SiteRenderLabels;
}) {
  if (!productsCatalogLinkVisible(shown, catalogSize)) return null;
  return (
    <p className="mt-6">
      <a data-products-catalog href={PRODUCTS_CATALOG_HREF} className="site-link underline">
        {labels.productsCatalog}
      </a>
    </p>
  );
}

/**
 * STAN PUSTY. Katalog w przygotowaniu i wybór wskazujący same nieistniejące
 * pozycje wyglądają dla odwiedzającego tak samo — i tak samo powinny brzmieć:
 * „katalog jest w przygotowaniu" jest zdaniem prawdziwym w obu przypadkach,
 * a „wybrane pozycje zniknęły" byłoby raportem z naszej bazy wystawionym
 * klientowi.
 */
export function ProductsEmpty({ labels }: { labels: SiteRenderLabels }) {
  return (
    <p data-products-empty className="site-text-muted mt-8">
      {labels.productsEmpty}
    </p>
  );
}

/**
 * WSKAZANIE POLA WŁASNEGO → WARTOŚĆ TEJ POZYCJI (faza 1b, ADR-154).
 *
 * ==================== ZAWĘŻENIE, KTÓRE TU STOI ====================
 *
 * Treść sekcji niesie SAM IDENTYFIKATOR definicji, a wartości mieszkają przy
 * POZYCJI KATALOGU. Rozwiązanie wskazania jest więc szukaniem w polach TEGO
 * sprzętu — a nie w żadnym zbiorze globalnym. Konsekwencja jest ta, o którą
 * chodzi: wskazanie pola, którego dany sprzęt nie wypełnił (albo którego
 * najemca w ogóle nie ma), po prostu NIC nie rysuje. Nie ma tu drogi, którą
 * mogłaby wjechać wartość spoza pozycji przekazanej do renderu.
 *
 * `undefined` zamiast pustego napisu, bo wołający rozgałęzia się na „jest
 * wartość / nie ma" — pusty napis w podtytule dałby pusty wiersz o wysokości
 * linii i rozjechałby dolne krawędzie kafli w rzędzie.
 */
export function productFieldOf(
  product: StorefrontProduct,
  fieldId: string | undefined,
): StorefrontProductField | undefined {
  if (!fieldId) return undefined;
  return (product.fields ?? []).find((field) => field.id === fieldId);
}

/**
 * CECHY KAFLA — wskazania rozwiązane W KOLEJNOŚCI OPERATORA.
 *
 * Kolejność bierze się z treści sekcji, a nie z kolejności pól w ustawieniach:
 * operator, który wskazał najpierw „Zasięg", a potem „Waga", ułożył listę
 * cech — i posortowanie jej z powrotem „po ustawieniach" skasowałoby tę pracę
 * bez słowa. Wskazania bez wartości WYPADAJĄ (ta sama zasada, co przy pozycji
 * usuniętej z katalogu): sierocą etykietę bez wartości widać na kaflu jak
 * dziurę, a operator i tak nie ma jak zgadnąć, czego brakuje.
 */
export function productFeaturesOf(
  product: StorefrontProduct,
  fieldIds: readonly string[] | undefined,
): StorefrontProductField[] {
  const rows: StorefrontProductField[] = [];
  for (const fieldId of fieldIds ?? []) {
    const field = productFieldOf(product, fieldId);
    if (field) rows.push(field);
  }
  return rows;
}

/**
 * PODTYTUŁ KAFLA — jedno zdanie pod nazwą, WARTOŚĆ bez etykiety.
 *
 * Bez etykiety świadomie: podtytuł czyta się jak zdanie o sprzęcie („Internet
 * satelitarny bez zasięgu komórkowego"), a „Rodzaj: internet satelitarny" jest
 * wierszem tabeli. Wiersze tabeli są niżej, w cechach — i tam etykieta jest
 * konieczna, bo „50 m" samo z siebie nie znaczy nic.
 */
export function ProductSubtitle({ value }: { value: string }) {
  return (
    <span data-products-subtitle className="site-text-muted text-sm">
      {value}
    </span>
  );
}

/**
 * CECHY POD NAZWĄ — punktory „etykieta: wartość".
 *
 * Etykieta JEST częścią wiersza, bo bez niej wartość bywa nieczytelna: „50 m"
 * nie mówi, czy to zasięg, czy długość węża. Dwukropek jest interpunkcją, a nie
 * tekstem interfejsu — nie ma go po co tłumaczyć i nie ma w nim czego rozjechać
 * między językami sklepu.
 */
export function ProductFeatures({ features }: { features: readonly StorefrontProductField[] }) {
  if (features.length === 0) return null;
  return (
    <ul data-products-features className="site-text-muted mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
      {features.map((feature) => (
        <li key={feature.id} data-products-feature={feature.id}>
          {feature.label}: {feature.value}
        </li>
      ))}
    </ul>
  );
}

/**
 * ETYKIETA PRZYCISKU KAFLA — operatorska albo domyślna CHROME (ADR-245, faza B).
 *
 * ==================== SKĄD SIĘ BIERZE FALLBACK ====================
 *
 * Do fazy B przycisk pojawiał się WYŁĄCZNIE, gdy operator wpisał `ctaLabel`;
 * bez niego kafel prowadził do podstrony pozycji, ale bez ani jednej afordancji,
 * że tam prowadzi. Fallback („Sprawdź dostępność"/„Wypożycz") daje tę afordancję
 * ZAWSZE, gdy jest dokąd prowadzić.
 *
 * ==================== DLACZEGO POD WARUNKIEM `href` ====================
 *
 * Przycisk „Sprawdź dostępność" bez celu jest kłamstwem, a nie zachętą. `href`
 * podaje WYŁĄCZNIE storefront publiczny (warstwa danych, patrz `StorefrontProduct`).
 * Podgląd kreatora i miniatura szablonu `href` nie mają — więc fallback się tam
 * NIE pokazuje, a podgląd zostaje bajt w bajt taki, jak przed fazą B. Operatorska
 * etykieta działa jak dotąd w OBU miejscach (ją operator wpisał świadomie).
 */
export function productCtaLabel(
  content: ProductsStructuredContent,
  product: StorefrontProduct,
  labels: SiteRenderLabels,
): string | undefined {
  if (content.ctaLabel) return content.ctaLabel;
  return product.href ? labels.productsCta : undefined;
}

/**
 * WŁASNY PRZYCISK KAFLA — `span`, nie `a`, i to jest decyzja, nie skrót.
 *
 * Kafel JEST już odnośnikiem do podstrony pozycji (patrz {@link ProductTile}).
 * Odnośnik w odnośniku to niepoprawny HTML, którego przeglądarki „naprawiają"
 * rozbijając drzewo — a wtedy pół kafla przestaje być klikalne i nie widać
 * tego w żadnym teście renderu. Przycisk jest więc AFORDANCJĄ w środku
 * jednego celu kliknięcia: wygląda jak przycisk, prowadzi tam, gdzie cały
 * kafel, i nie dokłada drugiego przystanku dla klawiatury.
 */
export function ProductCta({ label, styles }: { label: string; styles: TemplateStyles }) {
  return (
    <span data-products-cta className={cn(styles.cta, "mt-4 self-start")}>
      {label}
    </span>
  );
}

/**
 * ALT ZDJĘCIA KAFLA — DEKORACYJNY, gdy powtarza widoczną nazwę (a11y, ADR-267).
 *
 * ==================== SKĄD SIĘ BIERZE `imageAlt` ====================
 *
 * `StorefrontProduct.imageAlt` to opis alternatywny operatora (`images[].alt_text`)
 * z FALLBACKIEM na nazwę pozycji — a fallback składa się TĄ SAMĄ nazwą, którą
 * kafel rysuje widocznie w `<span data-products-name>` (projekcje sklepu i panelu:
 * `alt_text ?? product.name` oraz `alt || product.name`). Kontrakt niesie sam
 * napis, więc kafel nie wie, czy dostał opis operatora, czy zjazd na nazwę —
 * ale a11y i tak pyta o co innego: czy alt POWTARZA widoczny obok tekst.
 *
 * ==================== DLACZEGO PORÓWNANIE Z NAZWĄ ====================
 *
 * Gdy `imageAlt` równa się widocznej nazwie (fallback albo operator wpisał samą
 * nazwę), czytnik ogłasza ją DWA RAZY w jednym celu kliknięcia — dokładnie ta
 * sama wada, co dekoracyjny baner kategorii przed ADR-265. Zdjęcie nie niesie
 * wtedy treści poza nazwą, którą już widać, więc znika z drzewa dostępności:
 * `alt=""`. Gdy operator podał opis INNY niż nazwa, alt niesie informację
 * (np. „terminal na trójnogu na plaży") i ZOSTAJE bez zmian.
 *
 * Porównanie stoi tu, w renderze kafla, a nie w projekcji: to warstwa, która
 * WIDZI naraz alt i widoczną nazwę w jednym linku — i tylko ona może orzec
 * o powtórzeniu. Kontrakt danych zostaje bajt w bajt (bez migracji, bez flagi).
 */
export function productImageAlt(product: StorefrontProduct): string {
  return product.imageAlt === product.name ? "" : product.imageAlt;
}

/**
 * KAFEL POZYCJI — zdjęcie, nazwa, cena, opis.
 *
 * Cena przychodzi GOTOWA (`StorefrontProduct.priceLabel`), bo pochodzi
 * z katalogu, czyli spoza treści strony, a warstwa odczytu i tak ją czyta
 * (kontrast z ceną pozycji cennika, która mieszka w treści sekcji — patrz
 * `SiteMoney` w types.ts).
 *
 * PIERWSZY kafel ładuje się ŁAPCZYWIE: sekcja sprzętu wchodzi na stronie wysoko,
 * więc jej pierwsze zdjęcie bywa elementem LCP, a `loading="lazy"` odkłada je
 * za pierwsze malowanie i psuje pomiar. Pozostałe zostają leniwe.
 */
export function ProductTile({
  content,
  product,
  eager,
  styles,
  labels,
  className,
}: {
  /**
   * TREŚĆ SEKCJI — potrzebna kaflowi WYŁĄCZNIE po to, żeby przeczytać
   * WSKAZANIA (podtytuł, cechy) i etykietę przycisku. Ani jedna wartość
   * pokazywana na kaflu z niej nie pochodzi: nazwa, cena i wartości pól
   * własnych przychodzą z katalogu, w `product`.
   */
  content: ProductsStructuredContent;
  product: StorefrontProduct;
  eager: boolean;
  styles: TemplateStyles;
  /**
   * ETYKIETY CHROME RENDERU — kaflowi potrzebna z nich JEDNA: domyślna etykieta
   * przycisku, gdy operator swojej nie wpisał (ADR-245). Patrz {@link productCtaLabel}.
   */
  labels: SiteRenderLabels;
  className?: string;
}) {
  const subtitle = productFieldOf(product, content.subtitleField);
  const features = productFeaturesOf(product, content.featureFields);
  const ctaLabel = productCtaLabel(content, product, labels);

  const body = (
    <>
      {product.imageUrl ? (
        // Pakiet UI nie zależy od `next/image`; zdjęcia idą z publicznego
        // Storage, więc zwykły `<img>` (ta sama zasada, co w sekcji v1).
        <img
          src={product.imageUrl}
          alt={productImageAlt(product)}
          className="aspect-[4/3] w-full object-cover"
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
        />
      ) : (
        <div className="site-placeholder aspect-[4/3] w-full" aria-hidden="true" />
      )}
      <div className="flex flex-col gap-1 p-3 @min-[40rem]/site:p-4">
        <span data-products-name className={styles.cardTitle}>
          {product.name}
        </span>
        {subtitle ? <ProductSubtitle value={subtitle.value} /> : null}
        <span data-products-price className={styles.cardPrice}>
          {product.priceLabel}
        </span>
        {/*
          DOSTĘPNOŚĆ W WYBRANYM TERMINIE (faza 5, ADR-180) — pod ceną, bo to
          jest druga liczba, po którą sięga klient przy wyborze. Bez terminu
          znacznik nie rysuje NICZEGO (patrz product-availability.tsx).

          KLASA STOI TUTAJ, nie w znaczniku: rolę motywu ma widzieć skan źródeł
          komponentów sekcji, a on nie wychodzi poza ten katalog.
        */}
        <SiteProductAvailabilityMark productId={product.id} className="site-availability mt-1" />
        {product.description ? (
          <span className="site-text-muted mt-2 line-clamp-3 text-sm">{product.description}</span>
        ) : null}
        <ProductFeatures features={features} />
        {ctaLabel ? <ProductCta label={ctaLabel} styles={styles} /> : null}
      </div>
    </>
  );

  return (
    <li data-products-item={product.id} className={cn(styles.card, className)}>
      {/*
        Odnośnik do podstrony pozycji istnieje WYŁĄCZNIE w sklepie (warstwa
        danych podaje `href`). Podgląd kreatora dostaje kafel statyczny — edytor
        nie nawiguje do publicznej podstrony, a przypadkowe wyjście z płótna
        wyglądałoby jak awaria panelu.
      */}
      {product.href ? (
        <a href={product.href} className="flex flex-1 flex-col">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}
