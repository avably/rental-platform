/**
 * Definicja nawigacji panelu (ADR-056, przebudowa na DRZEWO w ADR-231).
 *
 * To JEDYNE źródło, z którego renderuje się sidebar i szuflada mobilna. Od
 * ADR-231 struktura jest DRZEWEM (`PANEL_NAV_TREE`): pozycje najwyższego
 * poziomu (klikalne liście) oraz GAŁĘZIE rozwijane (akordeon) z dziećmi. Płaskie
 * grupy sprzed ADR-231 (3 grupy / 15 pozycji) puchły — grupa KANAŁY sięgała
 * siedmiu pozycji „podłącz raz". Właściciel: „za długie i bez zagłębień".
 * Decyzja: drzewo zagnieżdżone (wariant C).
 *
 * Kontrakt struktury (`test/panel-nav-contract.test.ts`) parsuje
 * `<nav data-panel-nav="true">` wprost z ARTEFAKTU Fazy 2 i porównuje z tą
 * definicją. ADR-231 ŚWIADOMIE przepisał oba — artefakt i kontrakt — na drzewo;
 * to jedyne zadanie w projekcie, które ten kontrakt rusza.
 *
 * `PANEL_NAV_ITEMS` (płaska lista liści) POZOSTAJE: `matchNavItem` dopasowuje
 * po niej trasę aktywną prefiksowo, dokładnie jak przed przebudową. Drzewo
 * niesie WYŁĄCZNIE strukturę renderu; dopasowanie i podświetlenie liczą się
 * z płaskiej listy.
 *
 * Plik jest CELOWO bez Reacta i bez ikon: kontrakt ma się dać zaimportować
 * w środowisku node, a mapowanie id → ikona żyje w komponencie sidebara.
 *
 * ETYKIETY nie są tutaj — idą przez next-intl (`nav.*`), bo produkt jest
 * dwujęzyczny. Trzymamy wyłącznie klucze.
 */

/** Pozycja klikalna — prowadzi do istniejącego ekranu panelu (liść drzewa). */
export type PanelNavItem = {
  id: string;
  /** Ścieżka BEZ prefiksu locale — prefiks dokłada `Link` z `@/i18n/navigation`. */
  href: string;
  labelKey: string;
  /**
   * Ekran wyłącznie dla OWNERA (M-UX-02, ADR-193): sidebar i szuflada
   * ODZWIERCIEDLAJĄ uprawnienia i nie pokazują tej pozycji rolom bez dostępu
   * — bez tooltipów „brak dostępu" (rozstrzygnięcie PM: nie pokazujemy drzwi,
   * które są zamknięte, spójnie z filtrami `closing`/`onboarding`). Bramką
   * dostępu POZOSTAJE serwer (`requireMember("owner")` na ekranie i akcjach)
   * — flaga jest filtrem WIDOKU, nie zabezpieczeniem.
   */
  ownerOnly?: true;
};

/**
 * Gałąź rozwijana (akordeon, ADR-231). Dwa rodzaje, po obecności `href`:
 *  • NAWIGOWALNA (`href` obecny — „Strona sklepu" → `/strona`, „Organizacja" →
 *    `/organizacja`): wiersz-etykieta jest LINKIEM (klik NAWIGUJE), a osobny
 *    chevron rozwija dzieci — klik w chevron NIE zjada nawigacji.
 *  • GRUPA-TOGGLE (`href` nieobecny — „Ustawienia"): sama gałąź nie ma ekranu,
 *    więc cały wiersz jest przełącznikiem rozwijającym dzieci.
 *
 * `id` gałęzi jest identyfikatorem STRUKTURY (stan rozwinięcia w ciasteczku,
 * `aria-controls`, ikona). Dla gałęzi, której własna trasa NIE jest pokryta
 * żadnym dzieckiem (Organizacja → `/organizacja`), `id` pokrywa się z liściem
 * w `PANEL_NAV_ITEMS` — wtedy wiersz-link NIESIE `data-nav-item` i wchodzi do
 * `matchNavItem`. Dla gałęzi, której trasa jest już pokryta dzieckiem (Strona
 * sklepu → `/strona`, dziecko „Strony"), `id` jest wyłącznie strukturalny.
 */
export type PanelNavBranch = {
  id: string;
  labelKey: string;
  /** Trasa wiersza-linku; brak = gałąź-grupa (sam przełącznik, bez ekranu). */
  href?: string;
  children: readonly PanelNavItem[];
};

/** Węzeł najwyższego poziomu drzewa: klikalny liść albo gałąź rozwijana. */
export type PanelNavNode =
  | { readonly kind: "item"; readonly item: PanelNavItem }
  | { readonly kind: "branch"; readonly branch: PanelNavBranch };

/**
 * Pozycja dashboardu — poza drzewem, na samej górze (artefakt trzyma ją jako
 * osobny wpis). Od UX1 (ADR-140) ekran ISTNIEJE i jest stroną startową,
 * więc pozycja jest klikalnym linkiem do `/` BEZ badge „Wkrótce". Celowo NIE
 * wchodzi do `PANEL_NAV_TREE`/`PANEL_NAV_ITEMS`: artefakt trzyma ją poza
 * strukturą, a `matchNavItem` (dopasowanie prefiksowe) na `/` łapałby każdą
 * trasę.
 */
export type PanelNavPlaceholder = {
  id: string;
  labelKey: string;
};

export const PANEL_NAV_PLACEHOLDER: PanelNavPlaceholder = {
  id: "dashboard",
  labelKey: "dashboard",
};

/**
 * Pozycja WARUNKOWA „Uruchomienie" (config-first hub, ADR-228).
 *
 * CELOWO POZA `PANEL_NAV_TREE`/`PANEL_NAV_ITEMS`: kontrakt struktury
 * (`panel-nav-contract.test.ts`) porównuje drzewo 1:1 z artefaktem Fazy 2, a
 * artefakt tej pozycji nie zna. To pozycja stanu konta, nie stała struktura —
 * shell renderuje ją na górze drzewa z badge postępu (np. „4/7”) WYŁĄCZNIE
 * dopóki onboarding nieukończony (sygnał liczony z danych), i chowa po
 * komplecie wymaganych kroków. Jak `PANEL_NAV_PLACEHOLDER`: stan aktywny to
 * RÓWNOŚĆ ścieżki (nie jest w `matchNavItem`), a tytuł belki bierze się
 * z override'u tytułu niżej.
 */
export const PANEL_NAV_LAUNCH: PanelNavItem = {
  id: "launch",
  href: "/uruchomienie",
  labelKey: "launch",
};

// Liście — definiowane raz, wchodzą i do drzewa, i do płaskiej listy.
const ORDERS: PanelNavItem = { id: "orders", href: "/zamowienia", labelKey: "orders" };
const CUSTOMERS: PanelNavItem = { id: "customers", href: "/klienci", labelKey: "customers" };
const CATALOG: PanelNavItem = { id: "catalog", href: "/katalog", labelKey: "catalog" };

// „Strona sklepu" (gałąź nawigowalna → /strona). Dziecko „Strony" to LISTA
// wersji strony (ekran /strona, 0048/ADR-093) — dostaje własną etykietę
// `storePages`, żeby w rozwiniętej gałęzi nie dublować nazwy rodzica; id
// `store` i trasa /strona ZOSTAJĄ (matchNavItem bez zmian). „Wygląd" to ekran
// designu (/strona/wyglad, ADR-230) — do ADR-231 był podtrasą bez pozycji,
// teraz jest jawnym dzieckiem (screen istnieje, id nowy: storeAppearance).
const STORE_PAGES: PanelNavItem = { id: "store", href: "/strona", labelKey: "storePages" };
const STORE_APPEARANCE: PanelNavItem = {
  id: "storeAppearance",
  href: "/strona/wyglad",
  labelKey: "storeAppearance",
};

// „Ustawienia" (gałąź-grupa, bez ekranu) — dawna grupa KANAŁY + Płatności.
// Kolejność: od tego, co najczęściej podłącza operator, po sprawy formalne.
const PAYMENTS: PanelNavItem = { id: "payments", href: "/ustawienia-platnosci", labelKey: "payments" };
const DELIVERY: PanelNavItem = { id: "delivery", href: "/ustawienia-dostaw", labelKey: "delivery" };
const DOMAINS: PanelNavItem = { id: "domains", href: "/ustawienia-domen", labelKey: "domains" };
const EMAILS: PanelNavItem = { id: "emails", href: "/ustawienia-emaili", labelKey: "emails" };
const CONTRACTS: PanelNavItem = { id: "contracts", href: "/ustawienia-umow", labelKey: "contracts" };
const LEGAL: PanelNavItem = { id: "legal", href: "/dokumenty-prawne", labelKey: "legal" };
const INTEGRATIONS: PanelNavItem = { id: "integrations", href: "/ustawienia-api", labelKey: "integrations" };

// „Organizacja" (gałąź nawigowalna → /organizacja). Wiersz-link JEST liściem
// `organization` (trasy /organizacja nie pokrywa żadne dziecko), więc niesie
// `data-nav-item` i wchodzi do matchNavItem. Bezpieczeństwo ZOSTAJE tu (konto,
// nie sklep — decyzja właściciela).
const ORGANIZATION: PanelNavItem = { id: "organization", href: "/organizacja", labelKey: "organization" };
const TEAM: PanelNavItem = { id: "team", href: "/zaproszenia", labelKey: "team", ownerOnly: true };
const DATA_EXPORT: PanelNavItem = { id: "dataExport", href: "/eksport-danych", labelKey: "dataExport" };
const SECURITY: PanelNavItem = { id: "security", href: "/bezpieczenstwo", labelKey: "security" };

/** Identyfikatory gałęzi rozwijanych — kotwice stanu rozwinięcia (ADR-231). */
export const STORE_BRANCH_ID = "storeSection";
export const SETTINGS_BRANCH_ID = "settings";
export const ORGANIZATION_BRANCH_ID = "organization";

/**
 * DRZEWO nawigacji (ADR-231) — jedyne źródło struktury renderu.
 *
 * Kolejność najwyższego poziomu: dwie listy operacyjne lady (Zamówienia,
 * Klienci), katalog (offer), potem gałęzie: sklep, ustawienia, organizacja.
 */
export const PANEL_NAV_TREE: readonly PanelNavNode[] = [
  { kind: "item", item: ORDERS },
  { kind: "item", item: CUSTOMERS },
  { kind: "item", item: CATALOG },
  {
    kind: "branch",
    branch: {
      id: STORE_BRANCH_ID,
      labelKey: "store",
      href: "/strona",
      children: [STORE_PAGES, STORE_APPEARANCE],
    },
  },
  {
    kind: "branch",
    branch: {
      id: SETTINGS_BRANCH_ID,
      labelKey: "settings",
      children: [PAYMENTS, DELIVERY, DOMAINS, EMAILS, CONTRACTS, LEGAL, INTEGRATIONS],
    },
  },
  {
    kind: "branch",
    branch: {
      id: ORGANIZATION_BRANCH_ID,
      labelKey: "organization",
      href: "/organizacja",
      children: [TEAM, DATA_EXPORT, SECURITY],
    },
  },
] as const;

/**
 * Płaska lista pozycji klikalnych — do dopasowania trasy aktywnej. Zawiera
 * WSZYSTKIE liście plus własną trasę gałęzi nawigowalnej, której nie pokrywa
 * żadne dziecko (Organizacja → /organizacja). Każda trasa raz — bez duplikatu:
 * /strona pokrywa dziecko `store` („Strony"), więc gałąź „Strona sklepu"
 * własnego wpisu nie dokłada.
 */
export const PANEL_NAV_ITEMS: readonly PanelNavItem[] = [
  ORDERS,
  CUSTOMERS,
  CATALOG,
  STORE_PAGES,
  STORE_APPEARANCE,
  PAYMENTS,
  DELIVERY,
  DOMAINS,
  EMAILS,
  CONTRACTS,
  LEGAL,
  INTEGRATIONS,
  ORGANIZATION,
  TEAM,
  DATA_EXPORT,
  SECURITY,
];

/**
 * Czy wiersz-link gałęzi jest zarazem pozycją `matchNavItem` (niesie
 * `data-nav-item`). Prawda dla gałęzi, której trasy nie pokrywa żadne dziecko
 * (Organizacja). Fałsz dla „Strona sklepu" — tam trasę /strona reprezentuje
 * dziecko „Strony", a wiersz-rodzic jest tylko nagłówkiem sekcji z linkiem.
 */
export function branchSelfItem(branch: PanelNavBranch): PanelNavItem | undefined {
  if (!branch.href) return undefined;
  const covered = branch.children.some((child) => child.href === branch.href);
  if (covered) return undefined;
  return PANEL_NAV_ITEMS.find((item) => item.id === branch.id && item.href === branch.href);
}

export function resolvePanelNavItem(id: string): PanelNavItem {
  const item = PANEL_NAV_ITEMS.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Bottom bar id spoza PANEL_NAV_ITEMS: ${id}`);
  return item;
}

/**
 * Pozycja `PANEL_NAV_ITEMS` po id albo `undefined` — miękkie wyszukanie dla
 * ULUBIONYCH (ADR-232). Ulubione trzymają NIEPRZEZROCZYSTE id (baza jest
 * agnostyczna wobec treści), więc rozwiązanie id → pozycja musi znosić id
 * NIEZNANE (usunięty/zmieniony ekran) bez rzutu — inaczej niż `resolvePanelNavItem`.
 */
export function findNavItem(id: string): PanelNavItem | undefined {
  return PANEL_NAV_ITEMS.find((item) => item.id === id);
}

/**
 * Filtr surowej listy ulubionych do ZNANYCH pozycji nav (ADR-232) — zachowuje
 * kolejność, usuwa duplikaty i id spoza `PANEL_NAV_ITEMS`. Odporność na usunięty
 * ekran: stale/nieznane id po prostu znika z paska i z gwiazdek, a baza zostaje
 * nietknięta do najbliższego zapisu (który zapisze już oczyszczoną listę).
 */
export function knownFavoriteIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const known: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    if (!findNavItem(id)) continue;
    seen.add(id);
    known.push(id);
  }
  return known;
}

/** Pozycje nav dla listy id ulubionych (ZNANE, w kolejności) — render paska. */
export function favoriteNavItems(ids: readonly string[]): PanelNavItem[] {
  return knownFavoriteIds(ids).map((id) => findNavItem(id) as PanelNavItem);
}

export const PANEL_BOTTOM_NAV_ITEMS = [
  resolvePanelNavItem("orders"),
  resolvePanelNavItem("catalog"),
] as const;

/**
 * Trasy nawigacji dostępne W OKNIE DOMYKANIA (Zasada 8, ADR-138) — lustro
 * allowlisty guardów dla warstwy nawigacji. Pozycja spoza tej listy i tak
 * skończyłaby się odmową guardu (odmowa domyślna), więc filtr jest UX-em,
 * nie bramką: nie pokazujemy drzwi, które są zamknięte.
 */
export const CLOSING_NAV_HREFS: readonly string[] = [
  "/zamowienia",
  "/klienci",
  "/eksport-danych",
  "/organizacja",
  "/bezpieczenstwo",
];

/**
 * Skrót do strony głównej panelu na dolnym pasku (decyzja właściciela
 * 2026-07-22).
 *
 * NIE przechodzi przez `resolvePanelNavItem`, bo dashboard nie jest pozycją
 * drzewa nawigacji: artefakt trzyma go poza strukturą (od UX1/ADR-140 jako
 * klikalny link, wcześniej jako zapowiedź). Na wąskim ekranie nie ma znaku
 * marki, który na desktopie prowadzi do `/`, więc pasek jest jedynym
 * miejscem, z którego wraca się na stronę główną jednym kciukiem. Etykieta
 * idzie z tej samej pozycji, żeby oba miejsca nie rozjechały się w nazwie.
 */
export const PANEL_BOTTOM_NAV_HOME: PanelNavItem = {
  id: PANEL_NAV_PLACEHOLDER.id,
  href: "/",
  labelKey: PANEL_NAV_PLACEHOLDER.labelKey,
};

const PANEL_ROUTE_TITLE_OVERRIDES = [
  // Hub „Uruchomienie" (ADR-228) stoi poza drzewem nawigacji (pozycja
  // warunkowa), więc `matchNavItem` go nie zna — tytuł belki bierze się stąd.
  { path: "/uruchomienie", labelKey: "launch" },
  { path: "/zamowienia/nowe", labelKey: "newOrder" },
  { path: "/historia-emaili", labelKey: "emailHistory" },
  // „Wygląd sklepu" (ADR-230) od ADR-231 ma WŁASNĄ pozycję drzewa
  // (`storeAppearance`, /strona/wyglad), więc `matchNavItem` sam daje jej klucz
  // „storeAppearance" i belka pokazuje „Wygląd sklepu". Override zostawiony jako
  // jawna kotwica tytułu (i podtras `/strona/wyglad/…`, gdyby powstały) — jest
  // spójny z pozycją, nie przeciw niej.
  { path: "/strona/wyglad", labelKey: "storeAppearance" },
  // PRZED `/organizacja/nowa` — `panelTitleKey` bierze PIERWSZE dopasowanie,
  // a dopasowanie jest prefiksowe, więc wpis ogólniejszy przykryłby ten.
  { path: "/organizacja/nowa/gotowe", labelKey: "organizationCreated" },
  { path: "/organizacja/nowa", labelKey: "newOrganization" },
  { path: "/bezpieczenstwo/wyzwanie", labelKey: "securityChallenge" },
  // /ustawienia-api NIE MA już override'u tytułu: od M2 (ADR-110) ekran ma
  // własną pozycję (grupa „Ustawienia"), więc tytuł bierze się z niej przez
  // matchNavItem — jedna nazwa w menu i w nagłówku, zero rozjazdu.
  // /eksport-danych NIE MA już override'u tytułu: od M2 (ADR-110) ekran ma
  // własną pozycję (grupa „Organizacja"), więc tytuł bierze się z niej przez
  // matchNavItem — jak /ustawienia-api.
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

/**
 * Czy gałąź ZAWIERA trasę aktywną — do domyślnego rozwinięcia i oznaczenia
 * rodzica (ADR-231). Prawda, gdy aktywny jest wiersz-link gałęzi (jej własna
 * trasa) albo którekolwiek dziecko.
 */
export function branchContainsPath(branch: PanelNavBranch, pathname: string): boolean {
  const active = matchNavItem(pathname);
  if (!active) return false;
  if (branch.href && active.href === branch.href) return true;
  return branch.children.some((child) => child.id === active.id);
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
