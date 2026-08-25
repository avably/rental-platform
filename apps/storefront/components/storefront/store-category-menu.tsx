/**
 * MENU KATEGORII W NAGŁÓWKU SKLEPU (ADR-247, Faza D) — rozwijana lista wejść
 * do stron kategorii (`/kategoria/{slug}`).
 *
 * ==================== DLACZEGO NATYWNE `<details>`, A NIE DROPDOWN NA JS ====================
 *
 * Rozwijane menu klasycznie znaczy stan otwarcia w Reakcie, obsługę Escape
 * i kliknięcia poza obszarem — a więc komponent kliencki i skrypt. Nagłówek
 * sklepu stoi jednak na trasach z CSP bez `unsafe-inline` (nonce, ADR-097),
 * a jego treść musi być poprawna JUŻ w SSR. Natywny `<details>` daje pełną
 * dostępność (przycisk z `aria-expanded`, klawiatura, stan otwarcia) BEZ ani
 * jednej linijki JavaScriptu — więc menu działa tak samo z wyłączonym skryptem
 * i nie ma jak rozjechać serwera z klientem na pierwszym renderze.
 *
 * Panel stoi w warstwie `absolute`, żeby rozwinięcie NIE PRZESUWAŁO belki
 * nagłówka (inaczej otwarcie menu spychałoby koszyk). Kolor bierze z ról
 * motywu (`site-card`, `site-menu-link`) — te same zmienne, co reszta powłoki,
 * więc menu jest ciemne na motywie ciemnym bez jednej reguły per motyw.
 *
 * ROZDZIAŁ POWIERZCHNI ROBI OBRYS, NIE CIEŃ (twardy zakaz cieni w chrome, patrz
 * `no-shadow-contract`): panel odcina się od strony obrysem karty (`site-card`),
 * a nie unoszącym go cieniem.
 *
 * KOMPONENT JEST GŁUPI: dostaje gotowe pozycje i etykietę, nie zna katalogu.
 * Regułę „które kategorie" (guard pustych) trzyma `categoryNavItems`.
 */
import Link from "next/link";

import type { CategoryNavItem } from "@/lib/catalog/category-nav";

export function StoreCategoryMenu({
  items,
  label,
}: {
  items: readonly CategoryNavItem[];
  /** Napis wyzwalacza w języku SKLEPU (oś tenancka), np. „Kategorie". */
  label: string;
}) {
  // Bez pozycji nie ma menu: pusty wyzwalacz obiecywałby listę, której nie ma.
  // Guard stoi też w wołającym (powłoka nie renderuje komponentu dla pustej
  // listy), ale i tutaj — komponent poprawny sam w sobie nie zależy od tego,
  // że ktoś go nie zawołał na próżno.
  if (items.length === 0) return null;

  return (
    /*
      KOTWICA PANELU ZALEŻY OD SZEROKOŚCI KONTENERA (S-01 audytu 2026-08-25).

      Panel `w-56` zakotwiczony w pudełku wyzwalacza (`relative` na <details>)
      wystawał ~14 px poza okno przy 360 px — wyzwalacz stoi za znakiem firmy,
      więc lewa krawędź panelu startuje zbyt głęboko. Poniżej 40 rem <details>
      jest więc `static`, a panel (`left-0 right-0` niżej) rozpina się na
      szerokość NAJBLIŻSZEGO pozycjonowanego przodka — wiersza belki nagłówka
      (`relative` w `StoreShellHeader`): pełna szerokość, zero wystawania,
      niezależnie od długości nazw. Od 40 rem wraca kotwica w wyzwalaczu
      i panel `w-56` jak dotąd. Warianty KONTENEROWE (`@min-[40rem]/site:`),
      nie viewportowe — ta sama zasada, co w sekcjach (ADR-085).
    */
    <details
      className="site-category-menu group static @min-[40rem]/site:relative"
      data-store-category-menu
    >
      {/*
        Cel dotykowy wyzwalacza (S-15, WCAG 2.5.8): padding do 44 px wysokości,
        ujemne marginesy oddają tę samą przestrzeń — belka nie zmienia wyglądu.
      */}
      <summary
        className="site-menu-link -mx-2 -my-3 inline-flex cursor-pointer list-none items-center gap-1 px-2 py-3 text-sm font-medium [&::-webkit-details-marker]:hidden"
        aria-label={label}
      >
        <span>{label}</span>
        {/* Strzałka obraca się przy otwarciu — czysto dekoracyjna (`aria-hidden`). */}
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
        `left-0 right-0` na wąskim kontenerze = pełna szerokość wiersza belki
        (kotwica — patrz docblock <details> wyżej); od 40 rem `right-auto w-56`
        przywraca panel przy wyzwalaczu. Pozycje mają 44 px wysokości (py-3,
        S-15) — cel dotykowy zamiast 36 px linijki.
      */}
      <div className="site-card absolute left-0 right-0 top-full z-30 mt-2 max-h-[70vh] overflow-auto p-1 @min-[40rem]/site:right-auto @min-[40rem]/site:w-56">
        <ul className="flex list-none flex-col">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="site-menu-link block rounded px-3 py-3 text-sm"
              >
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
