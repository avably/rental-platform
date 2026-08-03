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
  SITE_THEMES,
  THEME_BAND_KEYS,
  accentsOf,
  contrastRatio,
  flatten,
  scrimBandOf,
  themeTokens,
  variantsUsedBy,
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
