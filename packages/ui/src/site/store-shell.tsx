/**
 * POWŁOKA SKLEPU JAKO JEDEN KSZTAŁT — DLA SKLEPU I DLA PODGLĄDU (ADR-172).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Powłokę sklepu (nagłówek ze znakiem firmy i koszykiem, stopka pod treścią)
 * umiał złożyć WYŁĄCZNIE storefront — `StoreChrome` w apps/storefront. Podgląd
 * szkicu stoi w panelu, a panel nie ma prawa importować z drugiej aplikacji,
 * więc rysował same sekcje strony. Pasek podglądu obiecywał przy tym wprost
 * „Tak strona wygląda po publikacji": obietnica była fałszywa dokładnie tam,
 * gdzie ma być wiarygodna, i w całym panelu nie było ANI JEDNEJ powierzchni
 * pokazującej wgrany znak w nagłówku — czyli w głównym miejscu jego użycia.
 *
 * ==================== ROZSTRZYGNIĘCIE ====================
 *
 * Kształt powłoki schodzi do pakietu UI, tam gdzie od ADR-083 mieszka JEDEN
 * render strony najemcy. Obie powierzchnie składają ten sam nagłówek i tę samą
 * stopkę; różni je wyłącznie to, co do nich wpada:
 *
 *   • SKLEP daje nagłówkowi żywy licznik koszyka i nawigację `next/link`;
 *   • PODGLĄD daje `interactive={false}` — nagłówek stoi, ale nie prowadzi
 *     donikąd, bo trasa panelu nie ma ani koszyka, ani katalogu.
 *
 * Pakiet nie zna ani `StorefrontCopy`, ani `next/link`, ani reguły „czy znak
 * wchodzi do stopki" — wołający podaje gotowe napisy, komponent odnośnika
 * i gotowy znak albo `null`. Tak samo, jak `SiteRenderer` dostaje gotowy adres
 * zdjęcia zamiast ścieżki w Storage.
 */
import type { ResolvedSiteStyle } from "@avably/core/site";
import type { ElementType, ReactNode } from "react";

import { cn } from "../lib/cn";
import { SiteRenderer } from "./site-renderer";
// Wspólna siatka strony najemcy (S-58) — nagłówek mierzy TEN SAM pas, co
// kontener sekcji i pas treści płótna; patrz docblock przy stałej.
import { SITE_CONTAINER } from "./template";
import type { RenderSection, SiteLogoRender } from "./types";

/**
 * NAGŁÓWEK CHROME SKLEPU (h1/h2/legenda/nazwa sklepu).
 *
 * `.site-title` niesie w arkuszu samą WAGĘ — krój nagłówka arkusz nakłada
 * wyłącznie przez klasy skal sekcji (`.landing-*`, `.canvas-type-*`), bo tam
 * „nagłówek" jest już rozpoznany. Chrome sklepu żadnej z tych klas nie ma, więc
 * bez tej deklaracji „Koszyk" byłby pisany krojem tekstu ciągłego, a hero tuż
 * obok — krojem nagłówkowym z tej samej pary. Krój bierzemy ze ZMIENNEJ motywu,
 * nie z nazwy rodziny: para krojów zostaje wyborem najemcy.
 *
 * Stała mieszka w pakiecie, bo od ADR-172 nagłówek sklepu składa się TUTAJ,
 * a storefront re-eksportuje ją dla swoich tras (ekran „sklep w budowie").
 */
export const SITE_HEADING = "site-title font-[family-name:var(--site-font-heading)]";

/**
 * Adres strony głównej i koszyka — te same, do których prowadzi nagłówek
 * sklepu. Znak firmy celuje w KANON (`/`), nie w trasę wewnętrzną `/store`
 * (S-45 audytu 2026-08-25): `/store` jest celem rewrite'u proxy, a jego
 * publiczna odsłona była duplikatem kanonicznym strony głównej.
 */
const HOME_HREF = "/";
const CART_HREF = "/cart";

/**
 * CEL DOTYKOWY BEZ ZMIANY UKŁADU (S-15 audytu 2026-08-25, WCAG 2.5.8).
 *
 * Odnośniki belki są gołym tekstem ~20 px wysokości — poniżej minimum 24 px
 * i daleko od zalecanych 44 px, a belka ma ~63 px zapasu. Padding powiększa
 * obszar klikalny do 44 px, ujemne marginesy oddają dokładnie tę samą
 * przestrzeń w układzie — belka nie zmienia ani piksela wyglądu.
 */
const NAV_HIT_AREA = "-mx-2 -my-3 px-2 py-3";

export function StoreShellHeader({
  storeName,
  logo,
  cartLabel,
  cartAriaLabel,
  cartBadge,
  cartCurrent = false,
  search,
  subnav,
  center,
  sticky = false,
  linkComponent,
  interactive = true,
}: {
  storeName: string;
  /**
   * ZNAK FIRMY NAJEMCY (ADR-160). Gdy jest — ZASTĘPUJE napis z nazwą sklepu,
   * bo to jest sens własnego logo; nazwa nie znika z dokumentu, tylko przenosi
   * się do tekstu zastępczego obrazu. Dwa razy ta sama nazwa obok siebie — raz
   * obrazkiem, raz napisem — byłaby dla czytnika ekranu powtórzeniem.
   */
  logo: SiteLogoRender | null;
  /** Napis przycisku koszyka w języku SKLEPU (oś tenancka), nie panelu. */
  cartLabel: string;
  /**
   * PEŁNA NAZWA DOSTĘPNA odnośnika koszyka (F7) — „Koszyk, 2 pozycje" zamiast
   * gołego „Koszyk", gdy sklep zna licznik. Wnosi ją WOŁAJĄCY razem z badge'em,
   * bo odmiana liczebnika jest sprawą copy sklepu, nie pakietu. Brak = nazwa
   * z widocznego napisu (podgląd szkicu, koszyk pusty).
   */
  cartAriaLabel?: string;
  /** Licznik pozycji — wnosi go WYŁĄCZNIE sklep, bo tylko on ma koszyk. */
  cartBadge?: ReactNode;
  /**
   * CZY ODWIEDZAJĄCY STOI NA `/cart` (S-52 audytu 2026-08-25, WCAG 2.4.8).
   *
   * Self-link bez oznaczenia to klik, który przeładowuje tę samą stronę.
   * `true` znaczy `aria-current="page"` i wyróżnienie (podkreślenie z klasy
   * `aria-[current=page]:`). Rozstrzyga WOŁAJĄCY (sklep zna ścieżkę żądania,
   * pakiet nie) — podgląd szkicu nie podaje nic i belka wygląda jak dotąd.
   */
  cartCurrent?: boolean;
  /**
   * WYSZUKIWANIE W BELCE (F7) — slot między znakiem a pigułką terminu. Wnosi
   * go WYŁĄCZNIE sklep (podgląd szkicu nie ma trasy `/katalog`, więc nie podaje
   * nic — i belka wygląda jak przed F7). Pakiet nie wie, CO w slocie stoi:
   * o formie (pełne pole vs ikona) rozstrzyga wołający per trasa.
   */
  search?: ReactNode;
  /**
   * DRUGI RZĄD NAGŁÓWKA (F7) — listwa kategorii pod belką: poziome odnośniki
   * na szerokim kontenerze, przewijane chipsy na wąskim. Wnosi go WYŁĄCZNIE
   * sklep i tylko na trasach, które listwę mają (poza kasą i koszykiem).
   * Rząd stoi WEWNĄTRZ `<header>`, żeby kleił się razem z belką (sticky).
   */
  subnav?: ReactNode;
  /**
   * ŚRODEK BELKI (aneks ADR-194) — slot między wyszukiwaniem a koszykiem.
   * Sklep stawia tu pigułkę terminu; podgląd szkicu nie podaje nic i belka
   * wygląda dokładnie jak przed aneksem. Pakiet nie wie, CO w slocie stoi —
   * tak samo, jak nie zna licznika koszyka.
   *
   * Slot jest WIDOCZNY OD 48 rem KONTENERA `site` W GÓRĘ (F7 przeniosło próg
   * z viewportowego `md:` na kontenerowy — ADR-085: podgląd w panelu mierzy
   * SWOJĄ szerokość, nie okna). Poniżej belka jest za wąska na cztery elementy
   * i sklep pokazuje tę samą treść w wierszu POD belką. Rozjazd robi zapytanie
   * kontenerowe (obie formy stoją w SSR), nie pomiar skryptem — próg musi
   * zostać TEN SAM, co `@min-[48rem]/site:hidden` na wierszu w `StoreTermBar`,
   * inaczej w pasie szerokości między nimi pigułka jest podwójna albo znika.
   */
  center?: ReactNode;
  /**
   * PRZYKLEJENIE NAGŁÓWKA (F7) — `sticky top-0 z-40`, tło pasa default,
   * a linia `--site-border` u dołu dopiero PO przewinięciu (atrybut
   * `data-store-header-scrolled` stawia sonda sklepu; reguła w site.css).
   *
   * Domyślnie WYŁĄCZONE, bo podgląd szkicu w panelu ma nad sobą WŁASNY
   * przyklejony pasek (`data-preview-bar`, z-50) — drugi sticky pod nim
   * wsuwałby belkę sklepu POD pasek panelu i chował ją przy przewijaniu.
   * Sklep włącza jawnie; podgląd nie podaje nic i wygląda jak dotąd.
   */
  sticky?: boolean;
  /**
   * Komponent odnośnika. Sklep podaje `next/link` (nawigacja bez przeładowania);
   * brak = zwykłe `<a>`. Przy `interactive={false}` nie jest używany wcale.
   */
  linkComponent?: ElementType;
  /**
   * Czy nagłówek PROWADZI dokądkolwiek. Podgląd szkicu podaje `false`: stoi na
   * trasie panelu, gdzie `/cart` i `/store` nie istnieją, więc odnośnik byłby
   * obietnicą bez pokrycia. Napisy i układ zostają bez zmian — różnicę widzi
   * wyłącznie kursor i czytnik ekranu (`aria-disabled`).
   */
  interactive?: boolean;
}) {
  const Anchor: ElementType = linkComponent ?? "a";

  const brand = logo ? (
    // Pudełko o STAŁEJ wysokości (`.site-logo`): plik 3000 × 200 zjedzie do
    // wysokości paska i zatrzyma się na `max-width`, zamiast wypchnąć koszyk
    // poza ekran. Bez wymiarów własnych pliku i bez skoku układu.
    //
    // Gołe `<img>`, a nie `next/image`: adres jest publicznym URL-em bucketa
    // najemcy (jak zdjęcia sekcji obok, ADR-145), a pakiet UI nie zna Next.
    <img className="site-logo" src={logo.src} alt={logo.alt} />
  ) : (
    storeName
  );
  const brandClassName = logo ? "flex items-center" : `text-lg tracking-tight ${SITE_HEADING}`;
  const cartClassName = cn(
    "site-nav-link inline-flex items-center gap-2 text-sm font-medium",
    NAV_HIT_AREA,
    // Wyróżnienie self-linku (S-52) — rysuje się WYŁĄCZNIE przy
    // `aria-current="page"`, więc klasa może stać na stałe. Waga, nie
    // podkreślenie: `.site-nav-link` jest podkreślony ZAWSZE (site.css),
    // więc dodatkowe podkreślenie niczego by nie wyróżniło.
    "aria-[current=page]:font-semibold",
  );

  return (
    <header
      className={cn("site-header", sticky && "sticky top-0 z-40")}
      data-store-header
      {...(sticky ? { "data-store-header-sticky": "" } : {})}
    >
      {/*
        `relative` jest KOTWICĄ paneli belki na wąskim kontenerze (S-01 audytu
        2026-08-25, ta sama technika w F7 dla panelu wyszukiwania): panel
        rozpina się na szerokość TEGO wiersza (`left-0 right-0`), zamiast
        wystawać poza okno z pudełka wyzwalacza. Patrz `StoreHeaderSearch`
        w storefront.
      */}
      <div className={cn(SITE_CONTAINER, "relative flex items-center justify-between gap-3 py-3")}>
        {/* ZNAK na lewej krawędzi (`shrink-0` — slot wyszukiwania zwęża się pierwszy). */}
        <div className="flex shrink-0 items-center gap-4">
          {interactive ? (
            <Anchor href={HOME_HREF} className={brandClassName}>
              {brand}
            </Anchor>
          ) : (
            <span className={brandClassName} data-shell-inert>
              {brand}
            </span>
          )}
        </div>
        {/*
          WYSZUKIWANIE DOMINUJE ŚRODEK BELKI (F7): slot dostaje CAŁY wolny pas
          (`flex-1`), a `min-w-0` pozwala mu się zwęzić zamiast wypychać koszyk
          poza ekran. O formie (pełne pole vs ikona) rozstrzyga treść slotu.
        */}
        {search != null ? <div className="flex min-w-0 flex-1 items-center">{search}</div> : null}
        {/*
          Pigułka terminu trzyma swoją szerokość (`shrink-0`) — przy ciasnym
          pasie zwęża się POLE wyszukiwania, nie fraza terminu (fraza jest
          atomowa, S-10, i ścięta wyglądałaby jak inna data).
        */}
        {center != null ? (
          <div className="hidden shrink-0 items-center gap-3 @min-[48rem]/site:flex">{center}</div>
        ) : null}
        {interactive ? (
          <Anchor
            href={CART_HREF}
            className={cartClassName}
            aria-label={cartAriaLabel}
            aria-current={cartCurrent ? "page" : undefined}
          >
            <span>{cartLabel}</span>
            {cartBadge}
          </Anchor>
        ) : (
          <span className={cartClassName} data-shell-inert aria-disabled="true">
            <span>{cartLabel}</span>
            {cartBadge}
          </span>
        )}
      </div>
      {/*
        DRUGI RZĄD (F7): listwa kategorii. WEWNĄTRZ nagłówka, żeby kleiła się
        razem z belką i żeby linia po przewinięciu stała POD nią, nie nad nią.
      */}
      {subnav != null ? subnav : null}
    </header>
  );
}

export function StoreShellFooter({
  sections,
  style,
  logo,
  siteImageBase,
  labels,
  money,
  currentPath,
}: {
  /**
   * Sekcje POWŁOKI (przypięte do końca dokumentu, dziś stopka) — wybrane przez
   * wołającego, bo to on wie, z KTÓREJ strony je wziąć: sklep i podgląd biorą
   * je ze strony GŁÓWNEJ, także wtedy, gdy rysują podstronę (ADR-154/172).
   */
  sections: RenderSection[];
  style: ResolvedSiteStyle;
  /**
   * JEDNO WGRANIE, DWA MIEJSCA UŻYCIA (ADR-160). Znak jest ten sam, co
   * w nagłówku — drugiego wgrania pod stopkę nie ma. Przełącznik najemcy
   * („pokaż znak także w stopce") rozstrzyga WOŁAJĄCY: dostajemy albo gotowy
   * znak, albo `null`.
   */
  logo: SiteLogoRender | null;
  /**
   * PREFIKS PUBLICZNEGO URL-a ZDJĘĆ SEKCJI — bez niego element obrazu w stopce
   * rysuje się jako szary kafel zastępczy (`element-canvas`), na każdej trasie
   * i bez jednego błędu w konsoli. Do ADR-172 powłoka sklepu go NIE PODAWAŁA:
   * wada była uśpiona wyłącznie dlatego, że żadna stopka na produkcji nie miała
   * jeszcze obrazu. Props jest WYMAGANY, żeby następna powłoka nie mogła go
   * pominąć po cichu.
   */
  siteImageBase: string;
  labels?: Parameters<typeof SiteRenderer>[0]["labels"];
  money?: Parameters<typeof SiteRenderer>[0]["money"];
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52 audytu 2026-08-25) — do oznaczenia
   * self-linków stopki (`aria-current="page"` na odnośniku, którego adres jest
   * tą stroną: „Regulamin" na /regulaminie). Podaje ją trasa, bo tylko ona zna
   * swój adres; brak = stopka bez oznaczeń, jak w podglądzie szkicu.
   */
  currentPath?: string;
}) {
  if (sections.length === 0) return null;

  /*
    TEN SAM renderer i TA SAMA treść, co na stronie katalogu, tylko wywołany
    o piętro wyżej. Drugi renderer stopki znaczyłby drugie źródło prawdy o jej
    wyglądzie, a płótno kreatora przestałoby być dowodem na to, co zobaczy
    klient (ADR-083).

    `asRoot={false}`, bo korzeń wystawia powłoka wyżej — dwa korzenie to dwa
    kontenery zapytań `site` i podwójnie liczona szerokość (ADR-085).

    `anchors`, bo stopka niesie kotwicę `#stopka` z rejestru i jest w tym
    dokumencie JEDNA — dokładnie warunek, pod którym kotwice wolno włączyć.
  */
  return (
    <SiteRenderer
      sections={sections}
      style={style}
      asRoot={false}
      anchors
      footerLogo={logo}
      siteImageBase={siteImageBase}
      {...(labels ? { labels } : {})}
      {...(money ? { money } : {})}
      {...(currentPath ? { currentPath } : {})}
    />
  );
}
