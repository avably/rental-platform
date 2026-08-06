/**
 * RUCH JAKO DANE MOTYWU (K6, ADR-092).
 *
 * Wymaganie brzmiało: „animacje są CZĘŚCIĄ MOTYWU — dodanie motywu nr 7 nie
 * może wymagać nowych animacji w kodzie". Z tego wynika kształt tego pliku i
 * jedyna nietrywialna decyzja w nim zawarta:
 *
 *   JEST DOKŁADNIE JEDNA RODZINA KLATEK KLUCZOWYCH (`@keyframes site-reveal`
 *   w packages/ui/src/site/site.css), sparametryzowana zmiennymi. Preset ruchu
 *   nie jest nazwą animacji — jest KOMPLETEM LICZB, które ta jedna animacja
 *   czyta. Motyw nr 7 wskazuje preset nazwą (albo dostaje nowy preset, czyli
 *   kolejny wiersz liczb), a arkusz zostaje bez zmian.
 *
 * Gdyby zamiast tego każdy motyw miał własne `@keyframes`, „animacje jako dane"
 * byłyby fikcją: dane wskazywałyby kod, który trzeba dopisać razem z nimi.
 *
 * DLACZEGO CSS, A NIE JS (research, ADR-092): wejście sekcji prowadzi
 * `animation-timeline: view()` pod `@supports`, a nie IntersectionObserver.
 * Trzy powody: (1) treść jest widoczna DOMYŚLNIE — animacja tylko ją odbiera,
 * więc przeglądarka bez wsparcia i robot indeksujący widzą gotową stronę, a CLS
 * nie ma skąd wziąć skoku; (2) animacja `opacity`/`transform` jedzie na wątku
 * kompozytora, więc nie konkuruje z hydracją o wątek główny; (3) zero
 * kilobajtów JS na stronie sklepu.
 *
 * `prefers-reduced-motion` NIE jest tu polem — jest bramką w arkuszu
 * (`@media (prefers-reduced-motion: no-preference)`), bo preferencja należy do
 * czytelnika, a nie do motywu. Motyw, który mógłby ją nadpisać, byłby danymi
 * łamiącymi kontrakt dostępności.
 *
 * ============ CZASU TRWANIA TU NIE MA I NIE MOŻE BYĆ (E9) ============
 *
 * Do E8 preset niósł pole `duration`, a arkusz wstawiał je do skrótu
 * `animation`. Pomiar na żywej stronie (E9, Chrome, oś widoku) pokazał, że to
 * pole jest MARTWE: profil krycia sekcji był CO DO SETNEJ identyczny dla
 * 360 ms, 800 ms, 1500 ms, 3000 ms, 9000 ms i `auto`. Tak działa oś postępu —
 * animacja jest rozciągana na `animation-range`, więc czas trwania nie ma
 * czego mierzyć.
 *
 * Pole zostało usunięte, a nie „zostawione na wszelki wypadek", bo martwe
 * pokrętło w rejestrze ruchu jest gorsze niż jego brak: następna osoba, która
 * dostanie zadanie „spowolnij wejście na motywie X", podniesie `duration`,
 * zobaczy zero różnicy i uzna, że animacje są zepsute. Długość wejścia niesie
 * odtąd WYŁĄCZNIE `range` — i to jest jedyne pokrętło, które nią steruje.
 *
 * Arkusz nadal deklaruje czas (stałą, nie zmienną), bo wartość początkowa `0s`
 * ZWIJA animację do stanu końcowego — to jedyny czas, który przy osi widoku
 * cokolwiek zmienia (też zmierzone). Stała stoi więc w arkuszu z komentarzem,
 * zamiast udawać w danych parametr motywu.
 */

/**
 * Preset ruchu. Wszystkie wartości trafiają do CSS jako zmienne — stąd typ
 * `string` i jednostki w wartości: to są liczby CSS, a nie liczby domenowe,
 * i doklejanie jednostek w arkuszu byłoby drugim miejscem, w którym trzeba
 * pamiętać, czy `distance` jest w pikselach.
 */
export interface SiteMotionPreset {
  /** Opis dyrekcji ruchu — jak `mood` motywu, w danych, nie w słowniku panelu. */
  mood: { pl: string; en: string };
  /** Krzywa czasowa. */
  easing: string;
  /** Przesunięcie startowe w pionie — 0 znaczy „sam przenik". */
  distance: string;
  /** Skala startowa; 1 znaczy „bez skalowania". */
  scale: string;
  /**
   * Krycie startowe. 1 znaczy „bez przeniku" i to jest jedyny sposób, w jaki
   * preset `still` może NAPRAWDĘ nic nie robić: gdyby krycie było wpisane
   * w klatki na sztywno, „bez ruchu" i tak przenikałoby przy każdym wejściu.
   */
  opacity: string;
  /**
   * ZAKRES OSI WIDOKU (`animation-range`) — DŁUGOŚĆ WEJŚCIA MIERZONA OKNEM (E9).
   *
   * Do E8 zakres kończył się procentem fazy `cover`, czyli ułamkiem sumy
   * „wysokość sekcji + wysokość okna". Pomiar na żywej stronie (E9) pokazał,
   * co to znaczy w praktyce: na jednej stronie stopka o wysokości 472 px
   * odsłaniała się przez 357 px przewijania, a sekcja sprzętu o wysokości
   * 1033 px — przez 503 px. Ten sam ruch trwał więc RÓŻNIE DŁUGO w zależności
   * od tego, ile treści operator wpisał do sekcji, a strona czytała się jak
   * zbiór osobnych animacji zamiast jednego zachowania.
   *
   * Koniec zakresu jest odtąd DŁUGOŚCIĄ W JEDNOSTKACH OKNA (`24vh`), liczoną
   * od początku wejścia sekcji. Skutek jest dwojaki i oba są zamierzone:
   *   • wejście trwa TYLE SAMO dla każdej sekcji, niezależnie od jej wysokości;
   *   • sekcja jest w pełni odsłonięta, gdy jej górna krawędź mija `100vh - N`,
   *     czyli ZANIM zajmie ekran — czytelnik widzi wejście, a nie czyta treści,
   *     która pod kursorem dopiero dochodzi do pełnego krycia.
   */
  range: string;
}

/**
 * Rejestr presetów ruchu. Kolejność bez znaczenia — to nie jest galeria,
 * operator nie wybiera ruchu osobno (wybiera motyw, ruch jest jego częścią).
 *
 * `still` istnieje, żeby motyw mógł powiedzieć „bez ruchu" DANYMI. Bez niego
 * jedyną drogą byłby wyjątek w arkuszu, czyli znów kod per motyw.
 */
export const SITE_MOTION_PRESETS = {
  still: {
    mood: { pl: "Bez ruchu — treść stoi.", en: "No motion — content just sits." },
    easing: "linear",
    distance: "0px",
    scale: "1",
    opacity: "1",
    range: "entry 0% entry 0%",
  },
  calm: {
    mood: { pl: "Spokojne podniesienie i przenik.", en: "A calm lift and fade." },
    easing: "cubic-bezier(0.25, 0.1, 0.25, 1)",
    distance: "22px",
    scale: "1",
    opacity: "0",
    range: "entry 0% 32vh",
  },
  crisp: {
    mood: { pl: "Krótkie, rzeczowe wejście.", en: "Short, matter-of-fact entrance." },
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    distance: "14px",
    scale: "1",
    opacity: "0",
    range: "entry 0% 26vh",
  },
  spring: {
    mood: { pl: "Sprężyste wejście z lekkim naddatkiem.", en: "Springy entrance with a slight overshoot." },
    /*
     * Naddatek NIESIE KRZYWA, a nie skala: sekcja jest pasem na całą szerokość
     * okna, więc skala < 1 odsłaniałaby przy krawędziach tło strony (pomiar E9:
     * `scale: 0.97` zwężało pas z 1440 do 1431 px, czyli po ~4 px z każdej
     * strony — na paśmie odwróconym byłaby to widoczna szpara, a nie ruch).
     * Krzywa z przeskokiem daje ten sam charakter samym przesunięciem.
     */
    easing: "cubic-bezier(0.34, 1.42, 0.64, 1)",
    distance: "18px",
    scale: "1",
    opacity: "0",
    range: "entry 0% 28vh",
  },
  editorial: {
    mood: { pl: "Powolne wynurzenie, jak przewracana strona.", en: "A slow surfacing, like a turning page." },
    easing: "cubic-bezier(0.5, 0, 0.2, 1)",
    distance: "28px",
    scale: "1",
    opacity: "0",
    range: "entry 0% 38vh",
  },
} as const satisfies Record<string, SiteMotionPreset>;

export const SITE_MOTIONS = Object.keys(SITE_MOTION_PRESETS) as unknown as readonly (keyof typeof SITE_MOTION_PRESETS)[];
export type SiteMotionId = keyof typeof SITE_MOTION_PRESETS;

/** Preset ruchu po identyfikatorze — jedyne wejście do rejestru. */
export function motionPreset(id: SiteMotionId): SiteMotionPreset {
  return SITE_MOTION_PRESETS[id];
}
