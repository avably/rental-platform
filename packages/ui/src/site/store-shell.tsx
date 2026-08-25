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
// Znaki belki ikonowej (F7b) — jeden zestaw dla sklepu i podglądu szkicu.
import { StoreGlyph } from "./store-glyphs";
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
 * CEL DOTYKOWY IKONY BELKI (S-15 audytu 2026-08-25, WCAG 2.5.8; F7b, F12).
 *
 * Do F7b odnośnik koszyka był NAPISEM ~20 px wysokości, a 44 px robił mu
 * padding z ujemnymi marginesami. Od F7b belka jest ikonowa i cel dotykowy
 * jest WYMIAREM pudełka, nie protezą wokół tekstu. Ta sama klasa stoi pod
 * wyzwalaczem kategorii i wyszukiwania w storefroncie: trzy sąsiadujące ikony
 * muszą mieć jeden rytm — i muszą zmieniać się RAZEM, jednym literałem.
 *
 * WYSOKOŚĆ 44 px JEST STAŁA (`h-11`) na każdej szerokości; zmienia się sama
 * szerokość pudełka: 36 px na telefonie, 40 px od 28 rem kontenera, 44 od
 * 40 rem. Powód jest arytmetyczny i pochodzi z F12: trzy ikony po 40 px brały
 * w pasie telefonu (325 px przy oknie 390) 126 px z odstępami — więcej niż
 * pigułka i znak firmy razem. Cel 36 × 44 zostaje z ogromnym zapasem nad
 * minimum WCAG 2.5.8 AA (24 × 24 CSS px), a odzyskane 12 px idzie do znaku
 * firmy — jedynego elementu wiersza, który rośnie z wolnego miejsca.
 *
 * Próg 28 rem jest TEN SAM, na którym pigułka odzyskuje znak kalendarza
 * i szerszy padding: belka gęstnieje i rzednie w jednym miejscu, a nie na
 * trzech progach, które trzeba trzymać w zgodzie.
 */
const ICON_HIT_AREA =
  "inline-flex h-11 w-9 shrink-0 items-center justify-center rounded " +
  "@min-[28rem]/site:w-10 @min-[40rem]/site:w-11";

export function StoreShellHeader({
  storeName,
  logo,
  cartLabel,
  cartAriaLabel,
  cartBadge,
  cartCurrent = false,
  search,
  nav,
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
  /**
   * NAZWA KOSZYKA w języku SKLEPU (oś tenancka), nie panelu.
   *
   * Od F7b koszyk jest IKONĄ, więc ten napis nie jest już etykietą obok znaku
   * — jest jedyną nazwą kontrolki. Stoi w drzewie jako tekst `sr-only`, a nie
   * jako `aria-label`: tekst zostaje w dokumencie także wtedy, gdy czytnik
   * ekranu nie wspiera `aria-label` na tym elemencie (podgląd szkicu rysuje
   * koszyk jako `span`, nie odnośnik).
   */
  cartLabel: string;
  /**
   * PEŁNA NAZWA DOSTĘPNA odnośnika koszyka (F7) — „Koszyk, 2 pozycje" zamiast
   * gołego „Koszyk", gdy sklep zna licznik. Wnosi ją WOŁAJĄCY razem z badge'em,
   * bo odmiana liczebnika jest sprawą copy sklepu, nie pakietu. Brak = nazwa
   * z tekstu `sr-only` (podgląd szkicu, koszyk pusty).
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
   * WYSZUKIWANIE W BELCE (F7; od F7b WYŁĄCZNIE ikona) — slot w prawej grupie
   * kontrolek. Wnosi go WYŁĄCZNIE sklep (podgląd szkicu nie ma trasy
   * `/katalog`, więc nie podaje nic — i belka wygląda jak przed F7). Pakiet
   * nie wie, CO w slocie stoi: pełnoszerokie pole rozwija się POD belką
   * z wyzwalacza, a kotwicą tego panelu jest `relative` na wierszu niżej.
   */
  search?: ReactNode;
  /**
   * NAWIGACJA KATEGORII (F7b) — wyzwalacz rozwijanej listy półek, PIERWSZY
   * w prawej grupie kontrolek.
   *
   * Do F7b był to DRUGI RZĄD belki (`subnav`): pozioma listwa odnośników plus
   * przewijane chipsy na telefonie. Właściciel po obejrzeniu F7 na produkcji
   * zdjął obie formy („w belce tylko ikony") — listwa i chipsy przeniosły się
   * do TREŚCI listingu (kolumna kategorii na `/katalog` i `/kategoria/*`),
   * gdzie mają miejsce i kontekst. Stąd zmiana nazwy slotu: nie ma już drugiego
   * rzędu, jest jedna kontrolka w belce.
   */
  nav?: ReactNode;
  /**
   * PIGUŁKA TERMINU (aneks ADR-194; od F7b JEDYNY tekst belki) — slot między
   * wyszukiwaniem a koszykiem. Sklep stawia tu pigułkę; podgląd szkicu nie
   * podaje nic i belka wygląda dokładnie jak przed aneksem. Pakiet nie wie,
   * CO w slocie stoi — tak samo, jak nie zna licznika koszyka.
   *
   * Slot jest WIDOCZNY NA KAŻDEJ SZEROKOŚCI (F7b). Do F7b pokazywał go dopiero
   * kontener 48 rem, a poniżej tę samą treść niósł osobny wiersz POD belką —
   * dwa wystąpienia jednej pigułki i dwa progi, które musiały się zgadzać co do
   * jednostki. Belka ikonowa ma miejsce na cztery kontrolki także na telefonie
   * (3 × 44 px ikony + pigułka z `max-w`), więc wiersz zniknął razem z progiem.
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
  /*
    Nazwa najemcy o STOPIEŃ MNIEJSZA na wąskim kontenerze (F7b): w belce
    ikonowej znak dzieli pas z trzema ikonami i pigułką, więc przy 16 px
    w tym samym miejscu mieści się o dwa–trzy znaki więcej niż przy 18 px.
    Od 40 rem kontenera wraca skala poprzednia — tam pasa nie brakuje.
  */
  const brandClassName = logo
    ? "flex items-center"
    : `text-base tracking-tight @min-[40rem]/site:text-lg ${SITE_HEADING}`;
  const cartClassName = cn(
    /*
      `.site-menu-link`, a nie `.site-nav-link` (F7b): odnośnik-IKONA nie jest
      odnośnikiem w zdaniu, więc podkreślenie z `.site-nav-link` rysowałoby
      kreskę pod znakiem koszyka. Ta sama rola, co pozostałe kontrolki belki.
    */
    "site-menu-link relative",
    ICON_HIT_AREA,
    /*
      Wyróżnienie self-linku (S-52) — rysuje się WYŁĄCZNIE przy
      `aria-current="page"`, więc klasa może stać na stałe. Od F7b nośnikiem
      jest KOLOR AKCENTU, nie waga: pod ikoną nie ma tekstu, który mógłby
      zgrubieć. (Kolor nie jest tu jedynym nośnikiem stanu — niesie go też
      `aria-current` dla czytnika ekranu; WCAG 1.4.1 dotyczy INFORMACJI, a ta
      jest w drzewie dostępności.)
    */
    "aria-[current=page]:text-[color:var(--site-accent-text)]",
  );
  /*
    NAZWA KOSZYKA BEZ WIDOCZNEGO NAPISU (F7b). `sr-only` zostaje w drzewie
    zawsze; `aria-label` DOKŁADA licznik, gdy sklep go zna („Koszyk, 2
    pozycje"). Kolejność jest rozmyślna: bez licznika nazwa pochodzi z tekstu,
    czyli z tego samego źródła, co w podglądzie szkicu.
  */
  const cartBody = (
    <>
      <StoreGlyph name="cart" className="h-5 w-5" />
      <span className="sr-only">{cartLabel}</span>
      {cartBadge}
    </>
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
      <div className={cn(SITE_CONTAINER, "relative flex items-center justify-between gap-2 py-3")}>
        {/*
          ZNAK NA LEWEJ KRAWĘDZI — i to ON oddaje szerokość, gdy belki brakuje
          (F7b). Do belki ikonowej znak był `shrink-0`, bo zwężało się pole
          wyszukiwania obok; pola nie ma, a trzy ikony mają twardy wymiar, więc
          jedynym elastycznym elementem został znak. Zmierzone przy oknie
          360 px: nazwa najemcy „Wypożyczalnia …" chce 153 px, a do rozdania
          jest 174 — bez zwężenia belka wyjeżdżała poza dokument. `truncate`
          ścina nazwę wielokropkiem; znak graficzny trzyma proporcje
          (`.site-logo` ma `max-width: min(12rem, 100%)`).

          ==================== DLACZEGO ZNAK BYŁ MALUTKI (F12) ====================

          Właściciel zobaczył na telefonie znak firmy „mały w pizdu" i to NIE
          była zmiana w samym znaku: `.site-logo` ma wysokość 2,25 rem od
          ADR-160 i nikt jej nie ruszał. Zmieniło się otoczenie. Znak jest
          `object-fit: contain` w pudełku o stałej wysokości i szerokości
          ODDANEJ przez flexa — więc gdy plik jest szeroki (typowy znak
          wypożyczalni ma proporcje 3:1 i szersze), o wysokości RYSOWANIA
          decyduje szerokość slotu, nie deklarowane 36 px. Slot zaś kurczył
          się z każdą kontrolką dokładaną do belki: po F7b pigułka terminu
          brała twarde 9 rem (144 px) NA KAŻDEJ szerokości, więc przy oknie
          390 px na znak zostawało ~80 px — czyli 20 px wysokości przy
          proporcji 4:1.

          Naprawa nie leży tutaj i celowo: pudełko znaku jest w porządku,
          niedobre było rozdanie pasa. F12 zdejmuje pigułce sufit i uczy ją
          zwijać człony (patrz `StoreTermPill`), a odzyskane piksele trafiają
          w to miejsce SAME — bo to jest jedyny element wiersza, który rośnie
          z wolnego miejsca.
        */}
        <div className="flex min-w-0 shrink items-center gap-4">
          {interactive ? (
            /*
              `min-w-0` NA SAMYM ODNOŚNIKU, nie tylko na jego pudełku: element
              flex ma domyślnie `min-width: auto`, więc bez tego `truncate`
              nie ma jak zadziałać — nazwa najemcy trzyma swoją pełną szerokość
              i to BELKA wyjeżdża poza dokument (zmierzone: 396 px przy oknie
              360). Ta sama pułapka, co przy polach formularza w kasie.
            */
            <Anchor href={HOME_HREF} className={cn(brandClassName, "min-w-0 truncate")}>
              {brand}
            </Anchor>
          ) : (
            <span className={cn(brandClassName, "min-w-0 truncate")} data-shell-inert>
              {brand}
            </span>
          )}
        </div>
        {/*
          PRAWA GRUPA KONTROLEK (F7b): kategorie, szukaj, termin, koszyk —
          w tej kolejności, od nawigacji po zamówienie. Grupa jest jedna na
          KAŻDEJ szerokości (koniec wariantów „desktop/mobile" z F7).

          `min-w-0` na grupie i `ml-auto`: to pigułka terminu zwęża się przy
          ciasnym pasie (ma `max-w` i truncate — patrz `StoreTermPill`), a nie
          ikony, które są kwadratami 44 px.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-0.5 @min-[40rem]/site:gap-1">
          {/*
            KAŻDY SLOT W SWOIM PUDEŁKU — nie dla wyglądu, tylko dla granicy
            serwer→klient. Sloty tworzy `StoreChrome` (komponent SERWEROWY),
            a rysuje je ta belka, która jest już w pakiecie klienta; elementy
            wstawione WPROST obok siebie React widzi wtedy jako listę bez
            kluczy i wypisuje ostrzeżenie w konsoli sklepu przy każdym wejściu
            (zmierzone: „Each child in a list should have a unique key" na
            każdej trasie). Własne pudełko robi z każdego slotu POJEDYNCZE
            dziecko utworzone TUTAJ — ostrzeżenie znika, a układ zostaje ten
            sam: pudełka są `flex` o zerowej własnej geometrii.
          */}
          {nav != null ? <div className="flex shrink-0 items-center">{nav}</div> : null}
          {search != null ? <div className="flex shrink-0 items-center">{search}</div> : null}
          {center != null ? <div className="flex shrink-0 items-center">{center}</div> : null}
          {interactive ? (
            <Anchor
              href={CART_HREF}
              className={cartClassName}
              aria-label={cartAriaLabel}
              aria-current={cartCurrent ? "page" : undefined}
            >
              {cartBody}
            </Anchor>
          ) : (
            <span className={cartClassName} data-shell-inert aria-disabled="true">
              {cartBody}
            </span>
          )}
        </div>
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
