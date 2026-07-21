/**
 * Definicja nawigacji panelu (ADR-056).
 *
 * To JEDYNE źródło, z którego renderuje się sidebar i szuflada mobilna —
 * struktura (kolejność grup, kolejność i identyfikatory pozycji, flaga
 * `future`) jest kontraktem z artefaktem handoffu Fazy 2, sekcja 04.
 * `test/panel-nav-contract.test.ts` parsuje `<nav data-panel-nav="true">`
 * wprost z artefaktu i porównuje go z tą stałą, więc pozycja dopisana tutaj
 * albo usunięta z artefaktu wywraca suitę.
 *
 * Plik jest CELOWO bez Reacta i bez ikon: kontrakt ma się dać zaimportować
 * w środowisku node, a mapowanie id → ikona żyje w komponencie sidebara.
 *
 * ETYKIETY nie są tutaj — idą przez next-intl (`nav.*`), bo produkt jest
 * dwujęzyczny. Trzymamy wyłącznie klucze.
 */

export type PanelNavGroupId = "sales" | "channels" | "organization";

/** Pozycja klikalna — prowadzi do istniejącego ekranu panelu. */
export type PanelNavItem = {
  id: string;
  /** Ścieżka BEZ prefiksu locale — prefiks dokłada `Link` z `@/i18n/navigation`. */
  href: string;
  labelKey: string;
};

export type PanelNavGroup = {
  id: PanelNavGroupId;
  /**
   * Tekst grupy DOKŁADNIE tak, jak stoi w artefakcie. To kotwica kontraktu,
   * nie etykieta interfejsu (ta idzie z `nav.group*`) — artefakt nie nadaje
   * grupom `data-*`, więc porównanie musi się zaczepić o treść.
   */
  artifactLabel: string;
  labelKey: string;
  items: PanelNavItem[];
};

/**
 * Pozycja zapowiadająca ekran, którego NIE MA. Nieklikalna, z badge „Wkrótce".
 * Artefakt trzyma ją poza grupami, na samej górze.
 */
export type PanelNavPlaceholder = {
  id: string;
  labelKey: string;
  badgeKey: string;
};

export const PANEL_NAV_PLACEHOLDER: PanelNavPlaceholder = {
  id: "dashboard",
  labelKey: "dashboard",
  badgeKey: "comingSoon",
};

export const PANEL_NAV_GROUPS: readonly PanelNavGroup[] = [
  {
    id: "sales",
    artifactLabel: "SPRZEDAŻ",
    labelKey: "groupSales",
    items: [
      { id: "orders", href: "/zamowienia", labelKey: "orders" },
      { id: "catalog", href: "/katalog", labelKey: "catalog" },
      { id: "store", href: "/strona", labelKey: "store" },
    ],
  },
  {
    id: "channels",
    artifactLabel: "KANAŁY",
    labelKey: "groupChannels",
    items: [
      { id: "domains", href: "/ustawienia-domen", labelKey: "domains" },
      { id: "emails", href: "/ustawienia-emaili", labelKey: "emails" },
      { id: "delivery", href: "/ustawienia-dostaw", labelKey: "delivery" },
    ],
  },
  {
    id: "organization",
    artifactLabel: "ORGANIZACJA",
    labelKey: "groupOrganization",
    items: [
      { id: "team", href: "/zaproszenia", labelKey: "team" },
      // ODSTĘPSTWO OD BRIEFU P3, świadome: brief mapował tę pozycję na
      // `/organizacja`, ale takiego ekranu w produkcie NIE MA — segment
      // `organizacja/` zawiera wyłącznie `nowa/`. Trzymamy jedyną istniejącą
      // trasę pod tym nagłówkiem zamiast wystawiać w nawigacji 404 albo
      // dorabiać ekran (P3 buduje shell, nie ekrany). Gdy P4–P6 dołożą
      // ustawienia organizacji, zmiana to jedna linia.
      { id: "organization", href: "/organizacja/nowa", labelKey: "organization" },
      { id: "security", href: "/bezpieczenstwo", labelKey: "security" },
    ],
  },
] as const;

/** Płaska lista pozycji klikalnych — do dopasowania trasy aktywnej. */
export const PANEL_NAV_ITEMS: readonly PanelNavItem[] = PANEL_NAV_GROUPS.flatMap(
  (group) => group.items,
);

/**
 * Pozycja, która ma dostać `aria-current="page"`.
 *
 * Dopasowanie po PREFIKSIE, bo ekrany zagnieżdżone (np. `/katalog/nowy`,
 * `/zamowienia/[id]`) należą do tej samej sekcji i użytkownik musi widzieć,
 * gdzie stoi. Wygrywa dopasowanie najdłuższe — inaczej `/katalog` odebrałby
 * podświetlenie ewentualnej trasie bardziej szczegółowej.
 *
 * `pathname` przychodzi BEZ prefiksu locale (`usePathname` z next-intl go
 * zdejmuje), więc porównujemy wprost z `href`.
 */
export function matchNavItem(pathname: string): PanelNavItem | undefined {
  let best: PanelNavItem | undefined;
  for (const item of PANEL_NAV_ITEMS) {
    const isMatch = pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (!isMatch) continue;
    if (!best || item.href.length > best.href.length) best = item;
  }
  return best;
}
