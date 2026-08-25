"use client";

/**
 * DOSTĘPNOŚĆ NA KAFLU KATALOGU (faza 5, ADR-180).
 *
 * ==================== CO BYŁO ZEPSUTE ====================
 *
 * Katalog nie mówił o dostępności NIC. Klient wybierał termin w powłoce
 * (ADR-179), przeglądał listę i dowiadywał się, czego w tym terminie nie ma,
 * dopiero po wejściu w sprzęt — albo, przy pełnym koszyku, dopiero z panelu
 * konfliktu. Dwa kliknięcia po informację, którą sklep miał już w ręku.
 *
 * ==================== DLACZEGO KONTEKST, A NIE PROPS ====================
 *
 * Kafel rysuje się w CZTERECH miejscach (siatka i lista sekcji strukturalnej,
 * sekcja v1, element katalogu na płótnie v2), a przez każde z nich prowadzi
 * inny łańcuch propsów: renderer → rejestr układów → komponent sekcji → kafel.
 * Przewleczenie liczby tą drogą znaczyłoby cztery nowe parametry w kontrakcie
 * pakietu i cztery miejsca, w których nowy układ sekcji zapomni ją podać —
 * po cichu, bo brak liczby na kaflu niczego nie wywraca.
 *
 * Kontekst odwraca ten koszt: kafel PYTA o liczbę, a odpowiada mu ta
 * powierzchnia, która wie. Brak dostawcy jest stanem legalnym i domyślnym —
 * płótno kreatora ani miniatura szablonu nie mają terminu, więc nie mają też
 * o czym mówić.
 *
 * ==================== BRAK TERMINU TO BRAK INFORMACJI ====================
 *
 * Kafel bez terminu nie pisze „dostępne". Milczy. To jest rozstrzygnięcie,
 * a nie oszczędność: „dostępne" bez terminu jest zdaniem, którego nikt nie
 * sprawdził, a klient odczyta je jako obietnicę. Tak samo milczy pozycja
 * NIEOBECNA w odpowiedzi — brak klucza znaczy „nie wiem", nigdy „zero"
 * (dokładnie ta sama umowa, co przy `dayUnits` kalendarza).
 *
 * ==================== WYŁĄCZNIE LICZBY (ADR-042) ====================
 *
 * Do kafla trafia LICZBA WOLNYCH SZTUK i nic poza nią. Ani kto zarezerwował,
 * ani na kiedy, ani które egzemplarze — te pytania nie mają w tej warstwie
 * odpowiedzi, bo nie ma ich już w odpowiedzi bazy.
 *
 * ==================== BADGE ZAMIAST GOŁEJ LICZBY (ADR-245, faza B) ====================
 *
 * Liczba sama w sobie („wolne: 7 szt.") jest DANĄ, a nie ODPOWIEDZIĄ na pytanie,
 * które klient naprawdę zadaje przy kafelku: „czy wezmę to w tym terminie?".
 * Znacznik streszcza więc liczbę do TRZECH stanów handlowych:
 *   • `unavailable` — zero wolnych: „Zajęty w tym terminie";
 *   • `low` — od jednej do {@link LOW_STOCK_THRESHOLD} sztuk: „Zostały N szt."
 *     (liczba WRACA, bo niedobór jest bodźcem — pokazujemy dokładnie ile);
 *   • `available` — powyżej progu: „Dostępny" (liczba znika, bo „jest dużo"
 *     nie potrzebuje licznika, a licznik przy nadmiarze tylko rozprasza).
 * Ten sam próg i te same stany obsłuży strona kategorii (faza C) — kafel jest
 * jednym komponentem dla obu list.
 *
 * ==================== STAN NIE SAMYM KOLOREM (WCAG 1.4.1) ====================
 *
 * Stan niesie TEKST — trzy różne etykiety, i to one są nośnikiem informacji.
 * Kolor jest wyłącznie WZMOCNIENIEM. Znak (ptaszek przy nadmiarze, krzyżyk
 * przy zajętości) jest `aria-hidden`, bo jego treść niesie już etykieta obok;
 * stan `low` znaku nie ma wcale od F7b (patrz `AvailabilityGlyph`).
 *
 * ==================== ZERO KLAS W TYM PLIKU ====================
 *
 * Klasę podaje WOŁAJĄCY (props `className`), a nie ten moduł, i to jest
 * warunek, pod którym kontrakt ról (`structured-role-usage.test.tsx`) w ogóle
 * ma sens: skanuje on źródła komponentów sekcji, a domknięcie importów sięga
 * wyłącznie ich katalogu. Klasa namalowana TUTAJ byłaby rolą poza skanem —
 * czyli dokładnie tą dziurą, przed którą tamten kontrakt broni. Ta sama
 * zasada, co przy `../links`, `../image-url` i `../site-icons`.
 *
 * ==================== KOLOR STANU MIESZKA W ARKUSZU, NIE W KLASIE ====================
 *
 * Trzy stany różnią się też kolorem, ale kaflowi (który podaje `className`) nie
 * sposób go przekazać: stan wylicza dopiero TEN komponent z liczby, więc wołający
 * go nie zna. Kolor bierze więc arkusz — regułami spiętymi na atrybucie
 * `data-products-availability-state`, a nie klasą roli. Dzięki temu wybór barwy
 * nie staje się „rolą poza skanem" macierzy kontrastu (patrz akapit wyżej),
 * a jednocześnie stan pozostaje czytelny bez koloru: niosą go etykieta i glif.
 */
/*
 * WEJŚCIE PUNKTOWE, NIE BARYŁKA (`@avably/core/locale`). Ten plik jest
 * KOMPONENTEM KLIENCKIM, a korzeń rdzenia re-eksportuje wszystko — Stripe,
 * kuriera, pocztę, rozliczenia. Import z korzenia dokładał je do paczki
 * klienckiej kreatora i systemu projektowego (zmierzone: +15 KB i +30 KB
 * gzip pierwszego ładowania, ponad budżet ADR-262).
 */
import { pluralFormOf, type Locale, type PluralForms } from "@avably/core/locale";
import { createContext, useContext } from "react";

/**
 * PRÓG „MAŁO SZTUK" — granica między stanem `low` a `available` (ADR-245).
 *
 * Wydzielony jako stała, żeby dostrojenie było zmianą JEDNEJ liczby, a nie
 * poszukiwaniem warunku po kodzie. `units <= LOW_STOCK_THRESHOLD` (i > 0) to
 * „Zostały N szt."; powyżej — „Dostępny". Zero jest osobnym stanem przed tym
 * porównaniem, więc próg go nie dotyczy.
 */
export const LOW_STOCK_THRESHOLD = 3;

/** Trzy stany handlowe kafla — patrz nagłówek pliku (ADR-245). */
export type SiteProductAvailabilityState = "available" | "low" | "unavailable";

/** Etykiety i liczby dla kafli — komplet, którego pakiet nie ma skąd wziąć sam. */
export interface SiteProductAvailability {
  /**
   * `product_id` → liczba WOLNYCH sztuk w wybranym terminie. Pozycja
   * nieobecna = brak informacji o niej (kafel milczy), a nie zero.
   */
  units: Readonly<Record<string, number>>;
  /** Etykieta stanu `available` (powyżej progu) — bez liczby, np. „Dostępny". */
  available: string;
  /**
   * Etykieta stanu `low` (1..próg) — z liczbą, interpolacja `{units}`, w TRZECH
   * FORMACH LICZEBNIKA (F11).
   *
   * Jedna forma wystarczała po angielsku („2 left") i kłuła po polsku: przy
   * jednej sztuce chip mówił „Zostały 1 szt.". Formę wybiera `pluralFormOf`
   * z rdzenia, czyli ta sama reguła, którą liczy się pozycje katalogu.
   */
  low: PluralForms;
  /** Etykieta stanu `unavailable` (zero) — osobna, bo „wolne: 0 szt." to usterka. */
  unavailable: string;
  /**
   * Język NAJEMCY (oś tenancka) — bez niego nie ma jak wybrać formy. Pakiet UI
   * nie zna słownika i nie ma go skąd wziąć sam; podaje go ten sam most, co
   * etykiety.
   */
  locale: Locale;
}

/**
 * `null` = ta powierzchnia nie zna terminu (płótno kreatora, miniatura,
 * katalog przed wyborem terminu). Kafel milczy.
 */
const SiteProductAvailabilityContext = createContext<SiteProductAvailability | null>(null);

export function SiteProductAvailabilityProvider({
  value,
  children,
}: {
  value: SiteProductAvailability | null;
  children: React.ReactNode;
}) {
  return (
    <SiteProductAvailabilityContext.Provider value={value}>
      {children}
    </SiteProductAvailabilityContext.Provider>
  );
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

/** Liczba wolnych sztuk → stan handlowy (jedno miejsce reguły progu, ADR-245). */
export function availabilityStateOf(units: number): SiteProductAvailabilityState {
  if (units === 0) return "unavailable";
  if (units <= LOW_STOCK_THRESHOLD) return "low";
  return "available";
}

/**
 * GLIF STANU — sam kształt, `aria-hidden`, bo treść niesie już etykieta obok.
 *
 * ==================== NIEDOBÓR BEZ WYKRZYKNIKA (F7b) ====================
 *
 * Do F7b stan `low` niósł wykrzyknik. Właściciel zdjął go po obejrzeniu
 * produkcji („z chipsa dostępności usuń wykrzyknik"), i słusznie: „Zostały
 * 2 szt." to informacja HANDLOWA — ile jeszcze można wziąć — a wykrzyknik
 * czyta się jak OSTRZEŻENIE o usterce, tym samym znakiem, którym interfejs
 * mówi „coś poszło źle". Chip mówi teraz samą treścią.
 *
 * WCAG 1.4.1 DALEJ SPEŁNIONE, i to nie przypadkiem: trzy stany mają trzy różne
 * ETYKIETY („Dostępny" / „Zostały N szt." / „Zajęty w tym terminie"), a warunek
 * dotyczy tego, żeby informacji nie niósł SAM kolor. Glif był wzmocnieniem
 * drugiego rzędu; zostaje przy stanach skrajnych (ptaszek / krzyżyk), gdzie
 * czyta się jak znak statusu, a nie jak alarm.
 *
 * `focusable="false"` — w części przeglądarek `<svg>` bez tego łapie tabulację
 * i dokłada pusty przystanek.
 */
function AvailabilityGlyph({ state }: { state: SiteProductAvailabilityState }) {
  // Niedobór nie dostaje ŻADNEGO znaku — patrz docblock wyżej.
  if (state === "low") return null;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      width="14"
      height="14"
    >
      {state === "available" ? (
        <path d="M20 6 9 17l-5-5" />
      ) : (
        <path d="M18 6 6 18M6 6l12 12" />
      )}
    </svg>
  );
}

/**
 * ZNACZNIK DOSTĘPNOŚCI POZYCJI — badge stanu na kaflu albo NIC.
 *
 * Stoi w każdym układzie kafla, żeby dostępność nie zależała od tego, który
 * układ sekcji operator wybrał: klient, który przełączy sekcję z siatki na
 * listę, nie ma prawa stracić informacji o tym, co jest wolne.
 */
export function SiteProductAvailabilityMark({
  productId,
  className,
}: {
  productId: string;
  /** Klasa kształtu podana przez kafel — patrz „ZERO KLAS" w nagłówku pliku. */
  className?: string;
}) {
  const availability = useContext(SiteProductAvailabilityContext);
  if (availability === null) return null;

  const units = availability.units[productId];
  if (units === undefined) return null;

  const state = availabilityStateOf(units);
  const label =
    state === "unavailable"
      ? availability.unavailable
      : state === "low"
        ? interpolate(pluralFormOf(units, availability.locale, availability.low), { units })
        : availability.available;

  return (
    <span
      data-products-availability={productId}
      data-products-availability-units={units}
      data-products-availability-state={state}
      className={className}
    >
      <AvailabilityGlyph state={state} />
      {label}
    </span>
  );
}
