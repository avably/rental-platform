/**
 * LISTWA KATEGORII W NAGŁÓWKU SKLEPU (F7; poprzednio rozwijane menu ADR-247).
 *
 * ==================== OD DROPDOWNU DO LISTWY ====================
 *
 * Do F7 kategorie mieszkały w rozwijanym menu przy znaku firmy — klient
 * NIE WIDZIAŁ oferty, dopóki nie kliknął „Kategorie". Wniosek z benchmarku
 * właścicielskiego (spec 2026-08-25, pkt 1): kategorie jako DRUGI RZĄD
 * nagłówka — widoczne od pierwszego piksela, bez żadnego kliknięcia:
 *
 *   • kontener ≥ 48 rem: pozioma listwa odnośników (44 px), bieżąca kategoria
 *     z akcentem i `aria-current="page"`, na końcu „Cały katalog"; przy > 8
 *     kategoriach nadmiar chowa się w „Więcej ▾" (natywny `<details>`, panel
 *     klampowany do kontenera — technika S-01);
 *   • kontener < 48 rem (tylko trasy katalogowe): przewijane poziomo CHIPSY
 *     (44 px, scroll-snap, bez widocznego paska przewijania).
 *
 * Obie formy stoją w SSR; widoczną wybiera zapytanie KONTENEROWE
 * `@min-[48rem]/site:` (ADR-085) — podgląd i wąskie konteksty mierzą własną
 * szerokość, nie okno. Ten sam próg, co pełne pole wyszukiwania w belce.
 *
 * ==================== DLACZEGO `<details>` DLA „WIĘCEJ" ====================
 *
 * Te same powody, co przy menu ADR-247: trasa bywa statyczna, CSP bez
 * `unsafe-inline`, a natywny element daje `aria-expanded`, klawiaturę i stan
 * otwarcia bez linijki skryptu. Panel w warstwie `absolute` (otwarcie nie
 * przesuwa listwy); rozdział powierzchni robi obrys karty, nie cień.
 *
 * Znacznik `data-store-category-menu` ZOSTAJE na korzeniu — to na nim wiszą
 * kontrakty tras („nawigacja do oferty stoi na każdej trasie", S-30) i one
 * pilnują LISTWY dokładnie tak, jak pilnowały menu.
 *
 * KOMPONENT JEST GŁUPI: dostaje gotowe pozycje i napisy, nie zna katalogu.
 * Regułę „które kategorie" (guard pustych) trzyma `categoryNavItems`.
 */
import { CATALOG_PATH_SEGMENT } from "@avably/core";
import { cn, SITE_CONTAINER } from "@avably/ui";
import Link from "next/link";

import type { CategoryNavItem } from "@/lib/catalog/category-nav";

/**
 * PRÓG ISTNIENIA „WIĘCEJ" (spec F7: „> 8 kategorii → nadmiar w Więcej").
 * Do ośmiu kategorii listwa pokazuje wszystkie wprost — wyzwalacz bez
 * nadmiaru obiecywałby panel, w którym nie ma nic.
 */
const MAX_INLINE = 8;

/**
 * ILE ODNOŚNIKÓW STOI WPROST, GDY „WIĘCEJ" JUŻ JEST — świadome odstępstwo
 * od literalnego „nadmiar ponad 8": zmierzony rząd 8 pozycji + „Więcej ▾"
 * + „Cały katalog" NIE mieści się w kolumnie 60 rem (sufit SITE_CONTAINER)
 * i łamał listwę w dwa wiersze, spychając „Cały katalog" do sieroty pod
 * spodem (zrzut w raporcie F7). Sześć wprost + wyzwalacz + katalog mieszczą
 * się z zapasem; cel spec-u — jedna czysta listwa jak w benchmarku —
 * wygrywa z liczbą w nawiasie.
 */
const INLINE_WITH_MORE = 6;

/**
 * Odnośnik listwy: 44 px celu dotykowego (S-15 — text-sm 20 px + 2×12 px
 * paddingu), bieżąca kategoria akcentem i wagą (aria-current, WCAG 2.4.8).
 */
const BAR_LINK =
  "site-menu-link inline-flex items-center whitespace-nowrap rounded px-3 py-3 text-sm " +
  "aria-[current=page]:font-semibold aria-[current=page]:text-[color:var(--site-accent-text)]";

/**
 * Chips mobilny: 44 px wysokości (h-11), pastylka z obrysem `--site-border`;
 * bieżąca kategoria dostaje obrys akcentu i wagę — kolor nie jest jedynym
 * nośnikiem stanu.
 */
const CHIP_LINK =
  "site-menu-link inline-flex h-11 shrink-0 snap-start items-center whitespace-nowrap " +
  "rounded-full border border-[color:var(--site-border)] px-4 text-sm " +
  "aria-[current=page]:font-semibold aria-[current=page]:border-[color:var(--site-accent)]";

function currentFor(href: string, currentPath?: string): "page" | undefined {
  return currentPath !== undefined && currentPath === href ? "page" : undefined;
}

export function StoreCategoryMenu({
  items,
  label,
  allCatalogLabel,
  moreLabel,
  currentPath,
  chips = false,
}: {
  items: readonly CategoryNavItem[];
  /** Etykieta dostępna listwy w języku SKLEPU (oś tenancka), np. „Kategorie". */
  label: string;
  /** Napis odnośnika do pełnego katalogu („Cały katalog") — zawsze na końcu. */
  allCatalogLabel: string;
  /** Napis wyzwalacza nadmiaru („Więcej") — tylko przy > 8 kategoriach. */
  moreLabel: string;
  /**
   * PUBLICZNA ŚCIEŻKA BIEŻĄCEJ STRONY (S-52) — odnośnik o tym adresie dostaje
   * `aria-current="page"`. Podaje ją trasa (tylko ona zna swój adres);
   * brak = listwa bez oznaczeń, jak stopka.
   */
  currentPath?: string;
  /**
   * CHIPSY NA WĄSKIM KONTENERZE — tylko trasy KATALOGOWE (spec F7 pkt 3).
   * Strony treściowe (dokumenty, podstrony) mają listwę od 48 rem, ale nie
   * dokładają rzędu na telefonie: tam kategorie nie są głównym zadaniem.
   */
  chips?: boolean;
}) {
  // Bez pozycji nie ma listwy: pusty rząd obiecywałby nawigację, której nie ma.
  // Guard stoi też w wołającym (powłoka nie renderuje komponentu dla pustej
  // listy), ale i tutaj — komponent poprawny sam w sobie nie zależy od tego,
  // że ktoś go nie zawołał na próżno.
  if (items.length === 0) return null;

  const catalogHref = `/${CATALOG_PATH_SEGMENT}`;
  // „Więcej" istnieje od DZIEWIĄTEJ kategorii (spec); gdy istnieje, wprost
  // stoi sześć pozycji — patrz `INLINE_WITH_MORE` wyżej.
  const cut = items.length > MAX_INLINE ? INLINE_WITH_MORE : items.length;
  const inline = items.slice(0, cut);
  const overflow = items.slice(cut);

  return (
    <nav aria-label={label} data-store-category-menu>
      {/*
        LISTWA (kontener ≥ 48 rem). `relative` jest kotwicą panelu „Więcej"
        poniżej 64 rem (technika S-01): panel rozpina się na szerokość TEGO
        wiersza, zamiast wystawać poza okno z pudełka wyzwalacza.
      */}
      <div
        data-store-category-bar
        className={cn(
          SITE_CONTAINER,
          "relative hidden flex-wrap items-center gap-x-1 pb-1 @min-[48rem]/site:flex",
        )}
      >
        {inline.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className={BAR_LINK}
            aria-current={currentFor(item.href, currentPath)}
          >
            {item.name}
          </Link>
        ))}
        {overflow.length > 0 ? (
          <details
            data-store-category-more
            className="group static @min-[64rem]/site:relative"
          >
            <summary
              className="site-menu-link inline-flex cursor-pointer list-none items-center gap-1 whitespace-nowrap rounded px-3 py-3 text-sm [&::-webkit-details-marker]:hidden"
            >
              <span>{moreLabel}</span>
              {/* Strzałka obraca się przy otwarciu — czysto dekoracyjna. */}
              <svg
                className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </summary>
            {/*
              KLAMP PANELU (spec F7: „panel clampowany do viewportu"):
              pionowo `max-h` + przewijanie; poziomo poniżej 64 rem panel
              rozpina się `left-0 right-0` na szerokość wiersza listwy
              (kotwica wyżej), od 64 rem wraca stała szerokość przy
              wyzwalaczu — dokładnie mechanika S-01 z menu ADR-247.
            */}
            <div className="site-card absolute left-0 right-0 top-full z-30 mt-1 max-h-[60vh] overflow-auto p-1 @min-[64rem]/site:left-auto @min-[64rem]/site:right-0 @min-[64rem]/site:w-56">
              <ul className="flex list-none flex-col">
                {overflow.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="site-menu-link block rounded px-3 py-3 text-sm aria-[current=page]:font-semibold"
                      aria-current={currentFor(item.href, currentPath)}
                    >
                      {item.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        ) : null}
        <Link
          href={catalogHref}
          className={BAR_LINK}
          aria-current={currentFor(catalogHref, currentPath)}
        >
          {allCatalogLabel}
        </Link>
      </div>
      {/*
        CHIPSY (kontener < 48 rem, trasy katalogowe): przewijane poziomo,
        scroll-snap na krawędzi chipa, pasek przewijania schowany w OBU
        silnikach (standard `scrollbar-width` + WebKit) — przewijalność
        sygnalizuje ścięty chips na krawędzi, nie belka przewijania.
      */}
      {chips ? (
        <div className="@min-[48rem]/site:hidden">
          <div
            data-store-category-chips
            className={cn(
              SITE_CONTAINER,
              "flex snap-x gap-2 overflow-x-auto pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            )}
          >
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={CHIP_LINK}
                aria-current={currentFor(item.href, currentPath)}
              >
                {item.name}
              </Link>
            ))}
            <Link
              href={catalogHref}
              className={CHIP_LINK}
              aria-current={currentFor(catalogHref, currentPath)}
            >
              {allCatalogLabel}
            </Link>
          </div>
        </div>
      ) : null}
    </nav>
  );
}
