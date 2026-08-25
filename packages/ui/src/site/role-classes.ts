import type { StructuredThemeRole } from "@avably/core/site";

/**
 * KLASA ARKUSZA → ROLA MOTYWU (E1, ADR-094 — delta recenzji PM do PR #178).
 *
 * ==================== PO CO TA TABLICA ====================
 *
 * Macierz kontrastu liczy po ROLACH ZADEKLAROWANYCH w rejestrze
 * (`STRUCTURED_SECTIONS[type].themeRoles`). Deklaracja bez dowodu jest jednak
 * dokładnie tą klasą wady, którą opisuje lekcja z PR #83: recenzja PM wstrzyknęła
 * do renderu FAQ realną klasę `site-text-accent` przy deklaracji
 * `[ink, inkMuted, border]` i CAŁOŚĆ przeszła na zielono — bo nikt nie pytał
 * ŹRÓDEŁ, czym komponent naprawdę maluje.
 *
 * Ta tablica jest brakującym ogniwem: jednym miejscem, w którym zapisano, którą
 * ROLĘ maluje która KLASA. Kontrakt `structured-role-usage.test.ts` skanuje po
 * niej źródła komponentów strukturalnych i porównuje zbiór ról UŻYTYCH ze
 * zbiorem ZADEKLAROWANYCH — w obie strony.
 *
 * ==================== JAK CZYTAĆ WPISY ====================
 *
 * Prawda pochodzi z `site.css`, nie z intuicji — każdy wpis odpowiada regule,
 * która sięga po zmienną roli:
 *   • `--site-accent-text` → accentText, `--site-accent` jako wypełnienie → accentFill;
 *   • `--site-ink-muted` → inkMuted, `--site-border` → border;
 *   • klasy, które stylują TEKST biorący domyślny (dziedziczony) atrament pasa,
 *     liczą się jako `ink` — bo to jest kolor, którym ten tekst zostanie
 *     namalowany, i to on musi mieć policzony kontrast.
 *
 * PAS NIE JEST ROLĄ. `site-band-*`, `site-surface` i spółka nie malują roli —
 * WYBIERAJĄ pas, na którym role dopiero się liczą. Stoją niżej jako neutralne,
 * a nie są pomijane po cichu: klasa `site-*` spoza OBU list jest w kontrakcie
 * BŁĘDEM. Nowa klasa musi więc dostać jawną decyzję („to jest rola X" albo „to
 * jest neutralne"), a nie prześlizgnąć się przez skan.
 */
export const ROLE_CLASSES: Record<string, readonly StructuredThemeRole[]> = {
  // — tekst na akcencie —
  "site-text-accent": ["accentText"],
  // — tekst przygaszony —
  "site-text-muted": ["inkMuted"],
  // — sygnał błędu (E4: pierwszy typ strukturalny z FORMULARZEM) —
  // Osobna zmienna motywu (`--site-danger-text`), nie akcent: „nie wyszło" jest
  // komunikatem systemu, a nie elementem dyrekcji wizualnej sklepu (K6/ADR-092).
  "site-error": ["dangerText"],
  // — tekst na atramencie pasa (kolor dziedziczony z `.site-root` / pasa) —
  "site-title": ["ink"],
  "site-eyebrow": ["ink"],
  "site-label": ["ink"],
  "site-text-inverted": ["ink"],
  "landing-display": ["ink"],
  "landing-heading": ["ink"],
  "landing-statement": ["ink"],
  "landing-subheading": ["ink"],
  // — kreski i obrysy —
  "site-rule": ["border"],
  "site-rule-top": ["border"],
  "site-divider": ["border"],
  "site-outline": ["border"],
  // Karta przełącza pas na `card`, ale RYSUJE obrys ze zmiennej kreski.
  "site-card": ["border"],
  // Okno powiększenia zdjęcia (E3): geometria plus obrys ze zmiennej kreski.
  // Powierzchnię i atrament bierze z `site-root`/`site-surface` obok siebie —
  // dlatego wnosi TYLKO kreskę.
  "site-lightbox": ["border"],
  "site-header": ["border"],
  "site-field": ["border"],
  // — wypełnienia akcentem —
  /*
   * PRZYCISK PIERWSZORZĘDNY maluje TRZY role, a nie dwie (E7). Wypełnienie
   * (`--site-accent`) i etykietę na nim (`--site-accent-contrast`) w motywie
   * z przyciskiem pełnym, a w motywie z przyciskiem obrysowym — akcentowy
   * tekst. Do E6 deklaracja pomijała parę „etykieta NA wypełnieniu", czyli
   * jedyną, której nieprzeczytanie zatrzymuje odwiedzającego NA przycisku:
   * liczył ją wyłącznie blok chrome sklepu, poza macierzą typów.
   */
  "site-cta": ["accentFill", "accentText", "accentOnFill"],
  // Panel wezwania wypełniony akcentem (E7): powierzchnia z `--site-accent`,
  // treść na niej w kolorze etykiety.
  "site-panel-accent": ["accentFill", "accentOnFill"],
  // Przycisk na panelu akcentowym — para ODWRÓCONA (etykieta staje się tłem),
  // czyli ten sam iloraz kontrastu, co etykieta na wypełnieniu.
  "site-cta-on-accent": ["accentFill", "accentOnFill"],
  // Przycisk drugorzędny na panelu akcentowym: obrys i etykieta w kolorze
  // etykiety na wypełnieniu.
  "site-cta-outline-on-accent": ["accentOnFill"],
  // Kraniec zakresu w kalendarzu (faza 5, ADR-179) — ta sama para, co
  // `.site-cta`: wypełnienie akcentem i etykieta na nim.
  "site-day-edge": ["accentFill", "accentOnFill"],
  // Środek zakresu: akcent ROZCIEŃCZONY jako tło, atrament karty jako tekst.
  // Wnosi obie role, bo obie realnie maluje.
  "site-day-middle": ["accentFill", "ink"],
  "site-badge": ["accentFill"],
  "site-icon-tile": ["accentFill"],
  "site-shape-accent": ["accentFill"],
  // Przycisk drugorzędny maluje etykietę atramentem, a obrys bierze
  // z `currentColor` — czyli z tego samego atramentu, nie z kreski pasa.
  "site-cta-secondary": ["ink"],
  // Link: atrament w spoczynku, akcent pod kursorem — obie ścieżki są realne.
  "site-link": ["ink", "accentText"],
  "site-nav-link": ["ink", "accentText"],
};

/**
 * Klasy NEUTRALNE: wybór pasa, geometria, kształt i powierzchnie zastępcze.
 * Żadna z nich nie sięga po zmienną roli, więc nie wnosi nic do macierzy
 * kontrastu — ale musi być tu wymieniona, żeby skan mógł odróżnić „neutralna"
 * od „nikt tego nie rozpatrzył".
 */
export const NEUTRAL_CLASSES: readonly string[] = [
  // Kształt LICZBY, nie jej kolor: `font-variant-numeric` zrównuje szerokości
  // cyfr, żeby kolumna cen nie „tańczyła". Zero zmiennych motywu (E9).
  "site-numeric",
  /*
   * BADGE DOSTĘPNOŚCI (ADR-245, faza B). Sama pastylka niesie WYŁĄCZNIE
   * geometrię (pastylka, rozstaw, waga). Kolor stanu maluje arkusz regułami
   * na `data-products-availability-state`, a nie ta klasa — dlatego stoi tu
   * jako neutralna, dokładnie jak `.site-day` (geometria dnia, kolor stanu
   * osobno).
   */
  "site-availability",
  /*
   * KOMÓRKA DNIA KALENDARZA (faza 5, ADR-179). Niesie WYŁĄCZNIE geometrię
   * (promień, przezroczysty obrys, przejście) — kolor dnia zwykłego jest
   * dziedziczonym atramentem karty, a stany wybrane malują `site-day-edge`
   * i `site-day-middle`, które stoją wyżej z własnymi rolami.
   */
  "site-day",
  "site-root",
  "site-surface",
  "site-band-muted",
  "site-band-inverted",
  "site-banner",
  "site-media",
  "site-placeholder",
  "site-scrim",
  "site-footer",
  /*
   * AUTO-UKŁAD LISTY WPISÓW (E6, aneks ADR-094). Ustala WYŁĄCZNIE geometrię
   * rzędu: zawijanie, podstawę kolumny i rozstaw. Nie sięga po ani jedną
   * zmienną roli — kolor wpisu niosą klasy stojące obok (`site-card`,
   * `site-text-muted`) i to one wchodzą do macierzy kontrastu.
   */
  "site-auto-grid",
  /*
   * SIATKA SPRZĘTU (E7, aneks ADR-094). Niesie WYŁĄCZNIE regułę pełnych rzędów
   * (`:nth-child` ukrywający ostatni, niepełny rząd) — geometrię, nie kolor.
   * Kafel maluje się klasami stojącymi obok (`site-card`, `site-title`,
   * `site-text-accent`) i to one wchodzą do macierzy kontrastu.
   */
  "site-product-grid",
  /*
   * KOLUMNY SIATKI SPRZĘTU (przygotowanie K1, audyt UX 2026-08-25). Niesie
   * WYŁĄCZNIE `grid-template-columns` per próg kontenera — geometrię rzędu,
   * ani jednej zmiennej roli. Osobno od `site-product-grid`, bo kolumny
   * dzielą też siatki BEZ reguły pełnych rzędów (kategorie, katalog).
   */
  "site-product-columns",
];
