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
  "site-header": ["border"],
  "site-field": ["border"],
  // — wypełnienia akcentem —
  "site-cta": ["accentFill", "accentText"],
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
  "site-root",
  "site-surface",
  "site-band-muted",
  "site-band-inverted",
  "site-banner",
  "site-media",
  "site-placeholder",
  "site-scrim",
  "site-footer",
];
