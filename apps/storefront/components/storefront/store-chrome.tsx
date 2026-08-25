/**
 * POWŁOKA CAŁEGO SKLEPU — JEDEN KORZEŃ STRONY NAJEMCY (K6, ADR-092).
 *
 * Do K6 nagłówek sklepu stał jako RODZEŃSTWO renderu strony, czyli POZA
 * `.site-root`. Zmienne motywu żyją na korzeniu, więc nagłówek ich nie widział
 * i brał paletę PANELU: na motywie ciemnym klient dostawał jasny pasek nad
 * czarną stroną, a wybrany szablon „urywał się" pod pierwszym pikselem treści.
 *
 * Powłoka odwraca tę zależność: korzeń jest NAJWYŻEJ, a nagłówek stoi w środku,
 * razem z sekcjami. Dzięki temu chrome sklepu (nagłówek, koszyk, kasa) czerpie
 * kolor z tych samych zmiennych, co strona — bez ani jednej reguły per motyw.
 *
 * Korzeń jest DOKŁADNIE JEDEN na dokument: trasa katalogu woła renderer sekcji
 * z `asRoot={false}`, bo korzeń wystawia już ta powłoka. Dwa korzenie znaczyłyby
 * dwa kontenery zapytań `site` i podwójnie liczoną szerokość responsywności.
 */
import type { PublishedSite, ResolvedSiteStyle } from "@avably/core/site";
import { SiteChrome, StoreShellFooter } from "@avably/ui";
import type { ReactNode } from "react";

import type { CategoryNavItem } from "@/lib/catalog/category-nav";
import { StoreCategoryMenu } from "@/components/storefront/store-category-menu";
import { StoreHeader } from "@/components/storefront/store-header";
import {
  StoreCatalogAvailability,
  StoreTermBar,
  StoreTermPill,
  StoreTermProvider,
  type StoreTermProduct,
} from "@/components/storefront/store-term";
import { shellSections, withAnchorBase, withFooterContactTarget } from "@/lib/site/page-sections";
import type { StoreLogo } from "@/lib/site/store-logo";
import type { StorefrontCopy } from "@/lib/storefront/copy";
import type { StorefrontLocale } from "@/lib/storefront/locale";

/**
 * KONTEKST TERMINU DLA POWŁOKI (faza 5, ADR-179).
 *
 * `null` jest legalną wartością i znaczy „ta trasa NIE SPRZEDAJE" — strona
 * płatności, jej status, dokumenty prawne. Tam pasek terminu byłby
 * kalendarzem nad zamówieniem, które już powstało: interfejs obiecywałby
 * wybór, którego nie ma. To jest ta sama trójstanowość, co przy `site`
 * i `logo` niżej: brak PROPSU legalny nie jest, brak TERMINU — jest.
 */
export interface StoreTermInput {
  /** Katalog najemcy — panel konfliktu nazywa pozycje po imieniu, nie po uuid. */
  products: StoreTermProduct[];
  /**
   * Język NAJEMCY (oś tenancka, nie URL). Na BCP-47 dla `Intl` przelicza go
   * pasek — jedna zamiana w jednym miejscu, zamiast sześciu w trasach.
   */
  locale: StorefrontLocale;
}

/**
 * NAGŁÓWEK CHROME SKLEPU — stała mieszka od ADR-172 w pakiecie UI, razem
 * z kształtem powłoki, którą składa teraz zarówno sklep, jak i podgląd szkicu
 * w panelu. Re-eksport zostaje, bo trasy sklepu piszą nim nazwę najemcy na
 * ekranie „sklep w budowie" — i nie mają powodu wiedzieć, gdzie ta klasa żyje.
 */
export { SITE_HEADING } from "@avably/ui";

export function StoreChrome({
  style,
  copy,
  storeName,
  site,
  logo,
  siteImageBase,
  term,
  categoryNav,
  footerAnchorBase,
  currentPath,
  revealNonce,
  className,
  children,
}: {
  style: ResolvedSiteStyle;
  copy: StorefrontCopy;
  storeName: string;
  /**
   * OPUBLIKOWANA STRONA NAJEMCY — WYMAGANA, nie opcjonalna (faza 0, ADR-154).
   *
   * Powłoka bierze z niej sekcje PRZYPIĘTE (stopkę). `null` jest legalną
   * wartością (sklep w budowie, tenant bez strony) i znaczy „nie ma czego
   * renderować"; brak PROPSU legalny nie jest — nowa trasa sklepu, która by go
   * pominęła, dostawała się z konstrukcji do stanu sprzed fazy 0: strona bez
   * stopki, bez jednego błędu w konsoli. Wymagany props zamienia to
   * przeoczenie w błąd typów.
   */
  site: PublishedSite | null;
  /**
   * ZNAK FIRMY NAJEMCY — WYMAGANY z tego samego powodu, co `site` (ADR-160).
   *
   * `null` jest legalną wartością i znaczy „najemca nie ma znaku" (albo nie
   * opublikował go jeszcze) — sklep wygląda wtedy dokładnie tak, jak wyglądał.
   * Brak PROPSU legalny nie jest: nowa trasa sklepu, która by go pominęła,
   * gasiłaby logo na jednej podstronie i na żadnej innej, bez ani jednego
   * błędu w konsoli. Wymagany props zamienia to przeoczenie w błąd typów.
   *
   * Gotowy adres i gotowy `alt` liczy `storeLogo` — powłoka nie zna ani
   * ścieżki w Storage, ani reguły wyboru tekstu zastępczego.
   */
  logo: StoreLogo | null;
  /**
   * PREFIKS PUBLICZNEGO URL-a ZDJĘĆ SEKCJI — WYMAGANY (ADR-172).
   *
   * Powłoka rysuje stopkę tym samym rendererem, co trasa katalogu, a element
   * obrazu na płótnie bez tego prefiksu rysuje się jako SZARY KAFEL ZASTĘPCZY
   * — na każdej trasie i bez jednego błędu w konsoli. Do ADR-172 powłoka
   * propsu nie podawała wcale; wada była uśpiona wyłącznie dlatego, że żadna
   * stopka najemcy nie miała jeszcze elementu obrazu. Wymagany props zamienia
   * to przeoczenie w błąd typów — tak samo jak `site` i `logo` wyżej.
   */
  siteImageBase: string;
  /**
   * TERMIN NAJMU W POWŁOCE — WYMAGANY, `null` legalny (faza 5, ADR-179).
   *
   * Powłoka rysuje z niego PASEK TERMINU: jedno miejsce w całym sklepie,
   * w którym klient wybiera „kiedy", i jedno, w którym dowiaduje się, że
   * zmiana terminu nie mieści już koszyka. Do ADR-179 kalendarz stał wyłącznie
   * na stronie sprzętu i ustawiał przy tym termin CAŁEGO zamówienia — czyli
   * mówił co innego, niż robił.
   *
   * `null` znaczy „ta trasa nie sprzedaje" (płatność, status, dokumenty).
   * Brak PROPSU legalny nie jest z tego samego powodu, co przy `site`
   * i `logo`: nowa trasa sklepu, która by go pominęła, gasiłaby wybór terminu
   * na jednej podstronie i na żadnej innej, bez ani jednego błędu w konsoli.
   */
  term: StoreTermInput | null;
  /**
   * MENU KATEGORII (ADR-247) — gotowe pozycje wejść do stron kategorii,
   * odfiltrowane z pustych (`categoryNavItems` / `navItemsFromCounts`).
   *
   * Od S-30 (audyt 2026-08-25) podaje je KAŻDA trasa sklepu, nie tylko
   * katalogowe: poza stroną główną nagłówek nie miał ŻADNEJ nawigacji do
   * oferty (PDP, koszyk, kasa, dokumenty — samo logo i koszyk), a warunek
   * „tylko trasy z katalogiem w ręku" był historią przepływu danych, nie
   * decyzją projektową. Trasy bez pełnego katalogu biorą pozycje z wąskiego
   * odczytu `loadCategoryNav` (ADR-266). Pusta lub pominięta = brak
   * wyzwalacza (nie rysujemy „Kategorie" bez ani jednej półki).
   */
  categoryNav?: readonly CategoryNavItem[];
  /**
   * PREFIKS KOTWIC STOPKI dla tras BEZ sekcji strony (patrz `withAnchorBase`).
   * Podaje go `PageShell` — jego użytkownicy to z definicji podstrony, na
   * których `#kontakt` nie ma celu. Trasa katalogu go NIE podaje, bo cele
   * kotwic stoją na niej.
   */
  footerAnchorBase?: string;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52 audytu 2026-08-25) — odnośnik
   * stopki o tym adresie dostaje `aria-current="page"` („Regulamin" na
   * /regulaminie przestaje udawać nawigację). Podaje ją trasa, bo tylko ona
   * zna swój adres; brak = stopka bez oznaczeń.
   */
  currentPath?: string;
  /** Nonce CSP pod skrypt uzbrajający wejście sekcji (ADR-097). */
  revealNonce?: string;
  className?: string;
  children: ReactNode;
}) {
  /*
    „Kontakt" w stopce NIGDY do sekcji CTA (S-38) — cel przepisany PRZED
    rebasem kotwic, żeby `#kontakt` dostał na podstronach prefiks strony
    głównej dokładnie tą samą drogą, co pozostałe kotwice stopki.
  */
  const footer = withFooterContactTarget(shellSections(site), site);
  const shellFooter = footerAnchorBase ? withAnchorBase(footer, footerAnchorBase) : footer;

  // Menu kategorii jest CHROME wyprowadzonym z katalogu, nie treścią sekcji —
  // dlatego składa je powłoka z gotowych pozycji, a nie renderer strony.
  const categoryMenu =
    categoryNav && categoryNav.length > 0 ? (
      <StoreCategoryMenu items={categoryNav} label={copy.nav.categories} />
    ) : undefined;

  // `min-h-screen` na KORZENIU, a nie na treści: powierzchnia motywu ma
  // sięgać dołu okna, inaczej pod krótką stroną (pusty koszyk) prześwituje
  // tło aplikacji i sklep kończy się w połowie ekranu.
  //
  // `flex flex-col` DOMYKA STOPKĘ DO DOŁU OKNA (S-27 audytu 2026-08-25):
  // sam `min-h-screen` rozciągał POWIERZCHNIĘ, ale nie treść, więc na
  // krótkich stronach (pusty koszyk, kasa, regulamin) stopka kończyła się
  // w 2/3 ekranu, a niżej stała pustka w kolorze motywu. Kolumna flex +
  // `mt-auto` na owijce stopki (niżej) spychają ją na dół BEZ rozciągania
  // sekcji — na stronach dłuższych niż okno nic się nie zmienia.
  const shell = "flex min-h-screen flex-col";
  return (
    <SiteChrome
      style={style}
      revealNonce={revealNonce}
      className={className ? `${shell} ${className}` : shell}
    >
      {/*
        PROVIDER OBEJMUJE NAGŁÓWEK, PASEK I TREŚĆ (ADR-179). Pasek terminu
        i widok koszyka muszą widzieć TEN SAM werdykt konfliktu — gdyby każdy
        liczył go u siebie, kasa mogłaby być odblokowana w chwili, w której
        pasek pokazuje konflikt. Jedno pytanie o dostępność na zmianę terminu,
        jedna odpowiedź dla całej strony.
      */}
      <StoreTermProvider>
        {/*
          PIGUŁKA TERMINU W BELCE (aneks ADR-194): na desktopie stoi między
          znakiem a koszykiem (slot `center` nagłówka), na mobile tę samą
          treść pokazuje wiersz w `StoreTermBar` niżej — media query pokazuje
          dokładnie jedno wystąpienie. Trasy bez terminu (płatność, status,
          dokumenty) nie dostają ani slotu, ani wiersza — jak przed aneksem.
        */}
        <StoreHeader
          copy={copy}
          storeName={storeName}
          logo={logo}
          nav={categoryMenu}
          center={term ? <StoreTermPill copy={copy} /> : undefined}
        />
        {term ? <StoreTermBar copy={copy} products={term.products} locale={term.locale} /> : null}
        {/*
          LICZBY NA KAFLE KATALOGU (faza 5, ADR-180) — z tej samej, jednej
          odpowiedzi o dostępność, z której liczy się konflikt koszyka. Most
          stoi w powłoce, bo sekcja sprzętu rysuje się na każdej stronie
          najemcy, a nie tylko na katalogu.
        */}
        <StoreCatalogAvailability copy={copy}>{children}</StoreCatalogAvailability>
      </StoreTermProvider>
      {/*
        STOPKA POWŁOKI (faza 0, ADR-154) — od ADR-172 składa ją pakiet UI, ten
        sam, który składa ją w podglądzie szkicu. Sklep rozstrzyga tu dwie
        rzeczy, których pakiet znać nie ma prawa: PRZEŁĄCZNIK NAJEMCY „pokaż
        znak także w stopce" (ADR-160 — drugiego wgrania pod stopkę nie ma)
        i PREFIKS ZDJĘĆ, bez którego obraz w stopce byłby szarym kaflem.
      */}
      {/* `mt-auto` — druga połowa domknięcia stopki (S-27), patrz `shell` wyżej. */}
      {shellFooter.length > 0 ? (
        <div className="mt-auto">
          <StoreShellFooter
            sections={shellFooter}
            style={style}
            logo={logo?.inFooter ? logo : null}
            siteImageBase={siteImageBase}
            currentPath={currentPath}
          />
        </div>
      ) : null}
    </SiteChrome>
  );
}
