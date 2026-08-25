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
  cartBadge,
  cartCurrent = false,
  nav,
  center,
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
  /** Licznik sztuk — wnosi go WYŁĄCZNIE sklep, bo tylko on ma koszyk. */
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
   * MENU KATEGORII (ADR-247) — slot obok znaku firmy. Wnosi go WYŁĄCZNIE sklep
   * (podgląd szkicu w panelu nie ma katalogu i nie podaje nic), tak samo jak
   * licznik koszyka i pigułkę terminu. Pakiet nie wie, CO w slocie stoi — dostaje
   * gotowy węzeł albo `undefined` i wtedy belka wygląda jak przed ADR-247.
   */
  nav?: ReactNode;
  /**
   * ŚRODEK BELKI (aneks ADR-194) — slot między znakiem a koszykiem. Sklep
   * stawia tu pigułkę terminu; podgląd szkicu nie podaje nic i belka wygląda
   * dokładnie jak przed aneksem. Pakiet nie wie, CO w slocie stoi — tak samo,
   * jak nie zna licznika koszyka.
   *
   * Slot jest WIDOCZNY OD `md` W GÓRĘ: poniżej belka jest za wąska na trzy
   * elementy i sklep pokazuje tę samą treść w wierszu POD belką. Rozjazd robi
   * media query (obie formy stoją w SSR), nie pomiar skryptem — breakpoint
   * musi zostać TEN SAM, co `md:hidden` na wierszu w `StoreTermBar`, inaczej
   * w pasie szerokości między nimi pigułka jest podwójna albo znika.
   */
  center?: ReactNode;
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
    <header className="site-header" data-store-header>
      {/*
        `relative` jest KOTWICĄ panelu menu kategorii na wąskim kontenerze
        (S-01 audytu 2026-08-25): poniżej 40 rem panel rozpina się na
        szerokość TEGO wiersza (`left-0 right-0`), zamiast wystawać poza
        okno z pudełka wyzwalacza. Patrz `StoreCategoryMenu` w storefront.
      */}
      <div className={cn(SITE_CONTAINER, "relative flex items-center justify-between gap-4 py-4")}>
        {/*
          ZNAK I MENU KATEGORII stoją razem na lewej krawędzi (`shrink-0`, żeby
          slot środkowy zwężał się pierwszy). Menu podaje WYŁĄCZNIE sklep — przy
          `interactive={false}` (podgląd) go nie ma, bo trasa panelu nie zna ani
          katalogu, ani adresu kategorii.
        */}
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
          {interactive && nav != null ? nav : null}
        </div>
        {/*
          `flex-1` + `justify-center` środkuje slot w WOLNYM pasie między
          znakiem a koszykiem (skrajne elementy trzymają swoje szerokości),
          `min-w-0` pozwala mu się zwęzić zamiast wypychać koszyk poza ekran.
        */}
        {center != null ? (
          <div className="hidden min-w-0 flex-1 items-center justify-center gap-3 md:flex">
            {center}
          </div>
        ) : null}
        {interactive ? (
          <Anchor
            href={CART_HREF}
            className={cartClassName}
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
