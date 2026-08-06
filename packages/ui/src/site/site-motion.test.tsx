/**
 * RUCH JAKO DANE MOTYWU — KONTRAKT (K6/ADR-092, silnik czasowy ADR-097).
 *
 * Animacja jest jedyną częścią wyglądu, której nie widać na zrzucie ekranu, a
 * której zepsucie nie wywraca żadnego testu renderu: strona bez animacji
 * wygląda jak strona, tylko gorzej. Ten plik zamienia obietnice z ADR-092
 * i ADR-097 w zdania sprawdzalne:
 *
 *   1. JEST JEDEN OPIS WEJŚCIA. Gdyby motyw wniósł własne reguły, „animacje
 *      jako dane" byłyby fikcją — dane wskazywałyby kod, który trzeba dopisać
 *      razem z nimi.
 *
 *   2. LICZBY IDĄ Z REJESTRU. Dla KAŻDEGO motywu komplet `--site-motion-*`
 *      wystawiony przez `styleTokensFor` musi być dokładnie presetem, który
 *      motyw wskazał. Motyw nr 7 wchodzi pod ten test sam z siebie.
 *
 *   3. PREFERENCJA CZYTELNIKA WYGRYWA — dwa razy: bramką w arkuszu i warunkiem
 *      uzbrojenia w skrypcie.
 *
 *   4. WARSTWA EDYCYJNA STOI. Płótno kreatora renderuje ten sam komponent co
 *      sklep, więc bez `motion="off"` (i bez nonce'a) sekcja przenikałaby przy
 *      każdym przewinięciu palety.
 *
 *   5. FAIL-OPEN JEST KONSTRUKCJĄ, NIE UPRZEJMOŚCIĄ. Stan startowy stoi pod
 *      atrybutem, który nadaje skrypt; a skrypt, który się uzbroił i nie ma
 *      czym odsłonić, odsłania po liczniku.
 *
 * Czego ten plik NIE dowodzi: jsdom nie liczy układu ani nie odtwarza przejść,
 * więc o WYGLĄDZIE ruchu wnioskujemy z pomiarów w przeglądarce (dziennik
 * budowy). Tutaj sprawdzamy MECHANIZM: kto, kiedy i pod jakim warunkiem
 * zdejmuje stan startowy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  SITE_MOTIONS,
  SITE_THEMES,
  STRUCTURED_SECTION_TYPES,
  STYLE_TOKENS,
  motionPreset,
  sectionCanvasFrom,
  structuredPresetFor,
  styleTokensFor,
  themeTokens,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REVEAL_ARMED_ATTR,
  REVEAL_DONE_ATTR,
  REVEAL_FALLBACK_MS,
  SITE_REVEAL_SCRIPT,
} from "./site-reveal";
import { SiteChrome, SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const ARKUSZ = readFileSync(resolve(__dirname, "site.css"), "utf8");

/** Blok stanu startowego — jedyne miejsce, w którym arkusz chowa treść. */
const REGULA_STARTU =
  /\[data-site-reveal="armed"\]\s*\.site-root:not\(\[data-site-motion="off"\]\)\s*\[data-section-reveal="block"\]:not\(\[data-section-revealed\]\)\s*\{([^}]*)\}/;

/** Blok wejścia — jedyne miejsce, w którym arkusz nadaje ruchowi czas. */
const REGULA_WEJSCIA =
  /\[data-site-reveal="armed"\]\s*\.site-root:not\(\[data-site-motion="off"\]\)\s*\[data-section-reveal="block"\]\[data-section-revealed\]\s*\{([^}]*)\}/;

afterEach(cleanup);

function sekcja(): RenderSection {
  return {
    id: "s-1",
    position: 0,
    type: "freeform",
    content: { heading: "Nagłówek", body: "Treść" },
  } as RenderSection;
}

describe("arkusz: jeden opis wejścia, liczby z motywu", () => {
  it("kontrola po pustym zbiorze: arkusz i rejestry są niepuste", () => {
    expect(ARKUSZ.length).toBeGreaterThan(1000);
    expect(SITE_MOTIONS.length).toBeGreaterThan(1);
    expect(SITE_THEMES.length).toBeGreaterThan(1);
  });

  it("wejście jedzie ANIMACJĄ NA OSI CZASU, a nie osią przewijania (ADR-097)", () => {
    /*
     * Zdanie o mechanizmie, nie o składni. Powrót do `animation-timeline`
     * przywróciłby scrub — czyli ruch bez własnej prędkości, cofający się przy
     * przewijaniu w tył, i dokładnie te dwa weta akceptu, przez które ADR-097
     * w ogóle powstał.
     */
    const wejscie = REGULA_WEJSCIA.exec(ARKUSZ);
    expect(wejscie, "nie znaleziono reguły wejścia dla podmiotów").not.toBeNull();
    expect(wejscie![1]).toContain("animation: site-reveal");
    /*
     * ANIMACJA, NIE PRZEJŚCIE — i to jest zdanie o skutku ubocznym, nie
     * o składni. Skrót `transition` na podmiocie (a zwłaszcza na jego
     * bezpośrednich dzieciach) KASUJE własne przejścia elementów: przycisk
     * `.site-cta` w pierwszym ekranie tracił przez to fade koloru na hoverze
     * i dostawał opóźnienie kaskady. `animation` jest osobnym kanałem.
     */
    expect(wejscie![1], "wejście wróciło na przejście i kasuje przejścia elementów").not.toContain(
      "transition",
    );
    // Komentarze opisują PORZUCONY mechanizm i mają prawo go nazywać — pytamy
    // o REGUŁY, więc najpierw zdejmujemy komentarze.
    const bezKomentarzy = ARKUSZ.replace(/\/\*[\s\S]*?\*\//g, " ");
    expect(bezKomentarzy, "arkusz wrócił do osi przewijania").not.toContain("animation-timeline");
    expect(bezKomentarzy, "arkusz wrócił do zakresu osi widoku").not.toContain("animation-range");
  });

  it("wejście czyta WYŁĄCZNIE zmienne motywu, a klatki nie ruszają układu", () => {
    const wejscie = REGULA_WEJSCIA.exec(ARKUSZ)!;
    for (const token of [STYLE_TOKENS.motionDuration, STYLE_TOKENS.motionEasing]) {
      expect(wejscie![1], `wejście nie czyta ${token}`).toContain(token);
    }
    const klatki = /@keyframes site-reveal \{([\s\S]*?)\n\}/.exec(ARKUSZ);
    expect(klatki, "nie znaleziono klatek site-reveal").not.toBeNull();
    for (const token of [STYLE_TOKENS.motionOpacity, STYLE_TOKENS.motionDistance]) {
      expect(klatki![1], `klatki nie czytają ${token}`).toContain(token);
    }
    // Klatki po `height`/`margin` znaczyłyby przeliczanie układu przy każdej
    // klatce i skok CLS — animujemy wyłącznie własności kompozytorowe.
    expect(klatki![1], "klatki ruszają układem (CLS)").not.toMatch(
      /\b(height|width|margin|padding|top|left)\b/,
    );
  });

  it("w arkuszu jest DOKŁADNIE JEDNA rodzina klatek wejścia", () => {
    // Sedno „animacji jako danych": preset ruchu to komplet LICZB, a nie nazwa
    // własnej animacji. Druga rodzina klatek znaczyłaby, że motyw nr 7 wnosi kod.
    const rodziny = ARKUSZ.match(/@keyframes\s+[a-z-]+/g) ?? [];
    expect(rodziny, "arkusz bez ani jednej animacji").not.toEqual([]);
    expect(rodziny, `rodzin klatek: ${rodziny.join(", ")}`).toEqual(["@keyframes site-reveal"]);
  });

  it("stan startowy czyta WYŁĄCZNIE zmienne motywu i nie rusza układu", () => {
    const start = REGULA_STARTU.exec(ARKUSZ);
    expect(start, "nie znaleziono reguły stanu startowego").not.toBeNull();
    for (const token of [STYLE_TOKENS.motionOpacity, STYLE_TOKENS.motionDistance]) {
      expect(start![1], `stan startowy nie czyta ${token}`).toContain(token);
    }
    expect(start![1], "stan startowy rusza układem (CLS)").not.toMatch(
      /\b(height|width|margin|padding|top|left)\b/,
    );
    expect(start![1], "stan startowy skaluje pudełko treści").not.toContain("scale(");
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
        [STYLE_TOKENS.motionOpacity]: preset.opacity,
        [STYLE_TOKENS.motionStagger]: preset.stagger,
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
     * liczby swojego presetu" byłoby wtedy prawdą TRYWIALNĄ.
     */
    const użyte = [...new Set(SITE_THEMES.map((theme) => themeTokens(theme).motion))];
    expect(użyte.length, `wszystkie motywy dzielą jeden preset: ${użyte.join(", ")}`).toBeGreaterThan(2);

    const odciski = new Set(
      użyte.map((id) => {
        const p = motionPreset(id);
        return [p.duration, p.easing, p.distance, p.opacity, p.stagger].join("|");
      }),
    );
    expect(odciski.size, "różne nazwy presetów, te same liczby").toBe(użyte.length);

    const bezRuchu = SITE_THEMES.filter((theme) => motionPreset(themeTokens(theme).motion).opacity === "1");
    expect(bezRuchu.length, "żaden motyw nie umie powiedzieć DANYMI, że stoi bez ruchu").toBeGreaterThan(0);
  });

  it("czas trwania mieści się w ramach kalibracji do wzorca (ADR-097)", () => {
    /*
     * Wzorzec (nasza strona marketingowa) jedzie na 1000 ms i 100 px. Sekcje
     * strony najemcy dostają świadomie mniej — jest ich osiem, a nie jedna.
     * To zdanie broni obu krańców: ruch skrócony do 200 ms znów byłby błyskiem,
     * a wydłużony do sekundy powtórzony osiem razy męczy.
     */
    const poza: string[] = [];
    for (const id of SITE_MOTIONS) {
      const p = motionPreset(id);
      if (p.opacity === "1" && p.distance === "0px") continue; // preset „bez ruchu"
      const ms = Number.parseInt(p.duration, 10);
      const px = Number.parseInt(p.distance, 10);
      if (!(ms >= 450 && ms <= 800)) poza.push(`${id}: czas ${p.duration} poza 450–800 ms`);
      if (!(px >= 20 && px <= 48)) poza.push(`${id}: dystans ${p.distance} poza 20–48 px`);
    }
    expect(poza, poza.join("\n")).toEqual([]);
  });

  it("ARTEFAKT: liczby ruchu każdego presetu i przypisanie motywów", () => {
    /*
     * DWUKIERUNKOWOŚĆ. Testy wyżej porównują TOKENY Z PRESETEM, więc zmiana
     * wartości w rejestrze przechodzi przez nie bez mrugnięcia: obie strony
     * porównania jadą z tego samego źródła. To zdanie jest drugą stroną —
     * spisuje liczby WPROST, więc dostrojenie ruchu musi przejść przez ten
     * wiersz i zostać zauważone w recenzji.
     */
    const liczby = Object.fromEntries(
      SITE_MOTIONS.map((id) => {
        const p = motionPreset(id);
        return [id, [p.duration, p.easing, p.distance, p.opacity, p.stagger].join(" | ")];
      }),
    );
    expect(liczby).toEqual({
      still: "0ms | linear | 0px | 1 | 0ms",
      calm: "700ms | cubic-bezier(0.25, 0.46, 0.45, 0.94) | 32px | 0 | 110ms",
      crisp: "560ms | cubic-bezier(0.22, 0.61, 0.36, 1) | 24px | 0 | 80ms",
      spring: "620ms | cubic-bezier(0.34, 1.42, 0.64, 1) | 28px | 0 | 90ms",
      editorial: "750ms | cubic-bezier(0.165, 0.84, 0.44, 1) | 40px | 0 | 120ms",
    });

    expect(Object.fromEntries(SITE_THEMES.map((t) => [t, themeTokens(t).motion]))).toEqual({
      "industrial-noir": "crisp",
      velocity: "crisp",
      confetti: "spring",
      "noir-lux": "editorial",
      atelier: "calm",
      gridline: "calm",
      classic: "still",
      bold: "still",
    });
  });
});

describe("preferencja czytelnika wygrywa z motywem", () => {
  it("stan startowy stoi POD bramką prefers-reduced-motion: no-preference", () => {
    const bramka = ARKUSZ.indexOf("@media (prefers-reduced-motion: no-preference)");
    const start = ARKUSZ.search(REGULA_STARTU);
    expect(bramka, "arkusz stracił bramkę preferencji").toBeGreaterThan(-1);
    expect(start, "arkusz stracił regułę stanu startowego").toBeGreaterThan(-1);
    expect(start, "stan startowy wypadł sprzed bramki preferencji").toBeGreaterThan(bramka);
  });

  it("arkusz ma TWARDE zdjęcie ruchu przy prefers-reduced-motion: reduce", () => {
    // Druga linia obrony: przełącznik systemowy działa bez przeładowania, więc
    // atrybut `armed` bywa zastany z chwili sprzed zmiany preferencji.
    const blok = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(ARKUSZ);
    expect(blok, "brak bloku dla prefers-reduced-motion: reduce").not.toBeNull();
    expect(blok![1]).toContain("opacity: 1");
    expect(blok![1]).toContain("animation: none");
  });

  it("ŻADNA reguła arkusza nie chowa sekcji poza stanem startowym (fail-open)", () => {
    /*
     * Reguła `[data-section-reveal] { opacity: 0 }` dopisana obok — z myślą
     * „animacja i tak to odsłoni" — robi stronę pustą wszędzie tam, gdzie
     * skryptu nie ma: bez JS, przy `prefers-reduced-motion`, na płótnie
     * kreatora i u robota indeksującego.
     */
    const podejrzane = [...ARKUSZ.matchAll(/([^{}]*\[data-section-(?:id|reveal)[^{}]*)\{([^}]*)\}/g)]
      .filter(([, , ciało]) =>
        /(?:opacity\s*:\s*0(?!\.\d*[1-9])|visibility\s*:\s*hidden|display\s*:\s*none)/.test(ciało ?? ""),
      )
      .map(([, selektor]) => (selektor ?? "").trim())
      // Stan startowy WOLNO chować — ale wyłącznie pod atrybutem uzbrojenia.
      .filter((selektor) => !selektor.includes('[data-site-reveal="armed"]'));
    expect(podejrzane, `reguły chowające sekcję bez uzbrojenia:\n${podejrzane.join("\n")}`).toEqual([]);
  });

  it("render sekcji nie wychodzi z serwera z ukrytą treścią", () => {
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    const owijka = container.querySelector<HTMLElement>("[data-section-id]");
    const pudelko = container.querySelector<HTMLElement>("[data-section-reveal]");
    expect(owijka, "brak owijki sekcji").not.toBeNull();
    expect(pudelko, "brak pudełka treści — animacja nie miałaby podmiotu").not.toBeNull();
    for (const el of [owijka!, pudelko!]) {
      expect(el.style.opacity, "renderer wystawia sekcję z kryciem w atrybucie").toBe("");
      expect(el.style.visibility).toBe("");
      expect(el.style.display).toBe("");
    }
    expect(container.innerHTML, "treść sekcji nie dojechała do dokumentu").toContain("Nagłówek");
  });
});

/**
 * PODMIOT ANIMACJI — DOKŁADNIE JEDEN NA SEKCJĘ, ZE ŚWIADOMYM WARIANTEM.
 *
 * Znacznik stawia POWŁOKA sekcji, a powłok jest kilka (strukturalna, v1, hero,
 * stopka, siatka płótna). Rozjazd nie daje błędu: sekcja renderuje się
 * poprawnie i po prostu nie ma wejścia.
 */
describe("podmiot animacji wejścia stoi pod każdym typem sekcji", () => {
  it("kontrola po pustym zbiorze: rejestr typów strukturalnych jest niepusty", () => {
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(5);
  });

  it.each([...STRUCTURED_SECTION_TYPES])("sekcja strukturalna %s ma jeden podmiot", (type) => {
    /*
     * Wariant NIE jest tu sprawdzany na sztywno: powłoka wyprowadza go
     * z obecności nagłówka (sekcja bez nagłówka oddaje jeden blok, więc
     * kaskada nie miałaby czego kaskadować). Pilnuje tego osobne zdanie
     * „stagger dostają wyłącznie pudełka o co najmniej dwóch dzieciach";
     * tutaj pytamy o LICZBĘ podmiotów i o to, że wariant jest jednym z dwóch
     * znanych — trzeci znaczyłby regułę arkusza bez pokrycia.
     */
    const { container } = render(
      <SiteRenderer
        sections={[
          { id: `s-${type}`, position: 0, type, content: structuredPresetFor(type, "pl") } as RenderSection,
        ]}
      />,
    );
    const podmioty = container.querySelectorAll("[data-section-reveal]");
    expect(podmioty.length, `sekcja ${type}: podmiotów animacji`).toBe(1);
    expect(
      ["stagger", "block"],
      `sekcja ${type}: nieznany wariant podmiotu`,
    ).toContain(podmioty[0]!.getAttribute("data-section-reveal"));
  });

  it("sekcja v1 (treść płaska) ma jeden podmiot z kaskadą", () => {
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    const podmioty = container.querySelectorAll("[data-section-reveal]");
    expect(podmioty.length).toBe(1);
    expect(podmioty[0]!.getAttribute("data-section-reveal")).toBe("stagger");
  });

  it("sekcja v2 (płótno) ma jeden podmiot BEZ kaskady", () => {
    // Elementy płótna stoją na współrzędnych absolutnych — kaskada po dzieciach
    // rozsypywałaby układ zamiast go odsłaniać.
    const canvas = sectionCanvasFrom("freeform", { heading: "Nagłówek", body: "Treść" });
    const { container } = render(
      <SiteRenderer
        sections={[{ id: "s-canvas", position: 0, type: "freeform", content: canvas } as RenderSection]}
      />,
    );
    const podmioty = container.querySelectorAll("[data-section-reveal]");
    expect(podmioty.length).toBe(1);
    expect(podmioty[0]!.getAttribute("data-section-reveal")).toBe("block");
  });

  it("wariant `stagger` dostają WYŁĄCZNIE pudełka o co najmniej dwóch dzieciach", () => {
    /*
     * Kaskada nagłówek → reszta potrzebuje co najmniej dwóch dzieci. Pudełko
     * z jednym (tak wyglądała stopka) przechodzi wszystkie inne zdania, a ruch
     * ma tam dokładnie zero kroków — kod udaje kaskadę, której nie ma.
     */
    const bledy: string[] = [];
    const sprawdz = (etykieta: string, kontener: HTMLElement) => {
      for (const podmiot of kontener.querySelectorAll('[data-section-reveal="stagger"]')) {
        if (podmiot.children.length < 2) {
          bledy.push(`${etykieta}: pudełko z kaskadą ma ${podmiot.children.length} dzieci`);
        }
      }
    };
    for (const type of STRUCTURED_SECTION_TYPES) {
      const { container } = render(
        <SiteRenderer
          sections={[
            { id: `s-${type}`, position: 0, type, content: structuredPresetFor(type, "pl") } as RenderSection,
          ]}
        />,
      );
      sprawdz(type, container);
      cleanup();
    }
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    sprawdz("freeform (v1)", container);
    expect(bledy, bledy.join("\n")).toEqual([]);
  });

  it("podmiot leży WEWNĄTRZ owijki sekcji — inaczej selektor arkusza go nie widzi", () => {
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    const owijka = container.querySelector("[data-section-id]")!;
    expect(owijka.querySelector("[data-section-reveal]"), "podmiot poza owijką sekcji").not.toBeNull();
  });
});

describe("skrypt uzbrajający wchodzi WYŁĄCZNIE tam, gdzie ma prawo", () => {
  it("bez nonce'a skryptu nie ma — powierzchnia bez CSP nie animuje", () => {
    const { container } = render(<SiteRenderer sections={[sekcja()]} />);
    expect(container.querySelector("script"), "skrypt wszedł bez nonce'a").toBeNull();
  });

  it("z nonce'em skrypt jest PIERWSZYM dzieckiem korzenia strony", () => {
    // Pozycja jest kontraktem: skrypt wykonany po sekcjach pokazałby treść,
    // a potem ją schował — mignięcie przy wolnym łączu.
    const { container } = render(
      <SiteRenderer sections={[sekcja()]} revealNonce="test-nonce" />,
    );
    const korzen = container.querySelector(".site-root")!;
    const pierwszy = korzen.firstElementChild!;
    expect(pierwszy.tagName.toLowerCase(), "pierwsze dziecko korzenia to nie skrypt").toBe("script");
    expect(pierwszy.getAttribute("nonce")).toBe("test-nonce");
    expect(pierwszy.innerHTML).toContain(REVEAL_ARMED_ATTR);
  });

  it("płótno kreatora (motion=off) NIE dostaje skryptu, nawet z nonce'em", () => {
    // Bramka E8 zostaje i jest tu drugim zamkiem obok braku nonce'a.
    const { container } = render(
      <SiteChrome motion="off" revealNonce="test-nonce">
        <div />
      </SiteChrome>,
    );
    expect(container.querySelector("script"), "warstwa edycyjna uzbroiła się").toBeNull();
  });
});

/**
 * ZACHOWANIE SKRYPTU. Uruchamiamy ŹRÓDŁO (a nie kopię logiki w teście), więc
 * każda zmiana w napisie przechodzi przez te zdania.
 */
describe("skrypt uzbrajający: kiedy uzbraja i kiedy odsłania", () => {
  let obserwowane: Element[];
  let zwrotka: ((wpisy: { target: Element; isIntersecting: boolean }[]) => void) | null;

  function uruchom() {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(SITE_REVEAL_SCRIPT)();
  }

  function stronaZSekcjami(ileOff = 0) {
    document.body.innerHTML = `
      <div class="site-root">
        <div data-section-id="a"><div data-section-reveal="stagger"><h2>A</h2><p>a</p></div></div>
        <div data-section-id="b"><div data-section-reveal="block"><p>b</p></div></div>
      </div>
      ${
        ileOff
          ? `<div class="site-root" data-site-motion="off">
               <div data-section-id="c"><div data-section-reveal="stagger"><p>c</p></div></div>
             </div>`
          : ""
      }`;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    obserwowane = [];
    zwrotka = null;
    document.documentElement.removeAttribute(REVEAL_ARMED_ATTR);
    class FakeIO {
      constructor(cb: (wpisy: { target: Element; isIntersecting: boolean }[]) => void) {
        zwrotka = cb;
      }
      observe(el: Element) {
        obserwowane.push(el);
      }
      unobserve(el: Element) {
        obserwowane = obserwowane.filter((x) => x !== el);
      }
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeIO);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addListener() {}, removeListener() {} }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    document.documentElement.removeAttribute(REVEAL_ARMED_ATTR);
  });

  it("uzbraja dokument i obserwuje KAŻDY podmiot poza warstwą edycyjną", () => {
    stronaZSekcjami(1);
    uruchom();
    expect(document.documentElement.getAttribute(REVEAL_ARMED_ATTR)).toBe("armed");
    expect(obserwowane.length, "podmiotów pod obserwacją").toBe(2);
    expect(
      obserwowane.some((el) => el.closest("[data-site-motion='off']")),
      "skrypt obserwuje podmiot pod warstwą edycyjną",
    ).toBe(false);
  });

  it("NIE uzbraja się, gdy przeglądarka nie zna IntersectionObserver", () => {
    // Bez obserwatora nie ma czym zdjąć stanu startowego, więc go nie nadajemy.
    stronaZSekcjami();
    vi.stubGlobal("IntersectionObserver", undefined);
    uruchom();
    // Sprawdzamy WARTOŚĆ, nie obecność klucza: `"IntersectionObserver" in window`
    // jest prawdą także dla `undefined`, więc skrypt pytający o klucz uzbroiłby
    // się w przeglądarce bez obserwatora i zostawił pustą stronę.
    expect(document.documentElement.hasAttribute(REVEAL_ARMED_ATTR)).toBe(false);
  });

  it("NIE uzbraja się, gdy czytelnik prosi o mniej ruchu", () => {
    stronaZSekcjami();
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: true, media: q, addListener() {}, removeListener() {} }));
    uruchom();
    expect(document.documentElement.hasAttribute(REVEAL_ARMED_ATTR)).toBe(false);
    expect(obserwowane.length).toBe(0);
  });

  it("przecięcie z oknem odsłania podmiot i zdejmuje go z obserwacji", () => {
    stronaZSekcjami();
    uruchom();
    const cel = obserwowane[0]!;
    zwrotka!([{ target: cel, isIntersecting: true }]);
    expect(cel.hasAttribute(REVEAL_DONE_ATTR), "podmiot nie został odsłonięty").toBe(true);
    expect(obserwowane).not.toContain(cel);
  });

  it("SIATKA BEZPIECZEŃSTWA: obserwator, który nigdy nie strzelił, nie zostawia pustej strony", () => {
    /*
     * To jest stan, którego fail-open oparty na samym „braku JS" nie łapie:
     * skrypt WSTAŁ (treść jest schowana), a obserwator milczy — bo wyjątek, bo
     * rozszerzenie przeglądarki, bo egzotyczna implementacja. Bez licznika
     * strona zostaje pusta na zawsze.
     */
    stronaZSekcjami();
    uruchom();
    expect(document.querySelectorAll(`[${REVEAL_DONE_ATTR}]`).length).toBe(0);
    vi.advanceTimersByTime(REVEAL_FALLBACK_MS + 50);
    expect(
      document.querySelectorAll(`[data-section-reveal]:not([${REVEAL_DONE_ATTR}])`).length,
      "po liczniku został podmiot bez odsłonięcia",
    ).toBe(0);
  });

  it("pierwsza zwrotka GASI licznik — sekcje poniżej zgięcia zachowują wejście", () => {
    // Gdyby licznik biegł dalej, po 1,2 s odsłoniłby całą stronę naraz i ruch
    // zostałby tylko dla pierwszej sekcji.
    stronaZSekcjami();
    uruchom();
    const pierwszy = obserwowane[0]!;
    zwrotka!([{ target: pierwszy, isIntersecting: true }]);
    vi.advanceTimersByTime(REVEAL_FALLBACK_MS + 50);
    const drugi = document.querySelectorAll("[data-section-reveal]")[1]!;
    expect(drugi.hasAttribute(REVEAL_DONE_ATTR), "licznik odsłonił sekcję poniżej zgięcia").toBe(false);
  });

  it("wyjątek przy tworzeniu obserwatora odsłania treść od razu", () => {
    stronaZSekcjami();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          throw new Error("brak wsparcia");
        }
      },
    );
    uruchom();
    expect(
      document.querySelectorAll(`[data-section-reveal]:not([${REVEAL_DONE_ATTR}])`).length,
      "wyjątek zostawił treść schowaną",
    ).toBe(0);
  });
});

describe("render sekcji zostaje serwerowy (ADR-097, budżet JS)", () => {
  /*
   * Skrypt uzbrajający to jedyny JavaScript, jaki strona najemcy dostała
   * w zamian za scrub. Ryzyko wtórne jest większe niż on sam: pierwsza osoba,
   * która „naprawi" animację dopisując `"use client"` do renderu sekcji,
   * wrzuci do bundla klienta CAŁY render strony — a tego nie widać ani na
   * zrzucie, ani w żadnym teście renderu.
   */
  const ZRODLA_SERWEROWE = [
    "site-renderer.tsx",
    "sections.tsx",
    "element-canvas.tsx",
    "structured/shell.tsx",
    "site-reveal-script.tsx",
  ] as const;

  it.each(ZRODLA_SERWEROWE)("%s nie jest komponentem klienckim", (plik) => {
    const source = readFileSync(resolve(__dirname, plik), "utf8");
    expect(source.length, "plik przestał być źródłem renderu").toBeGreaterThan(200);
    expect(source.slice(0, 400), "render sekcji wjechał do bundla klienta").not.toContain('"use client"');
  });
});
