/**
 * KONTRAKT KONTRASTU MOTYWÓW (K5, ADR-090) — bramka WYCZERPUJĄCA.
 *
 * Galeria szablonów obiecuje, że każdy motyw i każdy akcent z jego palety dają
 * czytelną stronę. Ten plik jest jedynym miejscem, w którym ta obietnica jest
 * zdaniem sprawdzalnym — i dlatego jest napisany tak, żeby NIE DAŁO SIĘ go
 * przejść przez pominięcie.
 *
 * LEKCJA Z PR #83, spisana wprost: bramka, która liczy tylko pary ZADEKLAROWANE
 * w tablicy obok testu, nie broni niczego — dopisanie koloru bez dopisania pary
 * przechodzi na zielono, a wada wychodzi u klienta. Dlatego pętle niżej iterują
 * po REJESTRZE MOTYWÓW (`SITE_THEMES` → `bands` → `accents`), a nie po liście
 * przypadków. Konsekwencja jest dokładnie taka, jakiej wymaga cel „15 motywów":
 * dopisanie motywu nr 7 to automatycznie kilkadziesiąt nowych sprawdzeń,
 * o których nikt nie musiał pamiętać, i nie ma sposobu, żeby motyw wszedł do
 * rejestru bez policzonego kontrastu.
 *
 * Druga warstwa to KOMPLETNOŚĆ SAMEGO REJESTRU — pętla po wszystkich
 * kombinacjach jest warta tyle, ile zbiór, po którym chodzi. Testy niżej
 * wyprowadzają ten zbiór ze stałych modelu treści (SECTION_BACKGROUNDS) i
 * z rejestru krojów, więc pas albo rodzina dodane po jednej stronie nie mogą
 * po cichu wypaść z macierzy.
 */
import { describe, expect, it } from "vitest";

import {
  ACCENT_VARIANTS,
  CONTRAST_AA_LARGE,
  CONTRAST_AA_TEXT,
  VISIBLE_EDGE,
  FONT_PAIRS,
  SCRIM_ALPHA,
  SECTION_BACKGROUNDS,
  SITE_MOTIONS,
  SITE_THEMES,
  STRUCTURED_SECTIONS,
  STRUCTURED_SECTION_TYPES,
  STRUCTURED_THEME_ROLES,
  THEME_BAND_KEYS,
  accentsOf,
  contrastRatio,
  flatten,
  motionPreset,
  scrimBandOf,
  themeTokens,
  variantsUsedBy,
  type StructuredThemeRole,
} from "./index";

/** Alfa kafelka ikony (`bg-[var(--site-accent)]/10`) — lustro arkusza @avably/ui. */
const ICON_TILE_ALPHA = 0.1;

/**
 * Najgorsze możliwe zdjęcie pod welonem: całkowicie białe. Welon nad czernią
 * jest łatwy; kontrakt ma bronić strony ze zdjęciem prześwietlonym.
 */
const WORST_PHOTO = "#FFFFFF";

const round = (value: number) => Math.round(value * 100) / 100;

describe("kontrast: tekst i tło pasa", () => {
  it("tekst podstawowy i drugorzędny czytelny na KAŻDYM pasie KAŻDEGO motywu", () => {
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      for (const key of THEME_BAND_KEYS) {
        const band = themeTokens(theme).bands[key];
        for (const [role, color] of [
          ["ink", band.ink],
          ["inkMuted", band.inkMuted],
        ] as const) {
          const ratio = contrastRatio(color, band.surface);
          if (ratio < CONTRAST_AA_TEXT) {
            failures.push(
              `${theme}/${key}/${role}: ${color} na ${band.surface} = ${round(ratio)}:1 (próg ${CONTRAST_AA_TEXT})`,
            );
          }
        }
      }
    }
    expect(failures, `pary poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("kreska (obrys karty, linia FAQ) jest WIDOCZNA na swoim pasie", () => {
    // Próg widoczności, nie próg WCAG — uzasadnienie przy `VISIBLE_EDGE`.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      for (const key of THEME_BAND_KEYS) {
        const band = themeTokens(theme).bands[key];
        const ratio = contrastRatio(band.border, band.surface);
        if (ratio < VISIBLE_EDGE) {
          failures.push(
            `${theme}/${key}: kreska ${band.border} na ${band.surface} = ${round(ratio)}:1 (próg ${VISIBLE_EDGE})`,
          );
        }
      }
    }
    expect(failures, `pary poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("KARTA nie znika w pasie, na którym stoi", () => {
    // Karta produktu leży na pasie `default` albo `muted`. Jeśli ma tę samą
    // powierzchnię co pas (tak stoi „czysty tech": biała karta na białej
    // stronie), jedyne, co ją pokazuje, to obrys — i wtedy obrys MUSI być
    // widoczny. Test bierze więc alternatywę: albo powierzchnia, albo kreska.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const bands = themeTokens(theme).bands;
      for (const key of ["default", "muted"] as const) {
        const bySurface = contrastRatio(bands.card.surface, bands[key].surface);
        const byEdge = contrastRatio(bands.card.border, bands[key].surface);
        if (bySurface < VISIBLE_EDGE && byEdge < VISIBLE_EDGE) {
          failures.push(
            `${theme}/${key}: karta ${bands.card.surface} (obrys ${bands.card.border}) na ${bands[key].surface} — powierzchnia ${round(bySurface)}:1, kreska ${round(byEdge)}:1`,
          );
        }
      }
    }
    expect(failures, `karty nierozróżnialne od pasa:\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("kontrast: akcent na pasie", () => {
  it("akcentowy TEKST na każdym pasie: motyw × akcent × pas", () => {
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const accent of accentsOf(theme)) {
        for (const key of THEME_BAND_KEYS) {
          const band = tokens.bands[key];
          const family = tokens.accents[accent]![band.accent];
          if (!family) continue; // brak wariantu łapie kontrakt kompletności niżej
          const ratio = contrastRatio(family.text, band.surface);
          if (ratio < CONTRAST_AA_TEXT) {
            failures.push(
              `${theme}/${accent}/${key}: tekst ${family.text} na ${band.surface} = ${round(ratio)}:1 (próg ${CONTRAST_AA_TEXT})`,
            );
          }
        }
      }
    }
    expect(failures, `kombinacje poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("etykieta NA wypełnieniu akcentu (przycisk solid) w każdym używanym wariancie", () => {
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const accent of accentsOf(theme)) {
        for (const variant of variantsUsedBy(theme)) {
          const family = tokens.accents[accent]![variant];
          if (!family) continue;
          const ratio = contrastRatio(family.onFill, family.fill);
          if (ratio < CONTRAST_AA_TEXT) {
            failures.push(
              `${theme}/${accent}/${variant}: etykieta ${family.onFill} na wypełnieniu ${family.fill} = ${round(ratio)}:1`,
            );
          }
        }
      }
    }
    expect(failures, `kombinacje poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("wypełnienie akcentu ODCINA SIĘ od pasa, na którym leży (element nietekstowy)", () => {
    // Przycisk `solid` musi być widoczny jako przycisk, zanim ktokolwiek
    // przeczyta jego etykietę. Próg nietekstowy (3:1), bo chodzi o kształt.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const accent of accentsOf(theme)) {
        for (const key of THEME_BAND_KEYS) {
          const band = tokens.bands[key];
          const family = tokens.accents[accent]![band.accent];
          if (!family) continue;
          const ratio = contrastRatio(family.fill, band.surface);
          if (ratio < CONTRAST_AA_LARGE) {
            failures.push(
              `${theme}/${accent}/${key}: wypełnienie ${family.fill} na ${band.surface} = ${round(ratio)}:1 (próg ${CONTRAST_AA_LARGE})`,
            );
          }
        }
      }
    }
    expect(failures, `kombinacje poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("SYGNAŁ BŁĘDU jest czytelny na każdym pasie każdego motywu (K6, chrome sklepu)", () => {
    // Chrome sklepu (koszyk, kasa) mówi „nie wyszło" kolorem `danger`, a stoi
    // na TYCH SAMYCH pasach co sekcje strony. Bez tego bloku komunikat o
    // odrzuconej płatności byłby jedyną powierzchnią sklepu, której kontrastu
    // nikt nie policzył — a jest to akurat ta, której nieprzeczytanie kosztuje
    // klienta pieniądze.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const key of THEME_BAND_KEYS) {
        const band = tokens.bands[key];
        const family = tokens.danger[band.accent];
        if (!family) continue; // brak wariantu łapie kontrakt kompletności niżej
        const text = contrastRatio(family.text, band.surface);
        if (text < CONTRAST_AA_TEXT) {
          failures.push(
            `${theme}/${key}: tekst błędu ${family.text} na ${band.surface} = ${round(text)}:1 (próg ${CONTRAST_AA_TEXT})`,
          );
        }
        const fill = contrastRatio(family.fill, band.surface);
        if (fill < CONTRAST_AA_LARGE) {
          failures.push(
            `${theme}/${key}: wypełnienie błędu ${family.fill} na ${band.surface} = ${round(fill)}:1 (próg ${CONTRAST_AA_LARGE})`,
          );
        }
        const onFill = contrastRatio(family.onFill, family.fill);
        if (onFill < CONTRAST_AA_TEXT) {
          failures.push(
            `${theme}/${key}: etykieta ${family.onFill} na wypełnieniu błędu ${family.fill} = ${round(onFill)}:1`,
          );
        }
      }
    }
    expect(failures, `sygnał błędu poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });

  it("kafelek ikony: akcent z alfą 10 % na pasie, akcentowy znak na wierzchu", () => {
    // `bg-[var(--site-accent)]/10` nie jest tłem — jest MIESZANINĄ z pasem pod
    // spodem. Liczenie kontrastu wprost do akcentu dałoby wynik, którego nie ma
    // na ekranie.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const accent of accentsOf(theme)) {
        for (const key of THEME_BAND_KEYS) {
          const band = tokens.bands[key];
          const family = tokens.accents[accent]![band.accent];
          if (!family) continue;
          const tile = flatten(family.fill, band.surface, ICON_TILE_ALPHA);
          const ratio = contrastRatio(family.text, tile);
          if (ratio < CONTRAST_AA_TEXT) {
            failures.push(
              `${theme}/${accent}/${key}: znak ${family.text} na kafelku ${tile} = ${round(ratio)}:1`,
            );
          }
        }
      }
    }
    expect(failures, `kombinacje poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("kontrast: welon nad zdjęciem", () => {
  it("tekst na welonie jest czytelny nawet nad zdjęciem CAŁKOWICIE BIAŁYM", () => {
    // Sekcja z pełnokadrowym zdjęciem kładzie welon (kształt `scrim`) i dopiero
    // na nim tekst. Tło pod welonem jest nieznane — najgorszy przypadek to biel.
    //
    // Progi są DWA i to jest świadome (patrz SCRIM_ALPHA): tekst podstawowy
    // trzyma próg tekstowy, akcent — próg dużego tekstu, bo na welonie stoi
    // wyłącznie jako nagłówek albo etykieta. Tekst PRZYGASZONY nie jest tu
    // sprawdzany, bo archetyp `overlay` go na welon nie kładzie; gdyby zaczął,
    // ten test ma dostać trzecią pozycję, a nie welon ma zgęstnieć po cichu.
    const failures: string[] = [];
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      const band = tokens.bands[scrimBandOf(theme)];
      const veiled = flatten(band.surface, WORST_PHOTO, SCRIM_ALPHA);
      const checks: [string, string, number][] = [
        ["ink", band.ink, CONTRAST_AA_TEXT],
        ...accentsOf(theme).map(
          (accent) =>
            [
              `accent:${accent}`,
              tokens.accents[accent]![band.accent]?.text ?? band.ink,
              CONTRAST_AA_LARGE,
            ] as [string, string, number],
        ),
      ];
      for (const [role, color, threshold] of checks) {
        const ratio = contrastRatio(color, veiled);
        if (ratio < threshold) {
          failures.push(
            `${theme}/${role}: ${color} na welonie ${veiled} = ${round(ratio)}:1 (próg ${threshold})`,
          );
        }
      }
    }
    expect(failures, `kombinacje poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });
});

/**
 * NOGA REJESTROWA SEKCJI STRUKTURALNYCH (E1, ADR-094).
 *
 * Komponent sekcji strukturalnej nie zna ani jednego heksa — deklaruje
 * w rejestrze, KTÓRYCH ról motywu używa (`themeRoles`). Ten blok zamyka
 * deklarację w liczbę: każda zadeklarowana rola jest liczona na KAŻDYM pasie
 * KAŻDEGO motywu (i dla każdego akcentu tam, gdzie rola jest akcentowa).
 *
 * Konsekwencja jest ta, o którą chodzi: nowy typ strukturalny WCHŁANIA SIĘ do
 * macierzy sam. Nie ma listy komponentów obok testu, którą trzeba pamiętać —
 * jest rejestr, a wpis bez policzonego kontrastu nie ma jak przejść.
 */
describe("kontrast: sekcje strukturalne wchłaniane przez rejestr (ADR-094)", () => {
  /**
   * PRZEPIS POMIARU dla każdej roli. Rola bez przepisu jest błędem, nie
   * pominięciem — dlatego mapa jest pełna i pilnuje jej osobny test niżej.
   * `accent` w argumencie: role akcentowe liczą się per akcent palety motywu,
   * pozostałe ignorują go i są liczone raz na pas.
   */
  const RECIPES: Record<
    StructuredThemeRole,
    {
      perAccent: boolean;
      threshold: number;
      /** Kolor roli albo `null`, gdy motyw nie ma tego wariantu (łapie kontrakt kompletności wyżej). */
      color: (theme: (typeof SITE_THEMES)[number], key: (typeof THEME_BAND_KEYS)[number], accent: string) => string | null;
      /**
       * Tło, na którym rola stoi. AKCENT JEST TU TRZECIM ARGUMENTEM (E7): do
       * E6 każda rola stała na powierzchni PASA, więc tło zależało wyłącznie od
       * motywu i pasa. `accentOnFill` jest pierwszą, która stoi na WYPEŁNIENIU
       * akcentu — a wypełnienie zależy od tego, który akcent operator wybrał.
       */
      against: (
        theme: (typeof SITE_THEMES)[number],
        key: (typeof THEME_BAND_KEYS)[number],
        accent: string,
      ) => string | null;
    }
  > = {
    ink: {
      perAccent: false,
      threshold: CONTRAST_AA_TEXT,
      color: (theme, key) => themeTokens(theme).bands[key].ink,
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    inkMuted: {
      perAccent: false,
      threshold: CONTRAST_AA_TEXT,
      color: (theme, key) => themeTokens(theme).bands[key].inkMuted,
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    border: {
      // Próg WIDOCZNOŚCI, nie WCAG — kreska rozdzielająca pary FAQ ma być
      // widoczna jako kreska, a nie czytana jako tekst.
      perAccent: false,
      threshold: VISIBLE_EDGE,
      color: (theme, key) => themeTokens(theme).bands[key].border,
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    accentText: {
      perAccent: true,
      threshold: CONTRAST_AA_TEXT,
      color: (theme, key, accent) => {
        const band = themeTokens(theme).bands[key];
        return themeTokens(theme).accents[accent]?.[band.accent]?.text ?? null;
      },
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    accentFill: {
      perAccent: true,
      threshold: CONTRAST_AA_LARGE,
      color: (theme, key, accent) => {
        const band = themeTokens(theme).bands[key];
        return themeTokens(theme).accents[accent]?.[band.accent]?.fill ?? null;
      },
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    /*
     * SYGNAŁ BŁĘDU sekcji z formularzem (E4, ADR-095). Kolor jest WSPÓLNY dla
     * motywów (K6: „nie wyszło" to komunikat systemu, nie element dyrekcji
     * wizualnej), więc `perAccent: false` — wariant (papier/atrament) wybiera
     * PAS, dokładnie jak przy chrome sklepu wyżej. Blok chrome liczy tę samą
     * czerwień, ale dla POWIERZCHNI, których nie ma w rejestrze sekcji; tu
     * wchodzi ona do macierzy PER TYP, więc nowy typ z formularzem dostanie ją
     * policzoną bez dopisywania czegokolwiek obok.
     */
    dangerText: {
      perAccent: false,
      threshold: CONTRAST_AA_TEXT,
      color: (theme, key) => {
        const band = themeTokens(theme).bands[key];
        return themeTokens(theme).danger[band.accent]?.text ?? null;
      },
      against: (theme, key) => themeTokens(theme).bands[key].surface,
    },
    /*
     * ETYKIETA NA WYPEŁNIENIU AKCENTU (E7) — jedyna rola, której TŁEM nie jest
     * pas, tylko sam akcent. Do E6 tę parę liczył wyłącznie blok „etykieta NA
     * wypełnieniu akcentu" wyżej, czyli poza macierzą typów: sekcja z
     * przyciskiem wchodziła do rejestru bez policzenia jedynej pary, której
     * nieprzeczytanie zatrzymuje odwiedzającego NA przycisku. Tutaj wchodzi
     * PER TYP, więc każdy przyszły typ z wypełnieniem akcentu (a wariant
     * `accent` sekcji CTA maluje nim CAŁĄ powierzchnię) dostaje ją policzoną
     * bez dopisywania czegokolwiek obok.
     *
     * Próg TEKSTOWY, nie nietekstowy: na wypełnieniu stoją LITERY. `accentFill`
     * obok mierzy ten sam kolor jako KSZTAŁT na pasie (próg 3:1) — to dwa różne
     * pytania o ten sam heks i oba muszą mieć odpowiedź.
     */
    accentOnFill: {
      perAccent: true,
      threshold: CONTRAST_AA_TEXT,
      color: (theme, key, accent) => {
        const band = themeTokens(theme).bands[key];
        return themeTokens(theme).accents[accent]?.[band.accent]?.onFill ?? null;
      },
      against: (theme, key, accent) => {
        const band = themeTokens(theme).bands[key];
        return themeTokens(theme).accents[accent]?.[band.accent]?.fill ?? null;
      },
    },
  };

  it("rejestr typów strukturalnych NIE jest pusty i każdy deklaruje role", () => {
    // Osłona anty-pusty-zbiór: pętla niżej po pustym rejestrze byłaby zielona
    // i nie broniłaby niczego.
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(0);
    for (const type of STRUCTURED_SECTION_TYPES) {
      expect(
        STRUCTURED_SECTIONS[type].themeRoles.length,
        `typ "${type}" nie deklaruje ani jednej roli motywu — wypadłby z macierzy`,
      ).toBeGreaterThan(0);
    }
  });

  it("KAŻDA rola z allowlisty ma przepis pomiaru", () => {
    // Bez tego zdania dopisanie roli do allowlisty przechodziłoby na zielono,
    // a jej kontrastu nie liczyłby nikt.
    for (const role of STRUCTURED_THEME_ROLES) {
      expect(Object.keys(RECIPES), `rola "${role}" bez przepisu pomiaru`).toContain(role);
    }
  });

  /**
   * ILE PAR MACIERZ MA POLICZYĆ — liczba wyprowadzona z REJESTRÓW, nie zapisana
   * obok testu (E7).
   *
   * ==================== PO CO OSOBNA LICZBA ====================
   *
   * Pętla niżej ma wadę, której nie widać, dopóki jej ktoś nie skróci:
   * zwężenie zbioru, po którym chodzi (jeden pas mniej, jeden motyw mniej,
   * `continue` na roli akcentowej), zostawia ją ZIELONĄ — bo test sprawdza
   * WYNIKI par, a nie to, czy policzył wszystkie. To jest dokładnie klasa
   * wady z PR #83, tyle że o piętro wyżej: nie „lista przypadków obok testu",
   * lecz „pętla, która po cichu omija część zbioru".
   *
   * Ta liczba jest drugą, niezależną drogą do tego samego wyniku — iloczyn
   * kartezjański wyprowadzony wprost z rejestrów. Rozjazd znaczy, że pętla
   * czegoś NIE policzyła, i mówi tego dokładną liczbę.
   *
   * `null` (motyw bez wariantu akcentu) NIE jest tu odliczany świadomie:
   * kompletność palety ma własny kontrakt niżej, więc pominięta para ma zapalić
   * TĘ liczbę, zamiast po cichu zmniejszyć oczekiwanie.
   */
  const expectedChecks = STRUCTURED_SECTION_TYPES.reduce(
    (total, type) =>
      total +
      STRUCTURED_SECTIONS[type].themeRoles.reduce(
        (perType, role) =>
          perType +
          SITE_THEMES.reduce(
            (perRole, theme) =>
              perRole +
              (RECIPES[role].perAccent ? accentsOf(theme).length : 1) * THEME_BAND_KEYS.length,
            0,
          ),
        0,
      ),
    0,
  );

  it("każda rola KAŻDEJ sekcji strukturalnej jest czytelna na każdym pasie każdego motywu", () => {
    const failures: string[] = [];
    let checks = 0;
    for (const type of STRUCTURED_SECTION_TYPES) {
      for (const role of STRUCTURED_SECTIONS[type].themeRoles) {
        const recipe = RECIPES[role];
        for (const theme of SITE_THEMES) {
          const accents = recipe.perAccent ? accentsOf(theme) : ([""] as readonly string[]);
          for (const accent of accents) {
            for (const key of THEME_BAND_KEYS) {
              const color = recipe.color(theme, key, accent);
              const background = recipe.against(theme, key, accent);
              if (!color || !background) continue; // brak wariantu łapie liczba par niżej
              const ratio = contrastRatio(color, background);
              checks += 1;
              if (ratio < recipe.threshold) {
                failures.push(
                  `${type}/${role}/${theme}${accent ? `/${accent}` : ""}/${key}: ${color} na ${background} = ${round(ratio)}:1 (próg ${recipe.threshold})`,
                );
              }
            }
          }
        }
      }
    }
    expect(checks, "macierz sekcji strukturalnych nie policzyła ANI JEDNEJ pary").toBeGreaterThan(0);
    expect(
      checks,
      "macierz policzyła INNĄ liczbę par, niż wynika z rejestrów — pętla omija część " +
        "zbioru (pas, motyw, akcent) albo motyw nie ma wariantu akcentu",
    ).toBe(expectedChecks);
    expect(failures, `role sekcji strukturalnych poniżej progu:\n${failures.join("\n")}`).toEqual([]);
  });
});

describe("kompletność rejestru motywów", () => {
  it("rejestr pasów obejmuje KAŻDE tło sekcji z modelu treści", () => {
    // Operator wybiera tło sekcji z SECTION_BACKGROUNDS (elements.ts). Tło
    // dodane tam, a nieopisane w motywie, znaczy pas, po którym macierz wyżej
    // NIE CHODZI — czyli dziurę w bramce. Ten test jest szwem między modelem
    // treści a rejestrem motywów.
    for (const background of SECTION_BACKGROUNDS) {
      expect(
        THEME_BAND_KEYS as readonly string[],
        `tło sekcji "${background}" nie ma pasa w motywach — macierz kontrastu go pomija`,
      ).toContain(background);
    }
  });

  it("każdy motyw ma komplet pasów", () => {
    for (const theme of SITE_THEMES) {
      expect(Object.keys(themeTokens(theme).bands).sort(), `motyw "${theme}" ma niepełny rejestr pasów`).toEqual(
        [...THEME_BAND_KEYS].sort(),
      );
    }
  });

  it("każdy akcent ma komplet tokenów w każdym wariancie UŻYWANYM przez motyw", () => {
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const accent of accentsOf(theme)) {
        for (const variant of variantsUsedBy(theme)) {
          expect(
            Object.keys(tokens.accents[accent]![variant] ?? {}).sort(),
            `akcent "${accent}" w motywie "${theme}" nie ma tokenów wariantu ${variant}, którego motyw używa`,
          ).toEqual(["fill", "onFill", "text"]);
        }
      }
    }
  });

  it("każdy motyw ma sygnał błędu w każdym wariancie, którego UŻYWA (K6)", () => {
    // Lustro testu wyżej dla akcentów. Bez niego motyw nr 7 mógłby wnieść
    // wyłącznie wariant papierowy, a jego pas odwrócony malowałby błąd
    // czerwienią wyliczoną dla białego tła — czyli plamą.
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      for (const variant of variantsUsedBy(theme)) {
        expect(
          Object.keys(tokens.danger[variant] ?? {}).sort(),
          `motyw "${theme}" nie ma sygnału błędu w wariancie ${variant}, którego używa`,
        ).toEqual(["fill", "onFill", "text"]);
      }
    }
  });

  it("każdy motyw wskazuje ISTNIEJĄCY preset ruchu (K6)", () => {
    // Sedno „animacji jako danych": motyw nr 7 wybiera ruch NAZWĄ z rejestru.
    // Nazwa spoza rejestru znaczyłaby stronę bez animacji i bez błędu — czyli
    // dokładnie ten rodzaj cichej awarii, przed którym broni reszta pliku.
    for (const theme of SITE_THEMES) {
      expect(
        SITE_MOTIONS as readonly string[],
        `motyw "${theme}" wskazuje preset ruchu spoza rejestru`,
      ).toContain(themeTokens(theme).motion);
    }
  });

  it("każdy preset ruchu ma komplet liczb i opis w OBU językach (K6)", () => {
    // Preset niepełny znaczy zmienną CSS o wartości `undefined` — animacja
    // wtedy nie pada, tylko cicho nie rusza.
    for (const id of SITE_MOTIONS) {
      const preset = motionPreset(id);
      // Kształt presetu po ADR-097 (oś czasu): czas trwania wraca jako pole ŻYWE,
      // zakres przewijania i skala znikają razem z mechanizmem, który je czytał.
      for (const field of ["duration", "easing", "distance", "opacity", "stagger"] as const) {
        expect(preset[field]?.length, `preset ruchu "${id}" bez pola ${field}`).toBeGreaterThan(0);
      }
      expect(preset.mood.pl.length, `preset ruchu "${id}" bez opisu PL`).toBeGreaterThan(10);
      expect(preset.mood.en.length, `preset ruchu "${id}" bez opisu EN`).toBeGreaterThan(10);
    }
  });

  it("akcent domyślny należy do palety motywu, a para krojów do rejestru par", () => {
    for (const theme of SITE_THEMES) {
      const tokens = themeTokens(theme);
      expect(accentsOf(theme), `domyślny akcent motywu "${theme}" spoza jego palety`).toContain(
        tokens.defaultAccent,
      );
      expect(Object.keys(FONT_PAIRS), `para krojów motywu "${theme}" spoza rejestru`).toContain(
        tokens.fontPair,
      );
    }
  });

  it("wariant akcentu każdego pasa jest jednym ze znanych wariantów", () => {
    for (const theme of SITE_THEMES) {
      for (const key of THEME_BAND_KEYS) {
        expect(ACCENT_VARIANTS as readonly string[]).toContain(themeTokens(theme).bands[key].accent);
      }
    }
  });

  it("każdy motyw ma opis dyrekcji w OBU językach — galeria czyta go z danych", () => {
    for (const theme of SITE_THEMES) {
      const mood = themeTokens(theme).mood;
      expect(mood.pl.length, `motyw "${theme}" bez opisu PL`).toBeGreaterThan(10);
      expect(mood.en.length, `motyw "${theme}" bez opisu EN`).toBeGreaterThan(10);
    }
  });
});
