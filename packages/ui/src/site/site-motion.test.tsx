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

  it("motywy RÓŻNIĄ SIĘ ruchem — jest ich więcej niż jeden i nie jest to jeden preset", () => {
    /*
     * FIKSTURA RÓŻNICUJĄCA. Bez tego zdania cały plik przeszedłby na rejestrze,
     * w którym wszystkie motywy wskazują ten sam preset: „każdy motyw wystawia
     * liczby swojego presetu" byłoby wtedy prawdą TRYWIALNĄ, a „ruch jest daną
     * motywu" — hasłem bez pokrycia. Pytamy więc o trzy rzeczy naraz: że
     * presetów w użyciu jest co najmniej dwa, że różnią się LICZBAMI (a nie
     * tylko nazwą) i że wśród motywów jest taki, który mówi „bez ruchu".
     */
    const użyte = [...new Set(SITE_THEMES.map((theme) => themeTokens(theme).motion))];
    expect(użyte.length, `wszystkie motywy dzielą jeden preset ruchu: ${użyte.join(", ")}`).toBeGreaterThan(2);

    const odciski = new Set(
      użyte.map((id) => {
        const p = motionPreset(id);
        return [p.easing, p.distance, p.scale, p.opacity, p.range].join("|");
      }),
    );
    expect(odciski.size, "różne nazwy presetów, te same liczby").toBe(użyte.length);

    const bezRuchu = SITE_THEMES.filter((theme) => motionPreset(themeTokens(theme).motion).opacity === "1");
    expect(bezRuchu.length, "żaden motyw nie umie powiedzieć DANYMI, że stoi bez ruchu").toBeGreaterThan(0);
  });

  it("wejście trwa TYLE SAMO w każdej sekcji — koniec zakresu mierzy okno, nie sekcję (E9)", () => {
    /*
     * Regres, którego to zdanie broni, jest niewidoczny na zrzucie: zakres
     * kończący się procentem fazy `cover` liczy się od SUMY wysokości sekcji
     * i okna, więc długa sekcja odsłania się dłużej niż krótka. Strona ma
     * wtedy tyle różnych animacji, ile ma sekcji o różnej wysokości.
     */
    const rozjazdy: string[] = [];
    for (const id of SITE_MOTIONS) {
      const preset = motionPreset(id);
      // Preset „bez ruchu" ma zakres zerowy i mierzyć go w oknie nie ma po co.
      if (preset.opacity === "1" && preset.distance === "0px") continue;
      if (!/\d+vh\s*$/.test(preset.range)) {
        rozjazdy.push(`${id}: zakres „${preset.range}" nie kończy się długością w jednostkach okna`);
      }
    }
    expect(rozjazdy, rozjazdy.join("\n")).toEqual([]);
  });

  it("reguła wejścia deklaruje NIEZEROWY czas — zero zwija animację do stanu końcowego", () => {
    /*
     * To nie jest kosmetyka składni. Przy osi widoku czas trwania jest
     * obojętny dla KAŻDEJ wartości poza `0s` — a `0s` jest wartością POCZĄTKOWĄ
     * `animation-duration`. Skreślenie stałej z arkusza („przecież i tak nic
     * nie robi") wyłączyłoby więc wejście na wszystkich motywach naraz, nie
     * ruszając ani jednej liczby w rejestrze ruchu.
     */
    const dopasowanie = REGULA_WEJSCIA.exec(ARKUSZ);
    expect(dopasowanie, "nie znaleziono reguły wejścia sekcji").not.toBeNull();
    const cialo = dopasowanie![1] ?? "";
    const czas = /animation:\s*site-reveal\s+([0-9.]+)(m?s)/.exec(cialo);
    expect(czas, `reguła wejścia bez zadeklarowanego czasu: ${cialo.trim()}`).not.toBeNull();
    expect(Number(czas![1]), "czas trwania w regule wejścia wynosi zero").toBeGreaterThan(0);
  });

  it("czas trwania NIE jest tokenem motywu — martwe pokrętło nie wraca tylnymi drzwiami", () => {
    // Zdjęte w E9 po pomiarze na żywej stronie (patrz nagłówek ./motion).
    // Token dopisany z powrotem obiecywałby sterowanie, którego nie ma.
    expect(Object.keys(STYLE_TOKENS)).not.toContain("motionDuration");
    expect(ARKUSZ, "arkusz znów czyta zmienną czasu trwania").not.toContain("--site-motion-duration");
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

  it("ŻADNA reguła arkusza nie chowa sekcji poza animacją (fail-open)", () => {
    /*
     * Test wyżej patrzy na JEDNĄ regułę. Ta sama wada wchodzi jednak także
     * obok niej — `[data-section-id] { opacity: 0 }` dopisane gdziekolwiek,
     * z myślą „animacja i tak to odsłoni", robi stronę pustą wszędzie tam,
     * gdzie animacji nie ma: bez wsparcia osi widoku, przy `prefers-reduced-
     * -motion`, na płótnie kreatora i u robota indeksującego.
     */
    const podejrzane = [...ARKUSZ.matchAll(/([^{}]*\[data-section-id\][^{}]*)\{([^}]*)\}/g)]
      .filter(([, , ciało]) => /(?:opacity\s*:\s*0(?!\.\d*[1-9])|visibility\s*:\s*hidden|display\s*:\s*none)/.test(ciało ?? ""))
      .map(([, selektor]) => (selektor ?? "").trim());
    expect(podejrzane, `reguły chowające sekcję:\n${podejrzane.join("\n")}`).toEqual([]);
  });

  it("render sekcji nie wychodzi z serwera z ukrytą treścią", () => {
    // Druga połowa tej samej obietnicy: nawet gdyby arkusz był czysty, stan
    // startowy wpisany w atrybut `style` renderera dawałby stronę, która bez
    // JavaScriptu jest pusta. Renderer sekcji nie ma prawa nic ukrywać.
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    const owijka = container.querySelector<HTMLElement>("[data-section-id]");
    expect(owijka, "brak owijki sekcji").not.toBeNull();
    expect(owijka!.style.opacity, "renderer wystawia sekcję z kryciem w atrybucie").toBe("");
    expect(owijka!.style.visibility).toBe("");
    expect(owijka!.style.display).toBe("");
    expect(container.innerHTML, "treść sekcji nie dojechała do dokumentu").toContain("Nagłówek");
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
