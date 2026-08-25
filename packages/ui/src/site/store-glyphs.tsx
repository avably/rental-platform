/**
 * ZNAKI CHROME SKLEPU — JEDEN JĘZYK FORMY DLA CAŁEJ BELKI (F7b).
 *
 * ==================== PO CO OSOBNY MODUŁ ====================
 *
 * Od F7b belka sklepu jest IKONOWA (korekta właściciela 2026-08-25: „w belce
 * tylko ikony z jednym wyjątkiem"). Znaki przestały być ozdobą przy napisie
 * i stały się JEDYNĄ widoczną treścią sterującą — a wtedy rozjazd między nimi
 * przestaje być drobiazgiem: lupa rysowana kreską 2 obok koszyka rysowanego
 * wypełnieniem czyta się jak dwa różne interfejsy sklejone taśmą.
 *
 * Znaki mieszkały dotąd w trzech plikach dwóch aplikacji (lupa w wyszukiwaniu
 * storefrontu, kalendarz w pigułce terminu, koszyk nigdzie — bo był napisem).
 * Zbieramy je w jedno miejsce, bo od F7b muszą być jednym ZESTAWEM: ta sama
 * siatka 24, ta sama grubość kreski, te same zakończenia.
 *
 * ==================== DLACZEGO NIE `lucide-react` ====================
 *
 * Pakiet zna `lucide` (mapa ikon sekcji atutów, `site-icons.ts`), ale chrome
 * sklepu bierze znaki RĘCZNIE, ścieżką na siatce 24 — z dwóch powodów:
 *
 *   • WAGA TRASY. Chrome stoi na KAŻDEJ trasie sklepu (także w kasie), a cztery
 *     ścieżki SVG w kodzie ważą tyle, co ich `d`. Import biblioteki ikon do
 *     powłoki dokładałby moduł do first-load JS każdej trasy — dokładnie to,
 *     czego pilnują budżety ADR-262.
 *   • JEDNA GRAMATYKA. Zestaw jest zamknięty (cztery znaki) i dobrany do siebie:
 *     `stroke-width: 2`, zaokrąglone końce i łączenia, brak wypełnień. Znak
 *     dobrany z biblioteki „bo jest" wpuściłby prędzej czy później piąty styl.
 *
 * ==================== ZERO KLAS I ZERO KOLORU ====================
 *
 * Znak dziedziczy kolor po rodzicu (`currentColor`) i nie nosi ani jednej klasy
 * roli — rozmiar podaje WOŁAJĄCY (`className`). Ta sama zasada, co
 * w `product-availability.tsx`: kolor chrome sklepu wynika z pasa, na którym
 * belka stoi, więc nie ma prawa być decyzją znaku.
 *
 * `aria-hidden` z `focusable="false"` na każdym: znak nigdy nie jest nazwą
 * kontrolki. Nazwę niesie `aria-label` (albo tekst `sr-only`) na przycisku,
 * odnośniku czy wyzwalaczu — bez tego belka ikonowa byłaby dla czytnika ekranu
 * rzędem bezimiennych przystanków.
 */

/** Zamknięty zestaw znaków chrome sklepu (F7b). */
export type StoreGlyphName = "search" | "categories" | "cart" | "calendar";

/** Ścieżki znaku na wspólnej siatce 24 × 24 — jedno źródło kształtu. */
const PATHS: Record<StoreGlyphName, React.ReactNode> = {
  // Lupa — kształt z F7 (`SearchGlyph`), przeniesiony bez zmiany proporcji.
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  /*
    Kategorie: CZTERY KAFLE, a nie „hamburger". Trzy kreski znaczą w każdym
    interfejsie „menu strony"; tutaj wyzwalacz otwiera PÓŁKI oferty, a siatka
    kafli mówi o zbiorze rzeczy do przeglądania, nie o nawigacji dokumentu.
  */
  categories: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  // Koszyk sklepowy (kosz + dwa kółka) — czytelny w 20 px, bez wypełnień.
  cart: (
    <>
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="18" cy="20" r="1.4" />
      <path d="M2.5 3.5h2.2l2.4 11.1a1.8 1.8 0 0 0 1.8 1.4h8.3a1.8 1.8 0 0 0 1.8-1.4L20.8 7H6" />
    </>
  ),
  // Kalendarz — kształt z pigułki terminu (ADR-194), bez zmian.
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
};

export function StoreGlyph({
  name,
  className,
}: {
  name: StoreGlyphName;
  /** Rozmiar (i tylko rozmiar) podaje wołający — patrz „ZERO KLAS" wyżej. */
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
