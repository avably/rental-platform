/**
 * RUCH JAKO DANE MOTYWU — KONTRAKT (K6, ADR-092).
 *
 * Animacja jest jedyną częścią wyglądu, której nie widać na zrzucie ekranu, a
 * której zepsucie nie wywraca żadnego testu renderu: strona bez animacji
 * wygląda jak strona, tylko gorzej. Ten plik zamienia cztery obietnice
 * z ADR-092 w zdania sprawdzalne:
 *
 *   1. JEST JEDNA RODZINA KLATEK. Gdyby motyw wniósł własne `@keyframes`,
 *      „animacje jako dane" byłyby fikcją — dane wskazywałyby kod, który
 *      trzeba dopisać razem z nimi. Test liczy klatki w arkuszu.
 *
 *   2. LICZBY IDĄ Z REJESTRU. Dla KAŻDEGO motywu komplet `--site-motion-*`
 *      wystawiony przez `styleTokensFor` musi być dokładnie presetem, który
 *      motyw wskazał. Motyw nr 7 wchodzi pod ten test sam z siebie.
 *
 *   3. PREFERENCJA CZYTELNIKA WYGRYWA. Reguła animacji MUSI stać pod
 *      `prefers-reduced-motion: no-preference`. To jest ten test, który pali
 *      się na mutacji „zdejmij bramkę" — a bez niego mutacja jest niewidoczna,
 *      bo strona w domyślnych ustawieniach systemu wygląda identycznie.
 *
 *   4. WARSTWA EDYCYJNA STOI. Płótno kreatora i miniatury galerii renderują
 *      ten sam komponent co sklep, więc bez `motion="off"` sekcja przenikałaby
 *      przy każdym przewinięciu palety.
 *
 * Czego ten plik NIE dowodzi: jsdom nie zna `animation-timeline` ani zapytań
 * o preferencje, więc o zachowaniu przeglądarki wnioskujemy z ODCZYTU arkusza.
 * Prawdy wizualnej dowodzi weryfikacja opisana w dzienniku budowy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SITE_MOTIONS, SITE_THEMES, STYLE_TOKENS, motionPreset, styleTokensFor, themeTokens } from "@avably/core/site";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteChrome, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const ARKUSZ = readFileSync(resolve(__dirname, "site.css"), "utf8");

/** Blok reguły wejścia — jedyne miejsce w arkuszu, które wiąże `site-reveal` z osią widoku. */
const REGULA_WEJSCIA = /\.site-root:not\(\[data-site-motion="off"\]\) \[data-section-id\] \{([^}]*)\}/;

function sekcja(): RenderSection {
  return {
    id: "s-1",
    position: 0,
    type: "freeform",
    content: { heading: "Nagłówek", body: "Treść" },
  } as RenderSection;
}

describe("arkusz: jedna animacja, liczby z motywu", () => {
  it("kontrola po pustym zbiorze: arkusz i rejestry są niepuste", () => {
    // Bez tego wszystkie asercje niżej mogłyby badać pusty napis.
    expect(ARKUSZ.length).toBeGreaterThan(1000);
    expect(SITE_MOTIONS.length).toBeGreaterThan(1);
    expect(SITE_THEMES.length).toBeGreaterThan(1);
  });

  it("w arkuszu jest DOKŁADNIE JEDNA rodzina klatek wejścia", () => {
    // Sedno „animacji jako danych": preset ruchu to komplet LICZB, a nie nazwa
    // własnej animacji. Druga rodzina klatek znaczyłaby, że motyw nr 7 wnosi
    // kod — czyli dokładnie to, czego zadanie zabrania.
    const klatki = ARKUSZ.match(/@keyframes\s+[a-z-]+/g) ?? [];
    expect(klatki, "arkusz bez ani jednej animacji").not.toEqual([]);
    expect(klatki, `w arkuszu stoi więcej niż jedna rodzina klatek: ${klatki.join(", ")}`).toEqual([
      "@keyframes site-reveal",
    ]);
  });

  it("klatki czytają WYŁĄCZNIE zmienne, nie wpisane wartości", () => {
    const blok = /@keyframes site-reveal \{([\s\S]*?)\n\}/.exec(ARKUSZ);
    expect(blok, "nie znaleziono klatek site-reveal").not.toBeNull();
    for (const token of [
      STYLE_TOKENS.motionOpacity,
      STYLE_TOKENS.motionDistance,
      STYLE_TOKENS.motionScale,
    ]) {
      expect(blok![1], `klatki nie czytają ${token}`).toContain(token);
    }
    // Animujemy WYŁĄCZNIE kompozytorowe własności — `height`/`margin` w klatkach
    // znaczyłyby przeliczanie układu przy każdej klatce i skok CLS.
    expect(blok![1], "klatki ruszają układem (CLS)").not.toMatch(/\b(height|width|margin|padding|top|left)\s*:/);
  });

  it("KAŻDY motyw wystawia liczby SWOJEGO presetu ruchu", () => {
    const rozjazdy: string[] = [];
    for (const theme of SITE_THEMES) {
      const preset = motionPreset(themeTokens(theme).motion);
      const tokens = styleTokensFor({
        theme,
        accent: themeTokens(theme).defaultAccent,
        fontPair: themeTokens(theme).fontPair,
      });
      const oczekiwane = {
        [STYLE_TOKENS.motionDuration]: preset.duration,
        [STYLE_TOKENS.motionEasing]: preset.easing,
        [STYLE_TOKENS.motionDistance]: preset.distance,
        [STYLE_TOKENS.motionScale]: preset.scale,
        [STYLE_TOKENS.motionOpacity]: preset.opacity,
        [STYLE_TOKENS.motionRange]: preset.range,
      };
      for (const [token, wartosc] of Object.entries(oczekiwane)) {
        if (tokens[token] !== wartosc) {
          rozjazdy.push(`${theme}: ${token} = ${tokens[token]}, a preset mówi ${wartosc}`);
        }
      }
    }
    expect(rozjazdy, `motywy wystawiają cudze liczby ruchu:\n${rozjazdy.join("\n")}`).toEqual([]);
  });
});

describe("preferencja czytelnika wygrywa z motywem", () => {
  it("reguła wejścia stoi POD bramką prefers-reduced-motion: no-preference", () => {
    // Mutacja, którą ten test ma łapać: zdjęcie `@media` wokół reguły. Strona
    // wygląda wtedy identycznie dla wszystkich POZA osobami, które ruch
    // wyłączyły — czyli dla nikogo, kogo widać na zrzucie ekranu.
    const dopasowanie = REGULA_WEJSCIA.exec(ARKUSZ);
    expect(dopasowanie, "nie znaleziono reguły wejścia sekcji").not.toBeNull();

    const bramka = ARKUSZ.indexOf("@media (prefers-reduced-motion: no-preference)");
    expect(bramka, "arkusz nie ma bramki prefers-reduced-motion").toBeGreaterThan(-1);
    expect(
      dopasowanie!.index,
      "reguła wejścia stoi PRZED bramką prefers-reduced-motion — ruch nie da się wyłączyć",
    ).toBeGreaterThan(bramka);

    // Bramka musi domykać się PO regule, nie przed nią: „stoi dalej w pliku"
    // spełniłby też arkusz z pustym `@media` na górze.
    const wnetrze = ARKUSZ.slice(bramka, dopasowanie!.index);
    const otwarte = (wnetrze.match(/\{/g) ?? []).length;
    const zamkniete = (wnetrze.match(/\}/g) ?? []).length;
    expect(otwarte - zamkniete, "reguła wejścia wypadła poza blok prefers-reduced-motion").toBeGreaterThan(0);
  });

  it("reguła wejścia jest ULEPSZENIEM — stoi pod @supports osi widoku", () => {
    // Bez `@supports` przeglądarka bez `animation-timeline` uruchomiłaby
    // animację na osi CZASU: sekcje na dole strony przenikałyby, zanim
    // ktokolwiek do nich doscrolluje, a treść startowałaby od krycia 0.
    const wsparcie = ARKUSZ.indexOf("@supports (animation-timeline: view())");
    const dopasowanie = REGULA_WEJSCIA.exec(ARKUSZ)!;
    expect(wsparcie, "arkusz nie ma bramki @supports").toBeGreaterThan(-1);
    expect(dopasowanie.index, "reguła wejścia stoi poza @supports").toBeGreaterThan(wsparcie);
  });

  it("treść jest widoczna DOMYŚLNIE — poza animacją arkusz nie ukrywa sekcji", () => {
    // Gdyby stan startowy (krycie 0) stał w regule BAZOWEJ, przeglądarka bez
    // wsparcia i robot indeksujący dostaliby stronę pustą. To jest ten rodzaj
    // wady, który wychodzi wyłącznie u kogoś innego.
    const dopasowanie = REGULA_WEJSCIA.exec(ARKUSZ)!;
    expect(dopasowanie[1]).toContain("animation");
    expect(dopasowanie[1], "reguła bazowa ukrywa sekcję").not.toMatch(/opacity\s*:\s*0/);
  });
});

describe("warstwa edycyjna stoi", () => {
  it("motion=off wystawia znacznik, którego reguła wejścia nie obejmuje", () => {
    const { container } = render(
      <SiteRenderer sections={[sekcja()]} motion="off" />,
    );
    const korzen = container.querySelector<HTMLElement>(".site-root");
    expect(korzen, "brak korzenia strony").not.toBeNull();
    expect(korzen!.getAttribute("data-site-motion")).toBe("off");
  });

  it("strona PUBLICZNA nie niesie żadnego znacznika trybu ruchu", () => {
    // Kontrola negatywna do testu wyżej: gdyby atrybut stał zawsze (choćby
    // z wartością „auto"), selektor `:not([data-site-motion="off"])` broniłby
    // czegoś, czego nie ma, a pierwsza literówka w wartości wyłączyłaby ruch
    // wszystkim po cichu.
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    const korzen = container.querySelector<HTMLElement>(".site-root");
    expect(korzen!.hasAttribute("data-site-motion")).toBe(false);
  });

  it("SiteChrome bez korzenia renderera daje DOKŁADNIE JEDEN korzeń", () => {
    // Powłoka sklepu (K6) wystawia korzeń sama, a renderer wchodzi do środka
    // bez własnego. Dwa korzenie znaczyłyby dwa kontenery `site`, czyli dwie
    // różne miary dla zapytań kontenerowych sekcji (ADR-085).
    const { container } = render(
      <SiteChrome>
        <SiteRenderer sections={[sekcja()]} asRoot={false} />
      </SiteChrome>,
    );
    expect(container.querySelectorAll(".site-root")).toHaveLength(1);
    expect(container.querySelectorAll("[data-section-id]")).toHaveLength(1);
  });
});
