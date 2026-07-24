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
    region: "preset-chip",
    count: 3,
    from: "render",
    anchor: "preset=",
    anchorCount: 3,
    note: "szybkie chipy zakresu terminu (DATE_PRESETS)",
  },
  {
    region: "advanced-filters",
    from: "render",
    anchor: "<details",
    note: "składane „Filtry zaawansowane” — zwinięte, więc szkielet też",
  },
  {
    region: "table",
    from: "render",
    anchor: "<table",
    note: "ramka tabeli desktopowej (md+), przewijana poziomo wewnątrz",
  },
  {
    region: "table-head",
    count: 8,
    from: "render",
    // Spacja po nazwie jest istotna: „<th" złapałoby też „<thead".
    anchor: "<th ",
    anchorCount: 8,
    note: "osiem kolumn tabeli — zmiana liczby kolumn pali kontrakt",
  },
  {
    region: "table-row",
    count: ORDERS_LIST_SKELETON_ROWS,
    from: "render",
    anchor: "data-order-row",
    note: "wiersz tabeli o wysokości h-[52px] jak wiersz realny",
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
] as const;

/**
 * Własne komponenty ekranu listy (importy `./…` w `zamowienia/page.tsx`),
 * które MAJĄ odpowiednik w szkielecie.
 *
 * To jest bramka na WYCZERPUJĄCOŚĆ. Test wyciąga ze źródła ekranu komplet
 * lokalnych komponentów i wymaga, żeby każdy z nich stał albo tutaj, albo na
 * liście wyjątków niżej — z powodem. Dołożenie do ekranu np. `<OrdersBulkBar`
 * bez regionu w szkielecie pali kontrakt, czyli dokładnie to, co przeszło
 * niezauważone przy #113.
 */
export const ORDERS_LIST_SCREEN_PARTS: readonly string[] = [
  "OrdersStats",
  "OrdersTable",
  "OrdersToolbar",
] as const;

/**
 * Lokalne komponenty listy BEZ własnego regionu — każdy z powodem, bo cichy
 * wyjątek zamieniłby tę bramkę w dekorację.
 */
export const ORDERS_LIST_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {
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
    region: "section-status",
    from: "source",
    anchor: 'id="status"',
    note: "sekcja zmiany statusu — cel pozycji z menu wiersza listy",
  },
  {
    region: "section-items",
    from: "source",
    anchor: 't("items")',
    note: "sekcja pozycji zamówienia z tabelą i podsumowaniem kwot",
  },
  {
    region: "section-deposit",
    from: "source",
    anchor: 'id="kaucja"',
    note: "sekcja kaucji — rejestr zdarzeń, salda i formularze",
  },
  {
    region: "section-extension",
    from: "source",
    anchor: "<ExtensionSection",
    note: "sekcja przedłużenia najmu",
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
  "OrderTimeline",
] as const;

/** Lokalne komponenty szczegółu bez własnego regionu — każdy z powodem. */
export const ORDER_DETAIL_PARTS_WITHOUT_REGION: Readonly<Record<string, string>> = {
  DepositForms: "karta salda i akcji WEWNĄTRZ sekcji kaucji (region section-deposit)",
  DetailField: "para etykieta/wartość WEWNĄTRZ karty podsumowania (region summary)",
  OrderNotes: "formularz notatki WEWNĄTRZ karty notatek (region notes) — sam `<section>` stoi w page.tsx",
  StatusButtons: "przyciski przejścia WEWNĄTRZ sekcji statusu (region section-status)",
};

/**
 * Ile znaczników `<section` stoi WPROST w źródle szczegółu: podsumowanie
 * i notatki (panel boczny) oraz status, pozycje i kaucja (kolumna główna).
 * Sekcje wniesione przez komponenty (`<*Section`) liczy lista wyżej.
 * Dołożenie kolejnej sekcji inline bez regionu w szkielecie pali kontrakt —
 * i tak właśnie ta liczba urosła z 4 na 5 po #118 (karta notatek).
 */
export const ORDER_DETAIL_INLINE_SECTIONS = 5;
