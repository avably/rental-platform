/**
 * RUCH JAKO DANE MOTYWU (K6, ADR-092; silnik wymieniony w ADR-097).
 *
 * Wymaganie brzmiało: „animacje są CZĘŚCIĄ MOTYWU — dodanie motywu nr 7 nie
 * może wymagać nowych animacji w kodzie". Z tego wynika kształt tego pliku i
 * jedyna nietrywialna decyzja w nim zawarta:
 *
 *   JEST DOKŁADNIE JEDEN OPIS WEJŚCIA (reguły `site-reveal` w
 *   packages/ui/src/site/site.css), sparametryzowany zmiennymi. Preset ruchu
 *   nie jest nazwą animacji — jest KOMPLETEM LICZB, które ten jeden opis czyta.
 *   Motyw nr 7 wskazuje preset nazwą (albo dostaje nowy preset, czyli kolejny
 *   wiersz liczb), a arkusz zostaje bez zmian.
 *
 * Gdyby zamiast tego każdy motyw miał własne klatki albo własny skrypt,
 * „animacje jako dane" byłyby fikcją: dane wskazywałyby kod, który trzeba
 * dopisać razem z nimi.
 *
 * ============ DLACZEGO CZAS, A NIE PRZEWIJANIE (E9 addendum 2, ADR-097) ============
 *
 * K6 (ADR-092) postawiło wejście na osi widoku (`animation-timeline: view()`),
 * czyli na SCRUBIE: postęp animacji był funkcją pozycji przewijania. E9 dostroił
 * ten mechanizm dwa razy — najpierw długość strefy (jednostki okna zamiast fazy
 * `cover`), potem podmiot (pudełko treści zamiast pasa z marginesem) — i za
 * każdym razem POMIARY WYCHODZIŁY DOBRZE, a właściciel odrzucał wynik.
 *
 * Przyczyna jest w samym mechanizmie i widać ją dopiero, gdy postawi się obok
 * siebie dwa zdania:
 *
 *   • scrub NIE MA WŁASNEJ PRĘDKOŚCI. Ruch trwa tyle, ile czytelnik akurat
 *     przewinie; przy zwykłym obrocie kółka (~100 px) przebieg wykonuje się
 *     w kilku klatkach i czyta się jak przeskok, a nie jak wejście;
 *   • przy przewijaniu szarpanym (touchpad, trackpoint) animacja COFA SIĘ,
 *     bo cofa się scroll. Wejście, które da się odtworzyć w tył, nie jest
 *     wejściem.
 *
 * Wzorzec jakości wskazany przez właściciela — nasza własna strona marketingowa
 * — stoi na animacjach CZASOWYCH odpalanych wejściem elementu w okno. Preset
 * niesie więc odtąd CZAS TRWANIA, a nie zakres przewijania, i to jest zmiana
 * decyzji, a nie dostrojenie liczb (ADR-097).
 *
 * `prefers-reduced-motion` NIE jest tu polem — jest bramką w arkuszu ORAZ
 * warunkiem uzbrojenia skryptu, bo preferencja należy do czytelnika, a nie do
 * motywu. Motyw, który mógłby ją nadpisać, byłby danymi łamiącymi kontrakt
 * dostępności.
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
  /**
   * CZAS TRWANIA WEJŚCIA. Od ADR-097 pole ŻYWE: animacja jedzie na osi czasu,
   * więc ta liczba jest jedyną, która o jej długości decyduje. (W silniku
   * scrubowym z K6 było martwe — patrz dziennik E9 — i dlatego zostało wtedy
   * usunięte. Wraca razem z mechanizmem, który je czyta.)
   */
  duration: string;
  /** Krzywa czasowa. */
  easing: string;
  /** Przesunięcie startowe w pionie — 0 znaczy „sam przenik". */
  distance: string;
  /**
   * Krycie startowe. 1 znaczy „bez przeniku" i to jest jedyny sposób, w jaki
   * preset `still` może NAPRAWDĘ nic nie robić: gdyby krycie było wpisane
   * w regułę na sztywno, „bez ruchu" i tak przenikałoby przy każdym wejściu.
   */
  opacity: string;
  /**
   * OPÓŹNIENIE MIĘDZY NAGŁÓWKIEM A RESZTĄ pudełka treści. Dwa kroki, nie
   * kaskada po wszystkich dzieciach: sekcja ma trzy do ośmiu bloków, a kaskada
   * po każdym z nich znaczy, że ostatni wchodzi sekundę po pierwszym — czyli
   * czytelnik patrzy na sekcję, która wciąż się „składa". Nagłówek wchodzi
   * pierwszy, reszta o krok później i RAZEM.
   */
  stagger: string;
}

/**
 * Rejestr presetów ruchu. Kolejność bez znaczenia — to nie jest galeria,
 * operator nie wybiera ruchu osobno (wybiera motyw, ruch jest jego częścią).
 *
 * `still` istnieje, żeby motyw mógł powiedzieć „bez ruchu" DANYMI. Bez niego
 * jedyną drogą byłby wyjątek w arkuszu, czyli znów kod per motyw.
 *
 * KALIBRACJA (ADR-097): punktem odniesienia jest nasza strona marketingowa
 * (interakcje wejścia: 500–800 ms, krzywe z rodziny „ease-out", wjazdy do
 * ~100 px). Sekcje strony najemcy dostają ŚWIADOMIE mniej: 560–750 ms i
 * 24–40 px. Strona marketingowa ma jeden hero, który ma prawo zrobić wrażenie;
 * strona najemcy ma osiem sekcji, przez które ktoś przewija w drodze do
 * cennika — ten sam rozmach osiem razy z rzędu męczy.
 */
export const SITE_MOTION_PRESETS = {
  still: {
    mood: { pl: "Bez ruchu — treść stoi.", en: "No motion — content just sits." },
    duration: "0ms",
    easing: "linear",
    distance: "0px",
    opacity: "1",
    stagger: "0ms",
  },
  calm: {
    mood: { pl: "Spokojne podniesienie i przenik.", en: "A calm lift and fade." },
    duration: "700ms",
    // easeOutQuad — najłagodniejsze wyhamowanie z rodziny, bez cienia przeskoku.
    easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)",
    distance: "32px",
    opacity: "0",
    stagger: "110ms",
  },
  crisp: {
    mood: { pl: "Krótkie, rzeczowe wejście.", en: "Short, matter-of-fact entrance." },
    duration: "560ms",
    easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
    distance: "24px",
    opacity: "0",
    stagger: "80ms",
  },
  spring: {
    mood: { pl: "Sprężyste wejście z lekkim naddatkiem.", en: "Springy entrance with a slight overshoot." },
    duration: "620ms",
    /*
     * Naddatek NIESIE KRZYWA, a nie skala: pudełko treści ma szerokość pasa
     * czytelności, więc skala < 1 zwężałaby je względem sąsiadów i czytała się
     * jak drganie układu (pomiar E9 na owijce: `scale: 0.97` zabierało po ~4 px
     * z każdej strony pasa). Krzywa z przeskokiem daje ten sam charakter samym
     * przesunięciem — i dlatego `scale` w ogóle nie jest polem presetu.
     */
    easing: "cubic-bezier(0.34, 1.42, 0.64, 1)",
    distance: "28px",
    opacity: "0",
    stagger: "90ms",
  },
  editorial: {
    mood: { pl: "Powolne wynurzenie, jak przewracana strona.", en: "A slow surfacing, like a turning page." },
    duration: "750ms",
    // easeOutQuart — ta sama krzywa, na której stoją interakcje naszej strony
    // marketingowej; najdłuższe wyhamowanie, jakie zostawiamy sekcjom.
    easing: "cubic-bezier(0.165, 0.84, 0.44, 1)",
    distance: "40px",
    opacity: "0",
    stagger: "120ms",
  },
} as const satisfies Record<string, SiteMotionPreset>;

export const SITE_MOTIONS = Object.keys(SITE_MOTION_PRESETS) as unknown as readonly (keyof typeof SITE_MOTION_PRESETS)[];
export type SiteMotionId = keyof typeof SITE_MOTION_PRESETS;

/** Preset ruchu po identyfikatorze — jedyne wejście do rejestru. */
export function motionPreset(id: SiteMotionId): SiteMotionPreset {
  return SITE_MOTION_PRESETS[id];
}
