/**
 * KROJE STRONY NAJEMCY — REJESTR RODZIN I PAR (K5, ADR-090).
 *
 * ================== DLACZEGO PLIKI, A NIE STOS SYSTEMOWY ==================
 *
 * Pierwsze podejście do K5 stawiało pary na krojach SYSTEMOWYCH („Iowan Old
 * Style", „Avenir Next", stos awaryjny). Było to bezpieczne i bezpłatne, ale
 * kosztowało dokładnie to, po co powstają motywy: strona wyglądała inaczej na
 * macOS, inaczej na Windowsie i inaczej na Androidzie, a „szablon artystyczny
 * z serifem" na maszynie bez tego serifa był zwykłym Arialem. Motyw, którego
 * nie da się zobaczyć, nie jest motywem.
 *
 * Kroje są więc PLIKAMI W REPO (packages/ui/fonts), na licencji SIL OFL 1.1,
 * serwowanymi z NASZEGO origin. Zewnętrznego hosta krojów nie ma i nie będzie
 * (ADR-082): przeglądarka klienta najemcy nie ma się łączyć z niczym poza nami
 * ani przy pierwszym malowaniu, ani nigdy. Licencja każdej rodziny leży obok
 * plików (`OFL-*.txt`) — OFL wymaga dołączenia jej treści do redystrybucji,
 * a plik fontu bez licencji obok jest redystrybucją niezgodną z licencją.
 *
 * ============== DLACZEGO @font-face, A NIE next/font/local ==============
 *
 * Brief przewidywał `next/font/local`. Odrzucone świadomie, z dwóch powodów,
 * i to jest odejście od litery zadania warte zapisania:
 *
 *   1. DWA SUBSETY NA RODZINĘ. Polski wymaga zakresu `latin-ext` (ą, ć, ę, ł,
 *      ń, ś, ź, ż), a angielski nie. `next/font/local` nie umie opisać
 *      `unicode-range` per plik w obrębie jednej rodziny — musiałby dostać
 *      jeden plik ze wszystkimi znakami i zmusić czytelnika strony angielskiej
 *      do pobrania polskich diakrytyków. @font-face z `unicode-range` pobiera
 *      wyłącznie ten subset, którego wymaga TEKST na stronie.
 *   2. MOTYW MA BYĆ DANYMI. `next/font/local` woła się z kodu APLIKACJI, a
 *      renderer strony żyje w dwóch aplikacjach naraz (panel i sklep). Dopisanie
 *      motywu nr 7 z nową rodziną znaczyłoby zmianę w OBU — czyli dokładnie to,
 *      czego zakazuje decyzja właściciela („dodanie szablonu nie może wymagać
 *      zmian w silniku"). Przy arkuszu w @avably/ui nową rodzinę dopisuje się
 *      w JEDNYM miejscu, a obie aplikacje dostają ją przez istniejący import.
 *
 * Cena tej decyzji jest jedna i jawna: tracimy `size-adjust` z metryk zastępczych,
 * które `next/font` liczy sam. Stąd `font-display: swap` i stosy awaryjne dobrane
 * po klasie kroju (grotesk → sans systemowy, szeryfowy → serif systemowy).
 *
 * Rozjazdu rejestru z arkuszem i z plikami na dysku pilnuje kontrakt
 * (`fonts-contract.test.ts`): rodzina bez @font-face, @font-face bez pliku
 * i plik bez wpisu w rejestrze są czerwone.
 */

/** Stosy awaryjne — kończą się rodziną GENERYCZNĄ, inaczej jedna nieznana nazwa unieważnia deklarację. */
const SANS_FALLBACK = "ui-sans-serif, system-ui, sans-serif";
const SERIF_FALLBACK = "ui-serif, Georgia, serif";

export interface FontFamilyTokens {
  /** Nazwa rodziny w CSS — ta sama, co w `@font-face` arkusza @avably/ui. */
  family: string;
  /** Stos awaryjny dopisywany za rodziną. */
  fallback: string;
  /**
   * Podstawa nazw plików w packages/ui/fonts: `<slug>-latin.woff2` i
   * `<slug>-latin-ext.woff2`. `null` = rodzina bez plików (stos systemowy,
   * używany wyłącznie przez motywy zastane).
   */
  slug: string | null;
  /** Zakres wag pliku zmiennego (`font-weight` w @font-face). */
  weight: string;
  /** Nazwa pliku licencji obok plików kroju — wymóg OFL przy redystrybucji. */
  license: string | null;
  /**
   * SZEROKOŚĆ ZNAKU względem kroju BAZOWEGO, dla którego skalibrowany jest
   * estymator wierszy (`text-metrics.ts`, ADR-088). Wartość < 1 znaczy krój
   * SZERSZY (mieści mniej znaków w wierszu), > 1 — węższy.
   *
   * Po co: kompozycje szablonów startowych liczą wysokość pudełka nagłówka
   * z góry, a estymator nie wie, w jakim kroju stanie tekst. Bez tej liczby
   * plakatowy Archivo wychodził poza pudełko (nagłówek wchodził w akapit),
   * a wąski Instrument Serif zostawiał pod sobą pół ekranu pustki. Liczba
   * jest własnością RODZINY, nie motywu — dlatego stoi tutaj.
   */
  metricRatio: number;
}

/**
 * RODZINY. Osiem plików + jedna pozycja systemowa dla stron zastanych.
 * Wszystkie na SIL OFL 1.1 — sprawdzone co do pliku licencji przy pobraniu.
 */
export const FONT_FAMILIES = {
  inter: { family: "Inter Site", fallback: SANS_FALLBACK, slug: "inter", weight: "100 900", license: "OFL-inter.txt", metricRatio: 1.0 },
  "inter-tight": { family: "Inter Tight Site", fallback: SANS_FALLBACK, slug: "inter-tight", weight: "100 900", license: "OFL-intertight.txt", metricRatio: 1.05 },
  archivo: { family: "Archivo Site", fallback: SANS_FALLBACK, slug: "archivo", weight: "100 900", license: "OFL-archivo.txt", metricRatio: 0.86 },
  "space-grotesk": { family: "Space Grotesk Site", fallback: SANS_FALLBACK, slug: "space-grotesk", weight: "300 700", license: "OFL-spacegrotesk.txt", metricRatio: 0.9 },
  outfit: { family: "Outfit Site", fallback: SANS_FALLBACK, slug: "outfit", weight: "100 900", license: "OFL-outfit.txt", metricRatio: 0.95 },
  "dm-sans": { family: "DM Sans Site", fallback: SANS_FALLBACK, slug: "dm-sans", weight: "100 1000", license: "OFL-dmsans.txt", metricRatio: 0.98 },
  "playfair-display": { family: "Playfair Display Site", fallback: SERIF_FALLBACK, slug: "playfair-display", weight: "400 900", license: "OFL-playfairdisplay.txt", metricRatio: 0.95 },
  "instrument-serif": { family: "Instrument Serif Site", fallback: SERIF_FALLBACK, slug: "instrument-serif", weight: "400", license: "OFL-instrumentserif.txt", metricRatio: 1.15 },
  /*
   * DWIE RODZINY DOPISANE W E9 (addendum 2), po odrzuceniu przez właściciela
   * krojów motywów `velocity` i `atelier`.
   *
   * Podmiana na rodzinę Z ZAPASU była tańsza i została odrzucona świadomie:
   * rejestr ma sześć par na sześć motywów w relacji 1:1, więc każda podmiana
   * dawałaby DWA światy z tym samym krojem nagłówkowym — czyli dokładnie ten
   * sygnał szablonowości, który mamy usuwać.
   *
   * `metricRatio` OBU DOBRANY, A NIE ZMIERZONY — i to jest ważne rozróżnienie.
   * Pomiar szerokości tego samego napisu w przeglądarce (E9, 48 px/700, plik
   * `metryka-krojow-e9.mjs`) daje rozrzut 0,99–1,05 dla rodzin, którym rejestr
   * przypisuje 0,86–1,15. Wartości w tym rejestrze nie są więc stosunkiem
   * szerokości znaku, tylko ZAPASEM dobranym tak, żeby estymator nie wypuszczał
   * nagłówka poza pudełko (Archivo) ani nie zostawiał pod nim pustki
   * (Instrument Serif). Nowe rodziny dostają wartości z tej samej skali,
   * wstawione względem sąsiadów: Saira jest zwężona (więcej znaków w wierszu →
   * wyżej), Fraunces szeroka (mniej znaków → niżej). Sprawdzianem jest kontrakt
   * geometrii mobilnej szablonów i akcept wizualny pierwszego ekranu.
   */
  saira: { family: "Saira Site", fallback: SANS_FALLBACK, slug: "saira", weight: "100 900", license: "OFL-saira.txt", metricRatio: 1.1 },
  fraunces: { family: "Fraunces Site", fallback: SERIF_FALLBACK, slug: "fraunces", weight: "100 900", license: "OFL-fraunces.txt", metricRatio: 0.92 },
  /**
   * Kroje aplikacji — to, czym strona najemcy była do K5. Bez plików: rodzina
   * przychodzi z `next/font/google` w obu aplikacjach (zmienna `--font-geist-sans`)
   * i to się nie zmienia, bo strony zastane mają wyglądać BEZ ZMIAN.
   */
  system: { family: "var(--font-geist-sans, \"Geist\")", fallback: SANS_FALLBACK, slug: null, weight: "100 900", license: null, metricRatio: 1.0 },
} as const satisfies Record<string, FontFamilyTokens>;

export type FontFamilyId = keyof typeof FONT_FAMILIES;

/** Pełna wartość `font-family` dla rodziny — z cudzysłowem i stosem awaryjnym. */
export function fontStack(id: FontFamilyId): string {
  const font = FONT_FAMILIES[id];
  // Rodzina systemowa jest już wyrażeniem `var(...)`, więc cudzysłów by ją zepsuł.
  const name = font.slug === null ? font.family : `"${font.family}"`;
  return `${name}, ${font.fallback}`;
}

export interface FontPairTokens {
  heading: FontFamilyId;
  body: FontFamilyId;
  /** Etykieta pary w panelu „Styl strony" — dane, jak `mood` motywu. */
  label: { pl: string; en: string };
}

/**
 * PARY KROJÓW. Operator może podmienić parę w ramach dowolnego motywu (panel
 * „Styl strony"), więc lista jest WSPÓLNA dla wszystkich motywów, a motyw
 * wskazuje tylko swoją domyślną. Para `system` nie pokazuje się do wyboru —
 * istnieje dla stron zastanych.
 */
export const FONT_PAIRS = {
  poster: { heading: "archivo", body: "inter", label: { pl: "Plakatowa", en: "Poster" } },
  sport: { heading: "space-grotesk", body: "inter", label: { pl: "Sportowa", en: "Sport" } },
  playful: { heading: "outfit", body: "dm-sans", label: { pl: "Wesoła", en: "Playful" } },
  editorial: { heading: "playfair-display", body: "inter", label: { pl: "Magazynowa", en: "Editorial" } },
  warm: { heading: "instrument-serif", body: "inter", label: { pl: "Ciepła", en: "Warm" } },
  tech: { heading: "inter-tight", body: "inter", label: { pl: "Techniczna", en: "Technical" } },
  /* Zwężony grotesk o atletycznej proporcji — tempo bez ozdobników (E9). */
  track: { heading: "saira", body: "inter", label: { pl: "Torowa", en: "Track" } },
  /* Szeroka szeryfowa o wysokim x-height — ciepło z zapasem wag (E9). */
  workshop: { heading: "fraunces", body: "inter", label: { pl: "Warsztatowa", en: "Workshop" } },
  system: { heading: "system", body: "system", label: { pl: "Systemowa", en: "System" } },
} as const satisfies Record<string, FontPairTokens>;

export type SiteFontPair = keyof typeof FONT_PAIRS;

export const SITE_FONT_PAIRS = Object.keys(FONT_PAIRS) as unknown as readonly SiteFontPair[];

/** Pary DO WYBORU w panelu — bez pozycji zastanej. */
export const SELECTABLE_FONT_PAIRS = SITE_FONT_PAIRS.filter((id) => id !== "system");

/**
 * Względna szerokość znaku kroju NAGŁÓWKOWEGO pary — wejście zapasu, który
 * kompozycje szablonów doliczają do wysokości pudełek (patrz `metricRatio`).
 */
export function headingMetricRatio(id: SiteFontPair): number {
  return FONT_FAMILIES[FONT_PAIRS[id].heading].metricRatio;
}

export function fontPairStacks(id: SiteFontPair): { heading: string; body: string } {
  const pair = FONT_PAIRS[id];
  return { heading: fontStack(pair.heading), body: fontStack(pair.body) };
}
