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
 * Pozycja dashboardu — poza grupami, na samej górze (artefakt trzyma ją jako
 * osobny wpis). Od UX1 (ADR-140) ekran ISTNIEJE i jest stroną startową,
 * więc pozycja jest klikalnym linkiem do `/` BEZ badge „Wkrótce" (zgodna
 * edycja artefaktu Fazy 2 — zdjęte `data-future` i `<span>` zapowiedzi).
 * Celowo NIE wchodzi do PANEL_NAV_GROUPS/PANEL_NAV_ITEMS: artefakt trzyma ją
 * poza grupami, a `matchNavItem` (dopasowanie prefiksowe) na `/` łapałby
 * każdą trasę.
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
 * CELOWO POZA `PANEL_NAV_GROUPS`/`PANEL_NAV_ITEMS`: kontrakt struktury
 * (`panel-nav-contract.test.ts`) porównuje grupy 1:1 z artefaktem Fazy 2, a
 * artefakt tej pozycji nie zna. To pozycja stanu konta, nie stała struktura —
 * shell renderuje ją na górze grupy SPRZEDAŻ z badge postępu (np. „4/7”)
 * WYŁĄCZNIE dopóki onboarding nieukończony (sygnał liczony z danych), i chowa
 * po komplecie wymaganych kroków. Jak `PANEL_NAV_PLACEHOLDER`: stan aktywny to
 * RÓWNOŚĆ ścieżki (nie jest w `matchNavItem`), a tytuł belki bierze się z
 * override'u tytułu niżej.
 */
export const PANEL_NAV_LAUNCH: PanelNavItem = {
  id: "launch",
  href: "/uruchomienie",
  labelKey: "launch",
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
      // Dokumenty prawne (B4, ADR-129) w KANAŁACH, tuż za Umowami — bo to ta
      // sama rodzina spraw: tekst, na który przystaje klient. Umowy dotyczą
      // PDF-a podpisywanego przy wydaniu sprzętu, dokumenty prawne — stron
      // /regulamin i /prywatnosc w sklepie. Sąsiedztwo jest celowe: dopóki
      // PDF czyta własną kopię treści (dług nazwany w ADR-129), operator musi
      // widzieć oba miejsca obok siebie.
      { id: "legal", href: "/dokumenty-prawne", labelKey: "legal" },
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
      // `ownerOnly`: /zaproszenia stoi za requireMember("owner"), więc staff
      // widział pozycję, która zawsze kończyła się odmową (M-UX-02).
      { id: "team", href: "/zaproszenia", labelKey: "team", ownerOnly: true },
      // Dług P3 ZAMKNIĘTY w P6 (ADR-059): ekran organizacji istnieje, więc
      // pozycja celuje tam, gdzie zapowiadał brief. Identyfikator bez zmiany,
      // więc kontrakt struktury z artefaktem zostaje zielony.
      // `/organizacja/nowa` (onboarding) pozostaje osiągalna własnym adresem.
      { id: "organization", href: "/organizacja", labelKey: "organization" },
      // Eksport danych (C2, ADR-111) w ORGANIZACJI, nie w SPRZEDAŻY ani
      // KANAŁACH — rozstrzygnięcie spisane w ADR-110 (decyzja 14), żeby
      // pozycja nie wędrowała między grupami przy każdej sesji: SPRZEDAŻ to
      // ekrany, na których się PRACUJE codziennie; KANAŁY to drogi
      // podłączane RAZ; ORGANIZACJA to sprawy firmy i konta — „zabierz
      // swoje dane" należy tam (a eksport klientów jest owner-only, jak
      // reszta tej grupy).
      { id: "dataExport", href: "/eksport-danych", labelKey: "dataExport" },
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
 * GRUP nawigacji: artefakt trzyma go poza grupami (od UX1/ADR-140 jako
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
  // Hub „Uruchomienie" (ADR-228) stoi poza grupami nawigacji (pozycja
  // warunkowa), więc `matchNavItem` go nie zna — tytuł belki bierze się stąd.
  { path: "/uruchomienie", labelKey: "launch" },
  { path: "/zamowienia/nowe", labelKey: "newOrder" },
  { path: "/historia-emaili", labelKey: "emailHistory" },
  // „Wygląd sklepu" (ADR-230) jest PODTRASĄ `/strona`, nie pozycją nawigacji:
  // `matchNavItem` (prefiks) świadomie ZOSTAWIAMY na „store", żeby podświetlało
  // „Strona sklepu". Ale ekran ma własny H1 „Wygląd sklepu", więc belka nie może
  // pokazywać „Strona sklepu" — override daje jej właściwy tytuł BEZ ruszania
  // podświetlenia i BEZ nowej pozycji w kontrakcie 15 pozycji.
  { path: "/strona/wyglad", labelKey: "storeAppearance" },
  // PRZED `/organizacja/nowa` — `panelTitleKey` bierze PIERWSZE dopasowanie,
  // a dopasowanie jest prefiksowe, więc wpis ogólniejszy przykryłby ten.
  { path: "/organizacja/nowa/gotowe", labelKey: "organizationCreated" },
  { path: "/organizacja/nowa", labelKey: "newOrganization" },
  { path: "/bezpieczenstwo/wyzwanie", labelKey: "securityChallenge" },
  // /ustawienia-api NIE MA już override'u tytułu: od M2 (ADR-110) ekran ma
  // własną pozycję w grupie KANAŁY, więc tytuł bierze się z niej przez
  // matchNavItem — jedna nazwa w menu i w nagłówku, zero rozjazdu.
  // /eksport-danych NIE MA już override'u tytułu: od M2 (ADR-110) ekran ma
  // własną pozycję w grupie ORGANIZACJA, więc tytuł bierze się z niej przez
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

/** Klucz jedynego H1 shella, także dla tras spoza głównej nawigacji. */
export function panelTitleKey(pathname: string): string {
  if (pathname === "/") return PANEL_NAV_PLACEHOLDER.labelKey;
  const override = PANEL_ROUTE_TITLE_OVERRIDES.find(
    ({ path }) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (override) return override.labelKey;
  return matchNavItem(pathname)?.labelKey ?? "panelNavigation";
}
