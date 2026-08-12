"use client";

import { Link, usePathname } from "@/i18n/navigation";

/**
 * ZAKŁADKI REKORDU — pasek NAWIGACYJNY, nie widżet ze stanem (U8b, ADR-146).
 *
 * ================== DLACZEGO LINKI, A NIE role="tab" ==================
 *
 * Wzorzec ARIA `tablist/tab/tabpanel` opisuje przełączanie widoku W OBRĘBIE
 * JEDNEGO dokumentu: panele stoją w tym samym DOM-ie, a `aria-selected`
 * mówi, który jest pokazany. Podstrony produktu (Egzemplarze / Progi cenowe
 * / Zdjęcia) są OSOBNYMI TRASAMI — kliknięcie zmienia adres, historię
 * przeglądarki i dokument. Użycie `role="tab"` obiecałoby czytnikowi ekranu
 * panel, którego nie ma, i odebrałoby linkom ich zachowanie (otwarcie
 * w nowej karcie, kopiowanie adresu, cofanie).
 *
 * W repo są trzy ręczne `role="tablist"` (paski narzędzi kreatora strony)
 * i one są poprawne, bo NIE nawigują. To NIE jest wzorzec dla tego paska.
 * Wzorcem jest nawigacja panelu (`lib/shell/nav.ts` + `sidebar-nav.tsx`):
 * lista linków, z których bieżący niesie `aria-current="page"`.
 *
 * Komponentu `Tabs` w `@avably/ui` NIE MA — sprawdzone, nie zakładane.
 *
 * ================== DLACZEGO KLIENT ==================
 *
 * Layout Next.js nie dostaje ścieżki dziecka, a `aria-current` musi z niej
 * wynikać. `usePathname` z `@/i18n/navigation` oddaje ścieżkę BEZ prefiksu
 * locale, więc porównanie z `href` jest wprost — dokładnie jak w sidebarze.
 * Komponent nie trzyma ŻADNEGO stanu: aktywna zakładka jest funkcją adresu,
 * nie kliknięcia, więc pasek jest poprawny także przed hydracją.
 */

export interface RecordTabItem {
  /** Ścieżka BEZ prefiksu locale — prefiks dokłada `Link`. */
  href: string;
  label: string;
}

/**
 * Która zakładka jest bieżąca. Dopasowanie po PREFIKSIE i wygrywa NAJDŁUŻSZE
 * — lustro `matchNavItem` z `lib/shell/nav.ts`.
 *
 * Bez reguły „najdłuższe wygrywa" zakładka bazowa (`/katalog/{id}`, czyli
 * „Dane") byłaby aktywna na KAŻDEJ podstronie, bo jest prefiksem ich
 * wszystkich — i pasek pokazywałby dwie bieżące pozycje naraz.
 *
 * Funkcja jest czysta i eksportowana, żeby dało się ją przypiąć testem bez
 * renderowania Reacta.
 */
export function matchTabHref(
  pathname: string,
  hrefs: readonly string[],
): string | undefined {
  let best: string | undefined;
  for (const href of hrefs) {
    if (pathname !== href && !pathname.startsWith(`${href}/`)) continue;
    if (best === undefined || href.length > best.length) best = href;
  }
  return best;
}

export function RecordTabs({
  items,
  label,
}: {
  items: readonly RecordTabItem[];
  /** Nazwa dostępna paska — na ekranie bywa kilka regionów nawigacji. */
  label: string;
}) {
  const pathname = usePathname();
  const active = matchTabHref(
    pathname,
    items.map((item) => item.href),
  );

  return (
    <nav aria-label={label} data-record-tabs>
      <ul className="border-border flex flex-wrap items-end gap-1 border-b">
        {items.map((item) => {
          const isCurrent = item.href === active;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                data-record-tab
                aria-current={isCurrent ? "page" : undefined}
                className={[
                  // Krawędź dolna NA KAŻDEJ pozycji (przezroczysta poza
                  // bieżącą) — geometria paska nie może skakać przy zmianie
                  // zakładki, tak jak w sidebarze `border-l-2` stoi na
                  // wszystkich pozycjach.
                  "-mb-px flex min-h-10 items-center border-b-2 px-3 py-2 text-sm font-medium no-underline",
                  "outline-none transition-[color,border-color,outline-color] [transition-duration:var(--motion-fast)] [transition-timing-function:var(--ease-standard)]",
                  "hover:underline hover:underline-offset-[3px]",
                  "focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-[-3px] focus-visible:outline-accent dark:focus-visible:outline-ring",
                  isCurrent
                    ? "border-foreground text-foreground"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                ].join(" ")}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
