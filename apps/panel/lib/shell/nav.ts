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
      // Klienci tuż za zamówieniami: to dwie podstawowe listy operacyjne, na
      // których pracuje lada (demand), przed katalogiem i stroną (offer).
      { id: "customers", href: "/klienci", labelKey: "customers" },
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
      { id: "contracts", href: "/ustawienia-umow", labelKey: "contracts" },
      // Płatności są KANAŁEM, nie sprzedażą: to konfiguracja drogi, którą
      // pieniądze wchodzą do najemcy — obok domen, poczty, dostaw i umów.
      // W grupie SPRZEDAŻ stałyby wśród ekranów, na których się PRACUJE
      // (zamówienia, katalog), a tu się nie pracuje, tylko podłącza raz.
      { id: "payments", href: "/ustawienia-platnosci", labelKey: "payments" },
      // Integracje (M2, ADR-110) — wejście do kluczy API i instrukcji
      // podłączenia WordPressa. Grupa KANAŁY, bo to kolejna DROGA, którą
      // przychodzi zamówienie: obok własnego sklepu (domeny) i poczty stoi
      // cudza strona najemcy. Nazwa rodzajowa, nie „WordPress i API":
      // ekran obejmuje klucze dla dowolnego konsumenta maszynowego, a embed
      // (M3) dołoży tu kolejne wejście bez zmiany etykiety.
      { id: "integrations", href: "/ustawienia-api", labelKey: "integrations" },
    ],
  },
  {
    id: "organization",
    artifactLabel: "ORGANIZACJA",
    labelKey: "groupOrganization",
    items: [
      { id: "team", href: "/zaproszenia", labelKey: "team" },
      // Dług P3 ZAMKNIĘTY w P6 (ADR-059): ekran organizacji istnieje, więc
      // pozycja celuje tam, gdzie zapowiadał brief. Identyfikator bez zmiany,
      // więc kontrakt struktury z artefaktem zostaje zielony.
      // `/organizacja/nowa` (onboarding) pozostaje osiągalna własnym adresem.
      { id: "organization", href: "/organizacja", labelKey: "organization" },
      { id: "security", href: "/bezpieczenstwo", labelKey: "security" },
    ],
  },
] as const;

/** Płaska lista pozycji klikalnych — do dopasowania trasy aktywnej. */
export const PANEL_NAV_ITEMS: readonly PanelNavItem[] = PANEL_NAV_GROUPS.flatMap(
  (group) => group.items,
);

export function resolvePanelNavItem(id: string): PanelNavItem {
  const item = PANEL_NAV_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Bottom bar id spoza PANEL_NAV_ITEMS: ${id}`);
  return item;
}

export const PANEL_BOTTOM_NAV_ITEMS = [
  resolvePanelNavItem("orders"),
  resolvePanelNavItem("catalog"),
] as const;

/**
 * Skrót do strony głównej panelu na dolnym pasku (decyzja właściciela
 * 2026-07-22).
 *
 * NIE przechodzi przez `resolvePanelNavItem`, bo dashboard nie jest pozycją
 * nawigacji: artefakt trzyma go jako ZAPOWIEDŹ poza grupami, a sidebar dalej
 * pokazuje go jako nieklikalny, z badge „Wkrótce". Na wąskim ekranie nie ma
 * jednak znaku marki, który na desktopie prowadzi do `/`, więc pasek jest
 * jedynym miejscem, z którego wraca się na stronę główną jednym kciukiem.
 * Etykieta idzie z tej samej zapowiedzi, żeby oba miejsca nie rozjechały się
 * w nazwie.
 */
export const PANEL_BOTTOM_NAV_HOME: PanelNavItem = {
  id: PANEL_NAV_PLACEHOLDER.id,
  href: "/",
  labelKey: PANEL_NAV_PLACEHOLDER.labelKey,
};

const PANEL_ROUTE_TITLE_OVERRIDES = [
  { path: "/zamowienia/nowe", labelKey: "newOrder" },
  { path: "/historia-emaili", labelKey: "emailHistory" },
  { path: "/organizacja/nowa", labelKey: "newOrganization" },
  { path: "/bezpieczenstwo/wyzwanie", labelKey: "securityChallenge" },
  // /ustawienia-api NIE MA już override'u tytułu: od M2 (ADR-110) ekran ma
  // własną pozycję w grupie KANAŁY, więc tytuł bierze się z niej przez
  // matchNavItem — jedna nazwa w menu i w nagłówku, zero rozjazdu.
  // Eksport danych (C2, ADR-111) — jak klucze API: ekran spoza grup
  // nawigacji, wejście z ekranu organizacji.
  { path: "/eksport-danych", labelKey: "dataExport" },
] as const;

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

/** Klucz jedynego H1 shella, także dla tras spoza głównej nawigacji. */
export function panelTitleKey(pathname: string): string {
  if (pathname === "/") return PANEL_NAV_PLACEHOLDER.labelKey;
  const override = PANEL_ROUTE_TITLE_OVERRIDES.find(
    ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (override) return override.labelKey;
  return matchNavItem(pathname)?.labelKey ?? "panelNavigation";
}
