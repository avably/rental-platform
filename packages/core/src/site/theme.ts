/**
 * MOTYWY STRONY — KAŻDY SZABLON TO OSOBNY ŚWIAT (K5, ADR-090).
 *
 * ===================== CO SIĘ ZMIENIŁO I DLACZEGO =====================
 *
 * Pierwsze podejście do K5 miało DWA szablony graficzne (`classic`, `bold`)
 * i sześć akcentów: strona zmieniała kolor jednego elementu, a resztę wyglądu
 * dziedziczyła po motywie APLIKACJI (`--background`, `--card`, `--foreground`
 * z packages/ui/src/styles.css). Konsekwencja była taka, że każda strona każdego
 * najemcy stała na tym samym papierze, w tej samej typografii i z tymi samymi
 * zaokrągleniami — a „szablon" znaczył najwyżej inny zestaw klas na tych samych
 * kolorach. Właściciel odrzucił ten model 2026-08-03: szablony mają być RÓŻNYMI
 * ŚWIATAMI, od białego minimalizmu po ciemny luksus na pełnej fotografii.
 *
 * Motyw jest więc DANYMI, nie kodem. Ten plik jest rejestrem: paleta pasów,
 * para krojów, promienie, styl przycisku i charakter typografii — wszystko jako
 * wartości. Render zamienia je na zmienne CSS (`themeTokensFor`), arkusz
 * @avably/ui przełącza je per PAS, a komponenty sekcji nie znają ANI JEDNEGO
 * heksa. Warunek postawiony wprost przez właściciela: system ma unieść
 * MINIMUM 15 motywów, a dopisanie motywu nr 7 nie może wymagać zmiany w
 * silniku — ma być kolejnym wpisem w tej stałej.
 *
 * ================== DLACZEGO STRONA NIE DZIEDZICZY MOTYWU APLIKACJI ==================
 *
 * Do K5 pas sekcji brał kolor z tokenu aplikacji, więc jasność pasa zależała od
 * tego, czy panel stoi w trybie jasnym, czy ciemnym — i macierz kontrastu
 * musiała mieć osobny wymiar „motyw hosta" (light/dark), w którym połowa komórek
 * opisywała stany, których nikt nigdy nie oglądał (żadna z aplikacji nie włącza
 * dziś klasy `.dark`). Od teraz KAŻDY pas ma kolor WŁASNY, wprost z motywu
 * strony. Zyski są trzy i wszystkie policzalne:
 *
 *   1. sklep wygląda tak samo niezależnie od tego, w czym renderuje się panel —
 *      płótno kreatora jest wreszcie dowodem na to, co zobaczy klient;
 *   2. macierz kontrastu traci cały wymiar, a zyskuje wymiar MOTYWU, czyli ten,
 *      który naprawdę rozstrzyga o czytelności;
 *   3. motyw ciemny („luksus na fotografii") przestaje być hakiem na pas
 *      odwrócony i staje się zwykłym wpisem w rejestrze.
 *
 * ====================== PAS DECYDUJE O WARIANCIE AKCENTU ======================
 *
 * Kolor akcentu czytelny na papierze (#FBF7F0) ma niską jasność; ten sam kolor
 * na pasie ciemnym (#0A0A0B) jest nieczytelny — a kolor czytelny na obu naraz
 * nie istnieje. Każdy akcent ma więc rodzinę w dwóch wariantach (`paper`, `ink`),
 * a to, KTÓRY obowiązuje, deklaruje PAS w rejestrze (`accent: "paper" | "ink"`).
 * Renderer nie zgaduje: wystawia dla każdego pasa gotową trójkę zmiennych,
 * a arkusz tylko wskazuje na nią klasą pasa. Dzięki temu motyw, w którym pas
 * „odwrócony" jest JAŚNIEJSZY od strony (tak stoi `industrial-noir`), nie
 * wymaga ani jednej reguły w CSS — wymaga jednego pola w danych.
 */
import { z } from "zod";

import { relativeLuminance } from "./contrast";
import { type SiteFontPair } from "./fonts";
import { type SiteMotionId } from "./motion";

// -----------------------------------------------------------------------
// Pasy
// -----------------------------------------------------------------------

/**
 * PASY, na których stoi treść. Trzy pierwsze to tła sekcji z modelu treści
 * (`SECTION_BACKGROUNDS` w elements.ts — operator wybiera je w kreatorze),
 * czwarty to karta produktu, która jest własną powierzchnią w każdym motywie.
 * Kompletności rejestru względem modelu treści pilnuje kontrakt kontrastu:
 * tło sekcji dodane tam, a nieopisane tutaj, znaczy pas bez zdefiniowanego
 * koloru — i, co gorsza, pas, po którym macierz kontrastu NIE CHODZI.
 */
export const THEME_BAND_KEYS = ["default", "muted", "inverted", "card"] as const;
export type ThemeBandKey = (typeof THEME_BAND_KEYS)[number];

/** Wariant akcentu — po jasności PASA, nie po motywie (patrz nagłówek). */
export const ACCENT_VARIANTS = ["paper", "ink"] as const;
export type AccentVariant = (typeof ACCENT_VARIANTS)[number];

export interface AccentTokens {
  /** Wypełnienie: przycisk `solid`, kształt `accent`, kafelek ikony. */
  fill: string;
  /** Kolor tekstu NA wypełnieniu. */
  onFill: string;
  /** Akcentowy TEKST na pasie tego wariantu. */
  text: string;
}

export interface ThemeBand {
  /** Tło pasa. */
  surface: string;
  /** Tekst podstawowy na tym pasie. */
  ink: string;
  /** Tekst drugorzędny (lead, podpisy) — musi trzymać próg tekstowy, nie duży. */
  inkMuted: string;
  /** Kreski: obrys karty, linia pod pozycją FAQ. Próg nietekstowy. */
  border: string;
  /** Który wariant akcentu obowiązuje na tym pasie. */
  accent: AccentVariant;
}

// -----------------------------------------------------------------------
// Kształt i charakter
// -----------------------------------------------------------------------

/**
 * KSZTAŁT motywu. Zamknięte słowniki zamiast dowolnych wartości: przycisk
 * `pill` w jednym motywie i `square` w drugim to różnica, którą widać, a
 * dowolna liczba w polu `radius` byłaby wartością, której nikt nie sprawdzi
 * ani nie odtworzy. Wartości idą do CSS jako zmienne, więc komponent nie ma
 * gałęzi „jeśli motyw X".
 */
export const BUTTON_SHAPES = ["square", "rounded", "pill"] as const;
export type ButtonShape = (typeof BUTTON_SHAPES)[number];

/** Wypełnienie przycisku pierwszorzędnego — pełne albo sam obrys. */
export const BUTTON_FILLS = ["solid", "outline"] as const;
export type ButtonFill = (typeof BUTTON_FILLS)[number];

export interface ThemeShape {
  /** Promień kart, obrazów i kafli (CSS length). */
  radius: string;
  /** Promień dużych powierzchni (baner CTA, hero). */
  radiusLarge: string;
  /** Grubość kresek — 1px w motywach powściągliwych, 2px w mocnych. */
  borderWidth: string;
  button: ButtonShape;
  buttonFill: ButtonFill;
}

/**
 * CHARAKTER TYPOGRAFII. Świadomie NIE ma tu skali rozmiarów: rozmiary płótna
 * liczy estymator pudełek (`text-metrics.ts`, K4/ADR-088) i mnożnik per motyw
 * rozjechałby wysokość pudełka z wysokością tekstu w nim — czyli przywrócił
 * dokładnie tę wadę, którą K4 usunęło. Motyw różnicuje więc WAGĘ, ŚWIATŁO
 * MIĘDZYLITEROWE i WIELKOŚĆ LITER, a nie rozmiar.
 */
export interface ThemeType {
  /** Waga nagłówka głównego (hero). */
  displayWeight: string;
  /** Światło międzyliterowe nagłówków — ujemne w groteskach, dodatnie w kapitalikach. */
  displayTracking: string;
  /** `uppercase` w motywach plakatowych, `none` w resztę. */
  displayTransform: string;
  /** Waga nagłówków sekcji i tytułów. */
  headingWeight: string;
  /** Waga tekstu ciągłego — 300 w motywach lekkich, 400 domyślnie. */
  bodyWeight: string;
  /** Światło i wielkość liter etykiety „eyebrow" oraz małych podpisów. */
  eyebrowTracking: string;
  eyebrowTransform: string;
}

// -----------------------------------------------------------------------
// Motyw
// -----------------------------------------------------------------------

export interface SiteThemeTokens {
  /**
   * Nazwa dyrekcji wizualnej — jedno zdanie po polsku i po angielsku, widoczne
   * w galerii szablonów. Trzymamy je przy DANYCH motywu, a nie w słownikach
   * panelu, bo to jest opis rzeczy, która tu mieszka; słownik panelu opisywałby
   * ją z drugiej strony repozytorium i rozjechałby się przy pierwszej zmianie
   * palety (ta sama zasada, co treść szablonów startowych: dane, nie klucze).
   */
  mood: { pl: string; en: string };
  bands: Record<ThemeBandKey, ThemeBand>;
  /**
   * Paleta akcentów TEGO motywu. Operator wybiera z niej w panelu „Styl strony";
   * akcent spoza palety motywu nie istnieje, bo nikt nie policzył jego kontrastu
   * na TYCH pasach. Wariant (`paper`/`ink`) jest wymagany dokładnie dla tych
   * wariantów, których używa którykolwiek pas motywu — kontrakt wyprowadza to
   * z `bands`, więc motyw bez pasa ciemnego nie musi wymyślać wartości `ink`.
   */
  accents: Record<string, Partial<Record<AccentVariant, AccentTokens>>>;
  /** Akcent, który dostaje strona, dopóki operator nie wybierze innego. */
  defaultAccent: string;
  /**
   * SYGNAŁ BŁĘDU (K6, ADR-092). Ta sama trójka tokenów co akcent i ten sam
   * podział na warianty — bo problem jest ten sam: czerwień czytelna na
   * papierze jest niewidoczna na czerni, a odwrotnie. Osobne pole, a nie
   * kolejny wpis w `accents`, bo `danger` NIE jest do wyboru: operator nie
   * maluje nim strony, on niesie komunikat „coś nie wyszło" w koszyku i w
   * formularzu kasy.
   */
  danger: Partial<Record<AccentVariant, AccentTokens>>;
  /**
   * RUCH motywu — identyfikator presetu z rejestru `./motion`. Motyw nie
   * opisuje animacji, tylko ją WSKAZUJE; dzięki temu motyw nr 7 nie wnosi
   * żadnych klatek kluczowych (ADR-092).
   */
  motion: SiteMotionId;
  /** Para krojów motywu (identyfikator z rejestru `./fonts`). */
  fontPair: SiteFontPair;
  shape: ThemeShape;
  type: ThemeType;
  /**
   * Motyw ZASTANY: odtwarza wygląd sprzed ADR-090 dla stron, które powstały
   * przed wprowadzeniem motywów. Nie pokazuje się w galerii szablonów i nie
   * da się go wybrać — istnieje wyłącznie po to, żeby opublikowana strona
   * najemcy nie zmieniła ani jednego piksela w dniu wdrożenia.
   */
  legacy?: true;
}

/**
 * SYGNAŁ BŁĘDU — WSPÓLNY DLA WSZYSTKICH MOTYWÓW (K6, ADR-092).
 *
 * Jedna czerwień w całym rejestrze jest decyzją, nie oszczędnością: „nie
 * wyszło" to komunikat systemu, a nie element dyrekcji wizualnej. Motyw, który
 * malowałby błąd swoim akcentem, uczyłby klienta, że czerwony w jednym sklepie
 * znaczy „uwaga", a w drugim „promocja". Pole jest mimo to per motyw (a nie
 * globalną stałą w arkuszu), bo motyw MOŻE mieć powód, żeby je nadpisać —
 * i wtedy nadpisanie przechodzi przez ten sam kontrakt kontrastu, co reszta.
 *
 * Dwa warianty z tego samego powodu co przy akcentach: czerwień czytelna na
 * papierze jest plamą na czerni.
 */
const DANGER: SiteThemeTokens["danger"] = {
  paper: { fill: "#B3261E", onFill: "#FFFFFF", text: "#A0231C" },
  ink: { fill: "#FF6B61", onFill: "#2A0603", text: "#FF9A90" },
};

/**
 * Kolory zastane — lustro motywu JASNEGO aplikacji (packages/ui/src/styles.css).
 * Przepisane tu jako wartości, a nie `var(--background)`, i to jest sedno
 * zmiany: strona najemcy przestaje dziedziczyć paletę panelu. Rozjazd z
 * arkuszem nie jest już wadą — motywy zastane mają zostać takie, jakie były
 * w dniu ADR-090, nawet gdy paleta panelu pójdzie dalej.
 */
const LEGACY = {
  paper: "#F4F6F5",
  ink: "#0B1017",
  card: "#FFFFFF",
  muted: "#E9ECEA",
  mutedInk: "#55616D",
  border: "#7E8994",
  inkMuted: "#B8C0C5",
} as const;

/** Akcenty motywów zastanych — paleta z pierwszego podejścia do K5, bez zmian. */
const LEGACY_ACCENTS: SiteThemeTokens["accents"] = {
  ink: {
    paper: { fill: "#0B1017", onFill: "#FFFFFF", text: "#0B1017" },
    ink: { fill: "#F4F6F5", onFill: "#0B1017", text: "#F4F6F5" },
  },
  forest: {
    paper: { fill: "#1B5E43", onFill: "#FFFFFF", text: "#14503A" },
    ink: { fill: "#7FD9B4", onFill: "#04241A", text: "#7FD9B4" },
  },
  ocean: {
    paper: { fill: "#14557F", onFill: "#FFFFFF", text: "#0F4A70" },
    ink: { fill: "#7FC8F0", onFill: "#04222F", text: "#7FC8F0" },
  },
  plum: {
    paper: { fill: "#6A3382", onFill: "#FFFFFF", text: "#5E2C74" },
    ink: { fill: "#D6A6EC", onFill: "#2A1236", text: "#D6A6EC" },
  },
  amber: {
    paper: { fill: "#8A5300", onFill: "#FFFFFF", text: "#7A4900" },
    ink: { fill: "#F0BE6A", onFill: "#2E1B00", text: "#F0BE6A" },
  },
  crimson: {
    paper: { fill: "#A32235", onFill: "#FFFFFF", text: "#8F1D2E" },
    ink: { fill: "#F29AA8", onFill: "#2E0710", text: "#F29AA8" },
  },
};

/** Charakter typografii stron zastanych — dokładnie to, czym była do K5. */
const LEGACY_TYPE: ThemeType = {
  displayWeight: "500",
  displayTracking: "-0.04em",
  displayTransform: "none",
  headingWeight: "500",
  bodyWeight: "400",
  eyebrowTracking: "0.2em",
  eyebrowTransform: "uppercase",
};

/**
 * REJESTR MOTYWÓW. Kolejność jest kolejnością w galerii; motywy zastane stoją
 * na końcu i są z galerii wykluczone (`legacy`).
 *
 * Sześć światów dobrano tak, żeby leżały OD SIEBIE JAK NAJDALEJ — dwa warianty
 * tego samego jasnego minimalizmu nie dają operatorowi wyboru, tylko iluzję
 * wyboru. Stąd: czarny plakat, jasny sport, pastelowy playful, ciemny luksus,
 * ciepły papier i chłodny tech.
 */
export const SITE_THEME_TOKENS = {
  // -------------------------------------------------------------------
  // 1. Czarny plakat — budowlanka i sprzęt ciężki.
  // -------------------------------------------------------------------
  "industrial-noir": {
    mood: {
      pl: "Czarny plakat: wielka typografia, ostre krawędzie, ostrzegawczy amber.",
      en: "Black poster: oversized type, hard edges, warning amber.",
    },
    bands: {
      default: { surface: "#0E0E0E", ink: "#F5F3EF", inkMuted: "#A9A49C", border: "#2C2C2A", accent: "ink" },
      muted: { surface: "#191918", ink: "#F5F3EF", inkMuted: "#A9A49C", border: "#333331", accent: "ink" },
      // Pas „odwrócony" jest tu JAŚNIEJSZY od strony — możliwe wyłącznie
      // dlatego, że wariant akcentu jest polem danych, a nie regułą w CSS.
      inverted: { surface: "#F5F3EF", ink: "#0E0E0E", inkMuted: "#54514B", border: "#D6D2CA", accent: "paper" },
      card: { surface: "#191918", ink: "#F5F3EF", inkMuted: "#A9A49C", border: "#333331", accent: "ink" },
    },
    accents: {
      amber: {
        ink: { fill: "#F5B335", onFill: "#1A1200", text: "#F5B335" },
        paper: { fill: "#8A5300", onFill: "#FFFFFF", text: "#6F4300" },
      },
      signal: {
        ink: { fill: "#FF7A33", onFill: "#220D00", text: "#FF9257" },
        paper: { fill: "#A33B00", onFill: "#FFFFFF", text: "#8C3300" },
      },
      bone: {
        ink: { fill: "#F5F3EF", onFill: "#0E0E0E", text: "#F5F3EF" },
        paper: { fill: "#0E0E0E", onFill: "#F5F3EF", text: "#0E0E0E" },
      },
    },
    defaultAccent: "amber",
    danger: DANGER,
    motion: "crisp",
    fontPair: "poster",
    shape: { radius: "0px", radiusLarge: "0px", borderWidth: "1px", button: "square", buttonFill: "solid" },
    type: {
      displayWeight: "800",
      displayTracking: "-0.03em",
      displayTransform: "uppercase",
      headingWeight: "700",
      bodyWeight: "400",
      eyebrowTracking: "0.28em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // 2. Jasny sport — rowery, narty, sprzęt wodny.
  // -------------------------------------------------------------------
  velocity: {
    mood: {
      pl: "Jasny beton i elektryczny akcent: wysoki kontrast, tempo, zero ozdobników.",
      en: "Bright concrete with an electric accent: high contrast, pace, no ornament.",
    },
    bands: {
      default: { surface: "#F3F4F2", ink: "#101312", inkMuted: "#4C5350", border: "#D3D7D3", accent: "paper" },
      muted: { surface: "#E4E8E4", ink: "#101312", inkMuted: "#495049", border: "#C8CDC8", accent: "paper" },
      inverted: { surface: "#101312", ink: "#F3F4F2", inkMuted: "#A3ABA6", border: "#2A2F2D", accent: "ink" },
      card: { surface: "#FFFFFF", ink: "#101312", inkMuted: "#4C5350", border: "#C9CEC9", accent: "paper" },
    },
    accents: {
      lime: {
        paper: { fill: "#4C6100", onFill: "#FFFFFF", text: "#425400" },
        ink: { fill: "#C6F24A", onFill: "#141B00", text: "#C6F24A" },
      },
      cobalt: {
        paper: { fill: "#1D4ED8", onFill: "#FFFFFF", text: "#1A45C0" },
        ink: { fill: "#8AB4FF", onFill: "#04122E", text: "#8AB4FF" },
      },
      ink: {
        paper: { fill: "#101312", onFill: "#F3F4F2", text: "#101312" },
        ink: { fill: "#F3F4F2", onFill: "#101312", text: "#F3F4F2" },
      },
    },
    defaultAccent: "lime",
    danger: DANGER,
    motion: "crisp",
    fontPair: "sport",
    shape: { radius: "2px", radiusLarge: "4px", borderWidth: "2px", button: "square", buttonFill: "solid" },
    type: {
      displayWeight: "700",
      displayTracking: "-0.035em",
      displayTransform: "none",
      headingWeight: "700",
      bodyWeight: "400",
      eyebrowTracking: "0.22em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // 3. Pastelowy playful — eventy, wesela, dmuchańce, namioty.
  // -------------------------------------------------------------------
  confetti: {
    mood: {
      pl: "Pastelowy i wesoły: kremowy papier, miękkie kształty, cukierkowy akcent.",
      en: "Pastel and playful: cream paper, soft shapes, candy accent.",
    },
    bands: {
      default: { surface: "#FFF8F2", ink: "#2B1D2F", inkMuted: "#6A5A6D", border: "#F1DFD0", accent: "paper" },
      muted: { surface: "#FDECF2", ink: "#2B1D2F", inkMuted: "#6A5A6D", border: "#EFC7DA", accent: "paper" },
      inverted: { surface: "#2B1D2F", ink: "#FFF8F2", inkMuted: "#C4B4C6", border: "#463349", accent: "ink" },
      card: { surface: "#FFFFFF", ink: "#2B1D2F", inkMuted: "#6A5A6D", border: "#E3CBD7", accent: "paper" },
    },
    accents: {
      berry: {
        paper: { fill: "#B01B62", onFill: "#FFFFFF", text: "#9A1755" },
        ink: { fill: "#FF8FBE", onFill: "#33001A", text: "#FF9EC7" },
      },
      tangerine: {
        paper: { fill: "#9C4A00", onFill: "#FFFFFF", text: "#8A4100" },
        ink: { fill: "#FFB067", onFill: "#2E1300", text: "#FFB067" },
      },
      violet: {
        paper: { fill: "#6A3AB2", onFill: "#FFFFFF", text: "#5E33A0" },
        ink: { fill: "#C9A8FF", onFill: "#220B45", text: "#D3B6FF" },
      },
    },
    defaultAccent: "berry",
    danger: DANGER,
    motion: "spring",
    fontPair: "playful",
    shape: { radius: "20px", radiusLarge: "32px", borderWidth: "1px", button: "pill", buttonFill: "solid" },
    type: {
      displayWeight: "700",
      displayTracking: "-0.02em",
      displayTransform: "none",
      headingWeight: "600",
      bodyWeight: "400",
      eyebrowTracking: "0.16em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // 4. Ciemny luksus — sprzęt foto/wideo, studia, oświetlenie.
  // -------------------------------------------------------------------
  "noir-lux": {
    mood: {
      pl: "Ciemny luksus na pełnej fotografii: czerń, szeryfowy nagłówek, szampański akcent.",
      en: "Dark luxury over full-bleed photography: black, serif display, champagne accent.",
    },
    bands: {
      default: { surface: "#0A0A0B", ink: "#EFEBE4", inkMuted: "#9C958A", border: "#242426", accent: "ink" },
      muted: { surface: "#121214", ink: "#EFEBE4", inkMuted: "#9C958A", border: "#2B2B2E", accent: "ink" },
      inverted: { surface: "#EFEBE4", ink: "#0A0A0B", inkMuted: "#57534B", border: "#D5CFC4", accent: "paper" },
      card: { surface: "#121214", ink: "#EFEBE4", inkMuted: "#9C958A", border: "#2B2B2E", accent: "ink" },
    },
    accents: {
      champagne: {
        ink: { fill: "#D8B872", onFill: "#1A1405", text: "#DCC084" },
        paper: { fill: "#7A5A12", onFill: "#FFFFFF", text: "#6B4E0C" },
      },
      ivory: {
        ink: { fill: "#EFEBE4", onFill: "#0A0A0B", text: "#EFEBE4" },
        paper: { fill: "#0A0A0B", onFill: "#EFEBE4", text: "#0A0A0B" },
      },
      rose: {
        ink: { fill: "#E9A6A0", onFill: "#2B0A08", text: "#EDB2AC" },
        paper: { fill: "#96322A", onFill: "#FFFFFF", text: "#852B24" },
      },
    },
    defaultAccent: "champagne",
    danger: DANGER,
    motion: "editorial",
    fontPair: "editorial",
    shape: { radius: "0px", radiusLarge: "0px", borderWidth: "1px", button: "square", buttonFill: "outline" },
    type: {
      displayWeight: "500",
      displayTracking: "-0.01em",
      displayTransform: "none",
      headingWeight: "500",
      bodyWeight: "300",
      eyebrowTracking: "0.34em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // 5. Ciepły minimalizm — jednostronicowa wizytówka.
  // -------------------------------------------------------------------
  atelier: {
    mood: {
      pl: "Ciepły papier i szeryfowy nagłówek: dużo światła, terakotowy akcent, spokój.",
      en: "Warm paper with a serif display: airy, terracotta accent, calm.",
    },
    bands: {
      default: { surface: "#FBF7F0", ink: "#1E1B18", inkMuted: "#675F56", border: "#E7DFD3", accent: "paper" },
      muted: { surface: "#F2EADD", ink: "#1E1B18", inkMuted: "#635B51", border: "#DED3C2", accent: "paper" },
      inverted: { surface: "#2A2521", ink: "#FBF7F0", inkMuted: "#B5ACA0", border: "#453E37", accent: "ink" },
      card: { surface: "#FFFFFF", ink: "#1E1B18", inkMuted: "#675F56", border: "#DACFBF", accent: "paper" },
    },
    accents: {
      terracotta: {
        paper: { fill: "#A3402A", onFill: "#FFFFFF", text: "#8F3624" },
        ink: { fill: "#E8A188", onFill: "#2B0E05", text: "#F1BFAD" },
      },
      olive: {
        paper: { fill: "#4F5A22", onFill: "#FFFFFF", text: "#444E1C" },
        ink: { fill: "#C3D083", onFill: "#161B02", text: "#C3D083" },
      },
      ink: {
        paper: { fill: "#1E1B18", onFill: "#FBF7F0", text: "#1E1B18" },
        ink: { fill: "#FBF7F0", onFill: "#1E1B18", text: "#FBF7F0" },
      },
    },
    defaultAccent: "terracotta",
    danger: DANGER,
    motion: "calm",
    fontPair: "warm",
    shape: { radius: "6px", radiusLarge: "10px", borderWidth: "1px", button: "rounded", buttonFill: "outline" },
    type: {
      displayWeight: "400",
      displayTracking: "-0.02em",
      displayTransform: "none",
      headingWeight: "400",
      bodyWeight: "400",
      eyebrowTracking: "0.2em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // 6. Czysty tech — wypożyczalnia, która sprzedaje katalogiem.
  // -------------------------------------------------------------------
  gridline: {
    mood: {
      pl: "Czysty tech: biel, granat, wyraźna siatka i katalog na pierwszym planie.",
      en: "Clean tech: white, navy, a visible grid and the catalogue up front.",
    },
    bands: {
      default: { surface: "#FFFFFF", ink: "#0B1220", inkMuted: "#4A5566", border: "#E2E8F0", accent: "paper" },
      muted: { surface: "#F1F5F9", ink: "#0B1220", inkMuted: "#47525F", border: "#CFDAE6", accent: "paper" },
      inverted: { surface: "#0B1220", ink: "#F8FAFC", inkMuted: "#98A5B8", border: "#1E293B", accent: "ink" },
      card: { surface: "#FFFFFF", ink: "#0B1220", inkMuted: "#4A5566", border: "#CFD9E6", accent: "paper" },
    },
    accents: {
      indigo: {
        paper: { fill: "#3538CD", onFill: "#FFFFFF", text: "#2F32B8" },
        ink: { fill: "#A5B4FC", onFill: "#0B0F35", text: "#A5B4FC" },
      },
      teal: {
        paper: { fill: "#0E6E68", onFill: "#FFFFFF", text: "#0C605B" },
        ink: { fill: "#6EE0D5", onFill: "#012422", text: "#6EE0D5" },
      },
      slate: {
        paper: { fill: "#0B1220", onFill: "#F8FAFC", text: "#0B1220" },
        ink: { fill: "#F8FAFC", onFill: "#0B1220", text: "#F8FAFC" },
      },
    },
    defaultAccent: "indigo",
    danger: DANGER,
    motion: "calm",
    fontPair: "tech",
    shape: { radius: "8px", radiusLarge: "12px", borderWidth: "1px", button: "rounded", buttonFill: "solid" },
    type: {
      displayWeight: "700",
      displayTracking: "-0.03em",
      displayTransform: "none",
      headingWeight: "600",
      bodyWeight: "400",
      eyebrowTracking: "0.18em",
      eyebrowTransform: "uppercase",
    },
  },

  // -------------------------------------------------------------------
  // ZASTANE — odtwarzają wygląd sprzed ADR-090. Nie do wyboru w galerii.
  // -------------------------------------------------------------------
  classic: {
    mood: {
      pl: "Zastany szablon powściągliwy — wygląd stron sprzed wprowadzenia motywów.",
      en: "Legacy restrained template — how sites looked before themes.",
    },
    bands: {
      default: { surface: LEGACY.paper, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
      muted: { surface: LEGACY.muted, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
      inverted: { surface: LEGACY.ink, ink: LEGACY.paper, inkMuted: LEGACY.inkMuted, border: LEGACY.inkMuted, accent: "ink" },
      card: { surface: LEGACY.card, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
    },
    accents: LEGACY_ACCENTS,
    defaultAccent: "ink",
    danger: DANGER,
    motion: "still",
    fontPair: "system",
    shape: { radius: "8px", radiusLarge: "12px", borderWidth: "1px", button: "pill", buttonFill: "outline" },
    type: LEGACY_TYPE,
    legacy: true,
  },
  bold: {
    mood: {
      pl: "Zastany szablon mocny — wygląd stron sprzed wprowadzenia motywów.",
      en: "Legacy bold template — how sites looked before themes.",
    },
    bands: {
      default: { surface: LEGACY.paper, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
      muted: { surface: LEGACY.muted, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
      inverted: { surface: LEGACY.ink, ink: LEGACY.paper, inkMuted: LEGACY.inkMuted, border: LEGACY.inkMuted, accent: "ink" },
      card: { surface: LEGACY.card, ink: LEGACY.ink, inkMuted: LEGACY.mutedInk, border: LEGACY.border, accent: "paper" },
    },
    accents: LEGACY_ACCENTS,
    defaultAccent: "ink",
    danger: DANGER,
    motion: "still",
    fontPair: "system",
    shape: { radius: "12px", radiusLarge: "16px", borderWidth: "2px", button: "rounded", buttonFill: "solid" },
    type: {
      displayWeight: "800",
      displayTracking: "-0.025em",
      displayTransform: "none",
      headingWeight: "800",
      bodyWeight: "400",
      eyebrowTracking: "0.25em",
      eyebrowTransform: "uppercase",
    },
    legacy: true,
  },
} as const satisfies Record<string, SiteThemeTokens>;

/** Identyfikatory motywów — stabilne, angielskie, trafiają do jsonb. */
export const SITE_THEMES = Object.keys(SITE_THEME_TOKENS) as unknown as readonly (keyof typeof SITE_THEME_TOKENS)[];
export type SiteThemeId = keyof typeof SITE_THEME_TOKENS;

export const siteThemeSchema = z.enum(
  Object.keys(SITE_THEME_TOKENS) as [SiteThemeId, ...SiteThemeId[]],
);

/** Motywy DO WYBORU — rejestr bez pozycji zastanych. */
export const SELECTABLE_THEMES = SITE_THEMES.filter((id) => !("legacy" in SITE_THEME_TOKENS[id]));

/** Motyw, który dostaje strona bez zapisanego stylu i bez kolumny `template`. */
export const DEFAULT_THEME: SiteThemeId = "classic";

export function themeTokens(id: SiteThemeId): SiteThemeTokens {
  return SITE_THEME_TOKENS[id];
}

/** Akcenty do wyboru w danym motywie — kolejność stała (dane, nie Object.keys w UI). */
export function accentsOf(id: SiteThemeId): string[] {
  return Object.keys(SITE_THEME_TOKENS[id].accents);
}

/**
 * Warianty akcentu, których motyw NAPRAWDĘ używa — wyprowadzone z pasów.
 * Kontrakt kompletności palety pyta o nie zamiast wymagać obu wariantów: motyw
 * bez pasa ciemnego nie ma gdzie pokazać wariantu `ink`, więc wymuszanie jego
 * wartości produkowałoby dane, których nikt nie ogląda i nikt nie poprawia.
 */
export function variantsUsedBy(id: SiteThemeId): AccentVariant[] {
  const bands = SITE_THEME_TOKENS[id].bands;
  const used = new Set<AccentVariant>(THEME_BAND_KEYS.map((band) => bands[band].accent));
  return ACCENT_VARIANTS.filter((variant) => used.has(variant));
}

// -----------------------------------------------------------------------
// Welon nad zdjęciem
// -----------------------------------------------------------------------

/**
 * WELON (`scrim`) — półprzezroczysta powłoka, pod którą tekst leży na ZDJĘCIU.
 *
 * Bez niej „wielki nagłówek na pełnej fotografii" jest obietnicą bez pokrycia:
 * kontrast tekstu do zdjęcia zależy od zdjęcia, a zdjęcie podmienia najemca.
 * Welon zamienia nieznane tło na znane — i dopiero to daje się policzyć.
 *
 * Alfa jest jedna dla całego systemu, bo to ONA jest liczbą, którą sprawdza
 * kontrakt: przypadek NAJGORSZY to welon nad bielą (zdjęcie prześwietlone),
 * więc test liczy kontrast tekstu do `flatten(surface, #FFFFFF, SCRIM_ALPHA)`.
 * Alfa dobrana per motyw znaczyłaby tyle samo sprawdzeń, ale każde na innej
 * liczbie — a pierwszy motyw z alfą „prawie wystarczającą" przechodziłby
 * u autora i wywracał się u klienta ze słonecznym zdjęciem.
 *
 * CO WOLNO POŁOŻYĆ NA WELONIE, i dlaczego akurat tyle. Welon gęsty na tyle,
 * żeby UNIEŚĆ KAŻDY kolor tekstu motywu, musiałby mieć alfę ~0,9 — a wtedy
 * zdjęcie przestaje być zdjęciem i cały sens „pełnej fotografii" znika.
 * Przy 0,7 kontrakt dowodzi dwóch rzeczy: tekst PODSTAWOWY pasa trzyma próg
 * tekstowy (4,5:1), a akcent trzyma próg dużego tekstu (3:1) — czyli tyle,
 * ile potrzeba nagłówkowi i etykiecie. Tekst PRZYGASZONY na welon NIE WCHODZI
 * i archetyp `overlay` go tam nie kładzie (patrz canvas-presets.ts): lead na
 * zdjęciu byłby jedynym miejscem w systemie, którego nie da się obronić liczbą.
 */
export const SCRIM_ALPHA = 0.7;

/**
 * Pas, którego kolor bierze welon: NAJCIEMNIEJSZY pas motywu. Wyprowadzony,
 * a nie zadeklarowany — jedno pole mniej do pomylenia przy dopisywaniu motywu,
 * a wynik z definicji zgodny z paletą (welon ma być z tego samego świata).
 */
export function scrimBandOf(id: SiteThemeId): ThemeBandKey {
  const bands = SITE_THEME_TOKENS[id].bands;
  return THEME_BAND_KEYS.reduce((darkest, key) =>
    relativeLuminance(bands[key].surface) < relativeLuminance(bands[darkest].surface) ? key : darkest,
  );
}
