/**
 * Manifest ODPOWIEDNIOŚCI szkielet ↔ ekran (uwaga przeglądu N1).
 *
 * Sedno bramki na regres. Uwaga właściciela brzmiała: „jest pokazany ekran,
 * który nie odpowiada temu, co się wyświetla" — i miała konkretną przyczynę:
 * PR #113 przebudował listę, PR #114 szczegół, a żaden z nich nie ruszył
 * `loading.tsx`. Nic tego nie wyłapało, bo szkielet nie był z niczym związany.
 *
 * Ten plik robi z tego związek JAWNY. Każdy region ma dwie strony:
 *  - `region` — nazwa, która MUSI wystąpić w szkielecie jako
 *    `data-skeleton-region`, dokładnie `count` razy;
 *  - `anchor` — ślad, który MUSI wystąpić na realnym ekranie (w renderze jego
 *    komponentów prezentacyjnych albo w źródle `page.tsx`).
 *
 * Kontrakt `test/skeleton-parity-contract.test.tsx` sprawdza OBIE strony plus
 * WYCZERPUJĄCOŚĆ (patrz `*_SCREEN_PARTS` niżej): region zdjęty ze szkieletu
 * pali test tak samo jak sekcja dołożona do ekranu bez regionu w szkielecie.
 */

/** Skąd bierzemy dowód istnienia regionu na ekranie. */
export type ScreenEvidence =
  /** render komponentów prezentacyjnych ekranu (`renderToStaticMarkup`) */
  | "render"
  /** źródło `page.tsx` — ekran jest asynchronicznym RSC z odczytami z bazy */
  | "source";

export interface SkeletonRegionSpec {
  /** Nazwa regionu w szkielecie (`data-skeleton-region`). */
  readonly region: string;
  /** Ile wystąpień regionu w szkielecie (domyślnie 1). */
  readonly count?: number;
  /** Gdzie szukać dowodu po stronie ekranu. */
  readonly from: ScreenEvidence;
  /** Podciąg, który musi wystąpić w dowodzie ekranu. */
  readonly anchor: string;
  /** Ile razy dokładnie (pominięte = co najmniej raz). */
  readonly anchorCount?: number;
  /** Po co ten region istnieje — czytane przy następnej przebudowie ekranu. */
  readonly note: string;
}

/**
 * Ile wierszy maluje szkielet listy. To JEDYNY wymiar, którego nie da się
 * poznać przed odczytem (strona ma od 0 do 100 wierszy), więc go nie
 * zgadujemy „na oko dużo": wiersze rosną W DÓŁ, więc ich liczba nie przesuwa
 * ani kafli, ani belki, ani nagłówka tabeli — a tych pilnuje pomiar.
 */
export const ORDERS_LIST_SKELETON_ROWS = 6;

/**
 * Analogicznie: ile wierszy pozycji maluje szkielet szczegółu. Dwa, bo tyle
 * wynosi typowa mediana zamówienia — pomyłka w tę stronę kosztuje ±43 px
 * w sekcji, która i tak stoi pod pierwszym ekranem.
 */
export const ORDER_DETAIL_SKELETON_ITEM_ROWS = 2;

/* ── Lista zamówień ────────────────────────────────────────────────────── */

export const ORDERS_LIST_REGIONS: readonly SkeletonRegionSpec[] = [
  {
    region: "header",
    from: "source",
    anchor: "<header",
    note: "podtytuł + akcja „Nowe zamówienie” (tytuł należy do belki, ADR-060)",
  },
  {
    region: "stat-tile",
    count: 4,
    from: "render",
    anchor: "data-order-stat=",
    anchorCount: 4,
    note: "cztery kafle statystyk z U1 (#113) — dołożenie piątego pali kontrakt",
  },
  {
    region: "search",
    from: "render",
    anchor: "data-orders-search",
    note: "wyszukiwarka belki (U1) — główny sposób zawężania listy",
  },
  {
    region: "result-count",
    from: "render",
    anchor: "data-orders-result-count",
    note: "licznik „N wyników” obok wyszukiwarki",
  },
  {
    region: "filter-row",
    from: "render",
    anchor: "data-orders-filter-row",
    note: "JEDEN wiersz filtrów (N2, #120): chipy z lewej, „Kolumny” i „Filtry zaawansowane” z prawej",
  },
  {
    region: "preset-chip",
    count: 3,
    from: "render",
    anchor: "preset=",
    anchorCount: 3,
    note: "szybkie chipy zakresu terminu (DATE_PRESETS)",
  },
  {
    region: "columns-menu",
    from: "render",
    anchor: "data-orders-columns-trigger",
    note: "menu wyboru widocznych kolumn (U5, #120) — przycisk h-9 w wierszu filtrów",
  },
  {
    region: "advanced-filters",
    from: "render",
    anchor: "data-orders-advanced-summary",
    note: "„Filtry zaawansowane” po N2 to WĄSKI przycisk h-9, nie pas pełnej szerokości; treść wychodzi nakładką, więc otwarcie nie przesuwa tabeli",
  },
  {
    region: "table",
    from: "render",
    anchor: "<table",
    note: "ramka tabeli desktopowej (md+), przewijana poziomo wewnątrz",
  },
  {
    region: "table-head",
    count: 9,
    from: "render",
    // Spacja po nazwie jest istotna: „<th" złapałoby też „<thead".
    anchor: "<th ",
    anchorCount: 9,
    note: "dziewięć kolumn po U4/U5: zaznaczenie + ID + sześć treściowych + akcje; zmiana liczby pali kontrakt",
  },
  {
    region: "select-all",
    from: "render",
    anchor: "data-orders-select-all",
    note: "checkbox „zaznacz wszystkie na stronie” w nagłówku tabeli (U4, #120)",
  },
  {
    region: "table-row",
    count: ORDERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-order-row",
    note: "wiersz tabeli o wysokości h-[52px] jak wiersz realny",
  },
  {
    region: "select-row",
    count: ORDERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-orders-select-row",
    note: "checkbox zaznaczenia w każdym wierszu tabeli (U4)",
  },
  {
    region: "mobile-cards",
    from: "render",
    anchor: "data-order-card",
    note: "stos kart zamiast tabeli poniżej md (U3)",
  },
  {
    region: "mobile-card",
    count: ORDERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-order-card",
    note: "pojedyncza karta mobilna — ten sam wiersz-model co tabela",
  },
  {
    region: "select-card",
    count: ORDERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-orders-select-card",
    note: "checkbox zaznaczenia OBOK karty mobilnej (U4) — kontrolka w środku kotwicy byłaby pułapką na klik",
  },
] as const;

/**
 * Pliki, które SKŁADAJĄ ekran listy — źródła skanowane pod wyczerpującość.
 *
 * Po #120 `page.tsx` przestał być jedynym miejscem, w którym decyduje się, co
 * na liście widać: interaktywną warstwę wnosi `orders-list.tsx` (tabela +
 * pasek akcji masowych), a kontrolki filtrów `orders-toolbar.tsx` (menu
 * kolumn). Skan tylko po `page.tsx` przepuściłby nowy region schowany o jeden
 * poziom niżej — a to jest dokładnie ta klasa regresu, przeciw której ten
 * kontrakt powstał.
 */
export const ORDERS_LIST_COMPOSITION_FILES: readonly string[] = [
  "page.tsx",
  "orders-list.tsx",
  "orders-toolbar.tsx",
] as const;

/**
 * Własne komponenty ekranu listy (importy `./…` z plików wyżej), które MAJĄ
 * odpowiednik w szkielecie.
 *
 * To jest bramka na WYCZERPUJĄCOŚĆ. Test wyciąga ze źródeł komplet lokalnych
 * komponentów i wymaga, żeby każdy z nich stał albo tutaj, albo na liście
 * wyjątków niżej — z powodem. Dołożenie do ekranu nowego komponentu bez
 * regionu w szkielecie pali kontrakt, czyli dokładnie to, co przeszło
 * niezauważone przy #113.
 */
export const ORDERS_LIST_SCREEN_PARTS: readonly string[] = [
  "OrdersColumnsMenu",
  "OrdersList",
  "OrdersStats",
  "OrdersTable",
  "OrdersToolbar",
] as const;

/**
 * Lokalne komponenty listy BEZ własnego regionu — każdy z powodem, bo cichy
 * wyjątek zamieniłby tę bramkę w dekorację.
 */
export const ORDERS_LIST_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {
  OrdersBulkActions:
    "pasek akcji masowych zwraca null, dopóki nic nie jest zaznaczone (U4) — na wejściu na ekran go NIE MA, więc szkielet nie może go obiecywać",
  OrdersDateFilter:
    "pole własnego zakresu dat WEWNĄTRZ zwiniętego panelu „Filtry zaawansowane” (region advanced-filters)",
  OrdersEmptyState:
    "gałąź tenanta BEZ ani jednego zamówienia; szkielet nie wie z góry, którą gałąź zobaczy, więc maluje przypadek dominujący zamiast udawać zaproszenie",
};

/* ── Szczegół zamówienia ───────────────────────────────────────────────── */

export const ORDER_DETAIL_REGIONS: readonly SkeletonRegionSpec[] = [
  {
    region: "header",
    from: "source",
    anchor: "<header",
    note: "odchudzony nagłówek: mikro-etykieta + numer + powrót do listy (D4)",
  },
  {
    region: "timeline",
    from: "render",
    anchor: "data-order-timeline",
    note: "oś czasu zastąpiła rząd chipów statusu (D5, #114)",
  },
  {
    region: "timeline-step",
    count: 5,
    from: "render",
    anchor: "data-timeline-step=",
    anchorCount: 5,
    note: "pięć kroków osi — zmiana ich liczby pali kontrakt",
  },
  {
    region: "layout",
    from: "source",
    anchor: "lg:grid-cols-[minmax(0,1fr)_320px]",
    note: "rama dwukolumnowa (D9): treść operacyjna + panel boczny 320px",
  },
  {
    region: "aside",
    from: "source",
    anchor: "<aside",
    note: "panel boczny pierwszy w źródle — na wąskim ekranie ląduje NAD resztą",
  },
  {
    region: "customer-card",
    from: "render",
    anchor: "data-customer-card",
    note: "karta „Profil klienta” (D1)",
  },
  {
    region: "customer-email",
    from: "render",
    anchor: 'data-customer-field="email"',
    note: "wiersz e-maila karty klienta — zawsze obecny",
  },
  {
    region: "customer-phone",
    from: "render",
    anchor: 'data-customer-field="phone"',
    note: "wiersz telefonu — zawsze obecny (brak wartości = „nie podano”)",
  },
  {
    region: "customer-address",
    from: "render",
    anchor: 'data-customer-field="address"',
    note: "wiersz adresu — zawsze obecny; wiersz firmy jest warunkowy, więc szkielet go nie udaje",
  },
  {
    region: "summary",
    from: "source",
    anchor: "data-order-summary",
    note: "karta „Podsumowanie” w panelu bocznym: termin i dostawa (notatki wyprowadzone do własnej karty w #118)",
  },
  {
    region: "summary-extension",
    from: "source",
    anchor: "<ExtensionSection",
    note: "wejście w przedłużenie PRZY TERMINIE w karcie podsumowania (R4): przycisk „Przedłuż” odsłania wybór nowej daty końca z dopłatą na żywo; osobna sekcja przedłużenia zniknęła, mechanika bez zmian",
  },
  {
    region: "notes",
    from: "source",
    anchor: 'id="notes-heading"',
    note: "karta EDYTOWALNYCH notatek zamówienia (N6, #118) — etykieta, pole wieloliniowe i przycisk zapisu",
  },
  {
    region: "contract-card",
    from: "source",
    anchor: "<ContractSection",
    note: "karta „Umowa najmu” w panelu bocznym",
  },
  {
    region: "invoice-card",
    from: "source",
    anchor: "<InvoiceSection",
    note: "karta „Faktura” w panelu bocznym (D3, ADR-076) — wysyłka PDF-a od operatora i stan „wysłana” WYPROWADZONY z historii wiadomości, bez kolumny w orders",
  },
  {
    region: "section-status",
    from: "source",
    anchor: 'id="status"',
    note: "sekcja zmiany statusu — cel pozycji z menu wiersza listy",
  },
  {
    region: "section-items",
    from: "source",
    anchor: "<ItemsSection",
    note: "sekcja pozycji — po D6/N4 samowystarczalny RSC z własnym odczytem katalogu i dostępności, a nie tabela inline w page.tsx",
  },
  {
    region: "items-table",
    from: "render",
    anchor: "data-items-table",
    note: "ramka tabeli pozycji, przewijana poziomo wewnątrz; po D6/N4 z PIĄTĄ kolumną „Akcje”",
  },
  {
    region: "items-row",
    count: ORDER_DETAIL_SKELETON_ITEM_ROWS,
    from: "render",
    anchor: "data-items-row",
    note: "wiersz pozycji zakończony przyciskiem „Edytuj” (h-8) — zmiana liczby kolumn wiersza pali kontrakt komórek",
  },
  {
    region: "items-add",
    from: "render",
    anchor: "data-items-add",
    note: "formularz „Dodaj pozycję” (D6/N4): wybór produktu z liczbą wolnych sztuk + przycisk; stoi POD sumami, bo kwoty czyta się częściej, niż dokłada pozycje",
  },
  {
    region: "section-deposit",
    from: "source",
    anchor: 'id="kaucja"',
    note: "sekcja kaucji — rejestr zdarzeń, salda i formularze",
  },
  {
    region: "section-delivery",
    from: "source",
    anchor: "<DeliverySection",
    note: "sekcja logistyki (przesyłki, etykiety)",
  },
  {
    region: "section-emails",
    from: "source",
    anchor: "<EmailLogSection",
    note: "dziennik e-maili zamówienia",
  },
] as const;

/**
 * Własne komponenty szczegółu (importy `./…` w `zamowienia/[id]/page.tsx`),
 * które MAJĄ odpowiednik w szkielecie. Nowa `<PlatnosciSection` bez regionu
 * pali kontrakt.
 */
export const ORDER_DETAIL_SCREEN_PARTS: readonly string[] = [
  "ContractSection",
  "CustomerCard",
  "DeliverySection",
  "EmailLogSection",
  "ExtensionSection",
  "InvoiceSection",
  "ItemsSection",
  "OrderTimeline",
] as const;

/** Lokalne komponenty szczegółu bez własnego regionu — każdy z powodem. */
export const ORDER_DETAIL_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {
  DepositForms: "karta salda i akcji WEWNĄTRZ sekcji kaucji (region section-deposit)",
  DetailField: "para etykieta/wartość WEWNĄTRZ karty podsumowania (region summary)",
  OrderNotes: "formularz notatki WEWNĄTRZ karty notatek (region notes) — sam `<section>` stoi w page.tsx",
  StatusSelect:
    "dropdown przejść, pytanie o wiadomość i baner odliczania WEWNĄTRZ sekcji statusu (region section-status) — sam `<section>` stoi w page.tsx",
};

/**
 * Ile znaczników `<section` stoi WPROST w źródle szczegółu: podsumowanie
 * i notatki (panel boczny) oraz status i kaucja (kolumna główna).
 * Sekcje wniesione przez komponenty (`<*Section`) liczy lista wyżej.
 * Dołożenie kolejnej sekcji inline bez regionu w szkielecie pali kontrakt —
 * ta liczba urosła z 4 na 5 po #118 (karta notatek) i SPADŁA z powrotem na 4
 * po D6/N4: pozycje przestały być tabelą inline i wyszły do `<ItemsSection`,
 * bo edycja potrzebuje własnego odczytu katalogu i dostępności.
 */
export const ORDER_DETAIL_INLINE_SECTIONS = 4;

/* ── Lista klientów (R6a) ──────────────────────────────────────────────── */

/**
 * Ile wierszy maluje szkielet listy klientów. Jak przy zamówieniach: to
 * jedyny wymiar nieznany przed odczytem, a wiersze rosną W DÓŁ, więc ich
 * liczba nie przesuwa belki ani nagłówka tabeli.
 */
export const CUSTOMERS_LIST_SKELETON_ROWS = 6;

export const CUSTOMERS_LIST_REGIONS: readonly SkeletonRegionSpec[] = [
  {
    region: "header",
    from: "source",
    anchor: "<header",
    note: "podtytuł listy (tytuł „Klienci” należy do belki, ADR-060)",
  },
  {
    region: "search",
    from: "render",
    anchor: "data-customers-search",
    note: "wyszukiwarka belki — jedyny sposób zawężania listy klientów (po nazwisku/mailu/telefonie)",
  },
  {
    region: "result-count",
    from: "render",
    anchor: "data-customers-result-count",
    note: "licznik „N wyników” obok wyszukiwarki",
  },
  {
    region: "table",
    from: "render",
    anchor: "<table",
    note: "ramka tabeli desktopowej (md+), przewijana poziomo wewnątrz",
  },
  {
    region: "table-head",
    count: 5,
    from: "render",
    // Spacja po nazwie jest istotna: „<th" złapałoby też „<thead".
    anchor: "<th ",
    anchorCount: 5,
    note: "pięć kolumn: klient + e-mail + telefon + zamówienia + ostatnie zamówienie; zmiana liczby pali kontrakt",
  },
  {
    region: "table-row",
    count: CUSTOMERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-customer-row",
    note: "wiersz tabeli o wysokości h-[52px] jak wiersz realny",
  },
  {
    region: "mobile-cards",
    from: "render",
    anchor: "data-customer-card",
    note: "stos kart zamiast tabeli poniżej md",
  },
  {
    region: "mobile-card",
    count: CUSTOMERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-customer-card",
    note: "pojedyncza karta mobilna — ten sam wiersz-model co tabela",
  },
] as const;

/** Pliki składające ekran listy klientów — źródła skanowane pod wyczerpującość. */
export const CUSTOMERS_LIST_COMPOSITION_FILES: readonly string[] = ["page.tsx"] as const;

/** Własne komponenty ekranu listy klientów z odpowiednikiem w szkielecie. */
export const CUSTOMERS_LIST_SCREEN_PARTS: readonly string[] = [
  "CustomersTable",
  "CustomersToolbar",
] as const;

/** Lokalne komponenty listy klientów BEZ własnego regionu — każdy z powodem. */
export const CUSTOMERS_LIST_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {
  CustomersEmptyState:
    "gałąź tenanta BEZ ani jednego klienta; szkielet nie wie z góry, którą gałąź zobaczy, więc maluje przypadek dominujący (lista) zamiast udawać zaproszenie",
};

/* ── Karta klienta (R6a) ───────────────────────────────────────────────── */

/** Ile wierszy historii zamówień maluje szkielet karty (mediana krótkiej listy). */
export const CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS = 3;

export const CUSTOMER_DETAIL_REGIONS: readonly SkeletonRegionSpec[] = [
  {
    region: "back",
    from: "source",
    anchor: "data-customer-back",
    note: "powrót do listy klientów (tytuł „Klienci” niesie belka)",
  },
  {
    region: "ban",
    from: "source",
    anchor: "<CustomerBanToggle",
    note: "karta ban-listy (R6b) — stan zablokowania klienta i przełącznik ban/unban nad formularzem edycji",
  },
  {
    region: "edit-form",
    from: "render",
    anchor: "data-customer-edit-form",
    note: "formularz edycji danych klienta — kontakt, dane do faktury i adres w jednej karcie",
  },
  {
    region: "field",
    count: 8,
    from: "render",
    anchor: "data-customer-edit-field=",
    anchorCount: 8,
    note: "osiem edytowalnych pól: e-mail, imię i nazwisko, telefon, firma, NIP, ulica, kod, miasto — zmiana liczby pali kontrakt",
  },
  {
    region: "save",
    from: "render",
    anchor: "data-customer-save",
    note: "przycisk zapisu zmian pod formularzem",
  },
  {
    region: "history",
    from: "source",
    anchor: "<CustomerOrders",
    note: "karta „Historia zamówień” klienta — skrócona lista z wierszami-linkami do szczegółów",
  },
  {
    region: "history-row",
    count: CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS,
    from: "render",
    anchor: "data-customer-order-row",
    note: "wiersz historii zamówień (desktop) zakończony kwotą i statusem",
  },
  {
    region: "history-card",
    count: CUSTOMER_DETAIL_SKELETON_HISTORY_ROWS,
    from: "render",
    anchor: "data-customer-order-row",
    note: "karta historii zamówień poniżej md — ten sam wiersz-model co tabela",
  },
] as const;

/** Pliki składające ekran karty klienta — źródła skanowane pod wyczerpującość. */
export const CUSTOMER_DETAIL_COMPOSITION_FILES: readonly string[] = ["[id]/page.tsx"] as const;

/** Własne komponenty karty klienta z odpowiednikiem w szkielecie. */
export const CUSTOMER_DETAIL_SCREEN_PARTS: readonly string[] = [
  "CustomerBanToggle",
  "CustomerEditForm",
  "CustomerOrders",
] as const;

/** Lokalne komponenty karty klienta BEZ własnego regionu — każdy z powodem. */
export const CUSTOMER_DETAIL_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {};
