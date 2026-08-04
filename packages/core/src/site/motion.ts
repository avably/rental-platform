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
  /** Czas trwania wejścia (używany, gdy oś czasu jest ZWYKŁA — patrz `range`). */
  duration: string;
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
   * Zakres osi widoku (`animation-range`), w którym wejście się rozgrywa.
   * `entry 0% cover 35%` = sekcja kończy animację, zanim wjedzie w tercję
   * ekranu — czytelnik nie ogląda przesuwających się liter pod kursorem.
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
    duration: "0ms",
    easing: "linear",
    distance: "0px",
    scale: "1",
    opacity: "1",
    range: "entry 0% entry 0%",
  },
  calm: {
    mood: { pl: "Spokojne podniesienie i przenik.", en: "A calm lift and fade." },
    duration: "620ms",
    easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    distance: "18px",
    scale: "1",
    opacity: "0",
    range: "entry 0% cover 35%",
  },
  crisp: {
    mood: { pl: "Krótkie, rzeczowe wejście.", en: "Short, matter-of-fact entrance." },
    duration: "360ms",
    easing: "cubic-bezier(0.16, 1, 0.3, 1)",
    distance: "10px",
    scale: "1",
    opacity: "0",
    range: "entry 0% cover 26%",
  },
  spring: {
    mood: { pl: "Sprężyste wejście z lekkim naddatkiem.", en: "Springy entrance with a slight overshoot." },
    duration: "520ms",
    easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
    distance: "14px",
    scale: "0.97",
    opacity: "0",
    range: "entry 0% cover 32%",
  },
  editorial: {
    mood: { pl: "Powolne wynurzenie, jak przewracana strona.", en: "A slow surfacing, like a turning page." },
    duration: "760ms",
    easing: "cubic-bezier(0.33, 1, 0.68, 1)",
    distance: "26px",
    scale: "1",
    opacity: "0",
    range: "entry 0% cover 42%",
  },
} as const satisfies Record<string, SiteMotionPreset>;

export const SITE_MOTIONS = Object.keys(SITE_MOTION_PRESETS) as unknown as readonly (keyof typeof SITE_MOTION_PRESETS)[];
export type SiteMotionId = keyof typeof SITE_MOTION_PRESETS;

/** Preset ruchu po identyfikatorze — jedyne wejście do rejestru. */
export function motionPreset(id: SiteMotionId): SiteMotionPreset {
  return SITE_MOTION_PRESETS[id];
}
