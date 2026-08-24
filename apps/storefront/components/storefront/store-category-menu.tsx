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
    <details className="site-category-menu group relative" data-store-category-menu>
      <summary
        className="site-menu-link inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium [&::-webkit-details-marker]:hidden"
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
      <div className="site-card absolute left-0 top-full z-30 mt-2 max-h-[70vh] w-56 max-w-[80vw] overflow-auto p-1">
        <ul className="flex list-none flex-col">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="site-menu-link block rounded px-3 py-2 text-sm"
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
