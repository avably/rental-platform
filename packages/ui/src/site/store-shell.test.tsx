/**
 * NAGŁÓWEK POWŁOKI SKLEPU — findingi audytu UX 2026-08-25 (zadanie F1).
 *
 * Cztery zdania, których pilnuje ten plik:
 *
 *   1. S-45: znak firmy prowadzi na KANON `/`, nie na trasę wewnętrzną
 *      `/store` (duplikat kanoniczny strony głównej).
 *   2. S-52: „Koszyk" na stronie koszyka niesie `aria-current="page"`
 *      i wyróżnienie — a poza nią NIE niesie (druga noga dowodu: bez niej
 *      przechodziłby render znaczący koszyk zawsze).
 *   3. S-15: cel dotykowy odnośnika koszyka jest powiększony paddingiem
 *      z ujemnymi marginesami (44 px zamiast ~20 px), bez zmiany układu.
 *   4. S-58: wspólna siatka chrome (`SITE_CONTAINER`) mówi TYMI SAMYMI
 *      liczbami, co stałe pasa treści płótna — sufit `CANVAS_DESIGN_WIDTH_PX`
 *      i margines `CANVAS_PAD_COLUMNS / CANVAS_COLUMNS`. Klasa Tailwinda nie
 *      umie policzyć stałych rdzenia, więc literał pilnowany jest tutaj.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CANVAS_COLUMNS,
  CANVAS_DESIGN_WIDTH_PX,
  CANVAS_PAD_COLUMNS,
} from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StoreShellHeader } from "./store-shell";
import { SITE_CONTAINER } from "./template";

const ARKUSZ = readFileSync(resolve(__dirname, "site.css"), "utf8");

// jsdom: bez sprzątania `querySelector` w drugim teście patrzy na drzewo
// z pierwszego (lekcja: jsdom-id-selector-needs-cleanup).
afterEach(cleanup);

function naglowek(props: Partial<Parameters<typeof StoreShellHeader>[0]> = {}) {
  return render(
    <StoreShellHeader storeName="Sklep Kontrolny" logo={null} cartLabel="Koszyk" {...props} />,
  );
}

describe("S-45 — znak firmy prowadzi na kanon", () => {
  it("odnośnik marki celuje w `/`, nie w trasę wewnętrzną `/store`", () => {
    const { container } = naglowek();
    const brand = container.querySelector('a[href="/"]');
    expect(brand, "nagłówek bez odnośnika marki — nie ma czego dowodzić").not.toBeNull();
    expect(brand!.textContent).toContain("Sklep Kontrolny");
    expect(
      container.querySelector('a[href="/store"]'),
      "znak firmy wrócił na duplikat kanoniczny /store",
    ).toBeNull();
  });
});

describe("S-52 — self-link koszyka", () => {
  it("`cartCurrent` znaczy odnośnik koszyka `aria-current=page` i wyróżnieniem", () => {
    const { container } = naglowek({ cartCurrent: true });
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart, "nagłówek bez odnośnika koszyka").not.toBeNull();
    expect(cart!.getAttribute("aria-current")).toBe("page");
    /*
      [F7b] Wyróżnieniem jest KOLOR AKCENTU, nie waga: pod ikoną nie ma tekstu,
      który mógłby zgrubieć (zamiana świadoma, informacja o stanie zostaje
      w `aria-current` — patrz docblock przy `cartClassName`).
    */
    expect(cart!.className, "brak klasy wyróżnienia — aria-current byłby niewidzialny").toContain(
      "aria-[current=page]:text-[color:var(--site-accent-text)]",
    );
  });

  it("poza koszykiem odnośnik NIE niesie aria-current (druga noga dowodu)", () => {
    const { container } = naglowek();
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart).not.toBeNull();
    expect(cart!.hasAttribute("aria-current")).toBe(false);
  });
});

describe("S-15 — cel dotykowy odnośnika koszyka", () => {
  /*
    [F7b] Do belki ikonowej cel dotykowy robił PADDING wokół napisu („py-3
    -my-3 px-2 -mx-2" — 20 px tekstu + 2 × 12 px). Koszyk jest teraz znakiem
    bez napisu, więc 44 px jest WYMIAREM pudełka, a nie protezą wokół tekstu.
    Zdanie kontraktu bez zmian: kontrolka ma co najmniej 44 × 44 (WCAG 2.5.8).
  */
  it("odnośnik koszyka jest kwadratem 44 × 44 px", () => {
    const { container } = naglowek();
    const cart = container.querySelector('a[href="/cart"]');
    expect(cart).not.toBeNull();
    for (const klasa of [
      // WYSOKOŚĆ jest stała (44 px); zmienia się sama SZEROKOŚĆ pudełka:
      // 36 px na telefonie, 40 od 28 rem, 44 od 40 rem (F12 — trzy ikony po
      // 40 px brały w pasie 390 px więcej niż pigułka i znak firmy razem).
      // Cel 36 × 44 zostaje daleko nad minimum WCAG 2.5.8 AA (24 × 24).
      "h-11",
      "w-9",
      "@min-[28rem]/site:w-10",
      "@min-[40rem]/site:w-11",
      "inline-flex",
      "items-center",
      "justify-center",
    ]) {
      expect(cart!.className, `cel dotykowy stracił ${klasa}`).toContain(klasa);
    }
  });
});

describe("S-58 — wspólna siatka chrome mówi liczbami rdzenia", () => {
  /*
    Kolumna SZEROKOŚCIĄ, nie paddingiem: procentowy padding liczy się od bloku
    ZAWIERAJĄCEGO, więc `px-[8.333%]` na pełnoekranowym rodzicu dawał margines
    od OKNA (przy 1440 px: 120 zamiast 96) i kolumna stawała ~24 px od pasa
    płótna — złapane pomiarem pikseli. Patrz docblock `SITE_CONTAINER`.
  */
  it("kolumna to pas treści płótna: (COLUMNS − 2·PAD) / COLUMNS szerokości", () => {
    const procent = (((CANVAS_COLUMNS - 2 * CANVAS_PAD_COLUMNS) / CANVAS_COLUMNS) * 100).toFixed(3);
    // Kontrola przyrządu: gdy stałe rdzenia się zmienią, ta liczba przestaje
    // być 83.333 i asercja wskaże literał do poprawienia.
    expect(SITE_CONTAINER).toContain(`w-[${procent}%]`);
    // Padding procentowy NIE MA prawa wrócić — liczy się od rodzica, nie pasa.
    expect(SITE_CONTAINER).not.toContain("px-[");
  });

  it("sufit kolumny to pas treści przy szerokości projektowej (960 px = 60 rem)", () => {
    const sufit = CANVAS_DESIGN_WIDTH_PX * ((CANVAS_COLUMNS - 2 * CANVAS_PAD_COLUMNS) / CANVAS_COLUMNS);
    expect(sufit).toBe(960);
    expect(SITE_CONTAINER).toContain("max-w-[60rem]");
  });

  it("wiersz nagłówka mierzy wspólną siatką i jest kotwicą paneli belki (S-01)", () => {
    const { container } = naglowek();
    const wiersz = container.querySelector("[data-store-header] > div");
    expect(wiersz).not.toBeNull();
    for (const klasa of SITE_CONTAINER.split(" ")) {
      expect(wiersz!.className, `wiersz belki stracił ${klasa} wspólnej siatki`).toContain(klasa);
    }
    // `relative` jest kotwicą pełnej szerokości dla panelu wyszukiwania
    // (F7, technika S-01) — patrz `StoreHeaderSearch` w storefront.
    expect(wiersz!.className, "wiersz belki przestał być kotwicą paneli").toContain(
      "relative",
    );
  });
});

/* ================================ F7 ================================ */

describe("F7/F7b — nagłówek: sticky i sloty belki ikonowej", () => {
  it("`sticky` dokłada przyklejenie (top-0 z-40) i atrybut reguły linii z site.css", () => {
    const { container } = naglowek({ sticky: true });
    const header = container.querySelector("[data-store-header]")!;
    for (const klasa of ["sticky", "top-0", "z-40"]) {
      expect(header.className, `belka straciła ${klasa}`).toContain(klasa);
    }
    expect(
      header.hasAttribute("data-store-header-sticky"),
      "bez atrybutu linia po przewinięciu nie ma na czym wisieć",
    ).toBe(true);
  });

  it("DOMYŚLNIE nagłówek NIE przykleja — kontrakt podglądu szkicu (własny pasek z-50)", () => {
    const { container } = naglowek();
    const header = container.querySelector("[data-store-header]")!;
    expect(header.className.split(/\s+/), "podgląd dostał sticky pod cudzym paskiem").not.toContain(
      "sticky",
    );
    expect(header.hasAttribute("data-store-header-sticky")).toBe(false);
  });

  /*
    [F7b] Slot `subnav` (drugi rząd z listwą kategorii) zniknął razem z listwą,
    którą właściciel zdjął z produkcji. Zastąpił go `nav` — wyzwalacz kategorii
    w PRAWEJ GRUPIE kontrolek, obok wyszukiwania, pigułki terminu i koszyka.
    Kontrakt zdania: sloty belki lądują w belce, w zadanej kolejności.
  */
  it("sloty `nav`, `search` i `center` stają w prawej grupie, przed koszykiem", () => {
    const { container } = naglowek({
      nav: <div data-test-nav />,
      search: <div data-test-search />,
      center: <div data-test-center />,
    });
    const header = container.querySelector("[data-store-header]")!;
    for (const znacznik of ["[data-test-nav]", "[data-test-search]", "[data-test-center]"]) {
      expect(header.querySelector(znacznik), `slot ${znacznik} wypadł z belki`).not.toBeNull();
    }
    /*
      Kolejność: nawigacja → szukaj → termin → koszyk (od przeglądania do
      zakupu). Sloty stoją w WŁASNYCH pudełkach (granica serwer→klient — patrz
      komentarz w komponencie), więc czytamy je przez zawartość pudełek.
    */
    const grupa = header.querySelector("[data-test-nav]")!.parentElement!.parentElement!;
    const kolejnosc = [...grupa.children].map((el) =>
      el.tagName === "A" || el.hasAttribute("data-shell-inert")
        ? "cart"
        : el.querySelector("[data-test-nav]")
          ? "nav"
          : el.querySelector("[data-test-search]")
            ? "search"
            : "center",
    );
    expect(kolejnosc).toEqual(["nav", "search", "center", "cart"]);
  });

  it("bez slotów belka wygląda jak dotąd (podgląd szkicu nie podaje nic)", () => {
    const { container } = naglowek({ interactive: false });
    const header = container.querySelector("[data-store-header]")!;
    expect(header.querySelectorAll("a")).toHaveLength(0);
    expect(header.querySelectorAll("[data-shell-inert]")).toHaveLength(2);
  });

  it("`cartAriaLabel` nadaje odnośnikowi koszyka pełną nazwę dostępną", () => {
    const { container } = naglowek({ cartAriaLabel: "Koszyk, 2 pozycje" });
    expect(container.querySelector('a[href="/cart"]')!.getAttribute("aria-label")).toBe(
      "Koszyk, 2 pozycje",
    );
  });

  /*
    [F7b] Asercja przepisana: do belki ikonowej nazwą był WIDOCZNY napis
    „Koszyk", więc brak `aria-label` był stanem poprawnym i pełnym. Teraz napis
    jest `sr-only` — nazwa dalej pochodzi z treści (nie z atrybutu), ale musi
    tam BYĆ. Ikona bez nazwy to odnośnik, którego czytnik ekranu nie umie
    przeczytać, a takiego stanu poprzednia asercja by nie złapała.
  */
  it("bez `cartAriaLabel` nazwą jest tekst `sr-only` w środku kontrolki", () => {
    const { container } = naglowek();
    const cart = container.querySelector('a[href="/cart"]')!;
    expect(cart.hasAttribute("aria-label")).toBe(false);
    expect(cart.querySelector(".sr-only")!.textContent).toBe("Koszyk");
  });

  it("podgląd szkicu (bez odnośników) też niesie nazwę koszyka", () => {
    const { container } = naglowek({ interactive: false });
    const inert = container.querySelectorAll("[data-shell-inert]")[1]!;
    expect(inert.querySelector(".sr-only")!.textContent).toBe("Koszyk");
    expect(inert.querySelector("svg"), "podgląd stracił znak koszyka").not.toBeNull();
  });
});

/* ================================ F12 ================================ */

describe("F12 — znak firmy dostaje pas, którego nie bierze nikt inny", () => {
  /*
    CO BYŁO ZEPSUTE: właściciel zobaczył na telefonie znak firmy „mały
    w pizdu". Pudełko znaku było i jest w porządku (2,25 rem wysokości od
    ADR-160) — rozjechało się ROZDANIE PASA: znak jest `object-fit: contain`
    o szerokości oddanej przez flexa, więc dla pliku szerszego niż wysoki
    o rysowanej wysokości decyduje szerokość slotu. Po F7b pigułka terminu
    brała twarde 9 rem NA KAŻDEJ szerokości i na znak zostawało ~80 px przy
    oknie 390 — czyli 20 px wysokości przy proporcji 4:1.

    Naprawa siedzi w pigułce (F12 zdejmuje jej sufit i uczy zwijać człony),
    ale MECHANIZM, którym odzyskane piksele trafiają do znaku, jest tutaj:
    znak to jedyny element wiersza, który rośnie z wolnego miejsca. Te asercje
    pilnują właśnie mechanizmu — bez niego zwężenie pigułki oddałoby piksele
    pustce po prawej i uwaga właściciela wróciłaby przy następnej ikonie.
  */
  it("znak jest JEDYNYM elastycznym elementem wiersza (prawa grupa nie rośnie)", () => {
    const { container } = naglowek({ nav: <div data-test-nav /> });
    const brand = container.querySelector('a[href="/"]')!;
    const pudelko = brand.parentElement!;
    const grupa = container.querySelector("[data-test-nav]")!.parentElement!.parentElement!;

    expect(pudelko.className, "pudełko znaku przestało oddawać szerokość").toContain("shrink");
    expect(
      pudelko.className.split(/\s+/),
      "pudełko znaku dostało shrink-0 — przy ciasnym pasie belka wyjedzie poza dokument",
    ).not.toContain("shrink-0");
    /*
      `min-w-0` NA SAMYM ODNOŚNIKU: element flex ma domyślnie `min-width: auto`,
      więc bez tego znak trzyma pełną szerokość własną i to BELKA wyjeżdża.
    */
    expect(brand.className, "odnośnik znaku stracił min-w-0").toContain("min-w-0");
    /*
      Druga noga: prawa grupa NIE rośnie. Gdyby rosła, piksele odzyskane
      z pigułki poszłyby w odstęp między ikonami, a nie do znaku.
    */
    expect(grupa.className, "prawa grupa kontrolek zaczęła się rozciągać").toContain("shrink-0");
    for (const klasa of grupa.className.split(/\s+/)) {
      expect(/^(grow|flex-1)$/.test(klasa), `prawa grupa dostała „${klasa}"`).toBe(false);
    }
  });

  /*
    WYSOKOŚĆ PUDEŁKA ZNAKU JEST CELEM, NIE SKUTKIEM. Gdyby ktoś „naprawiał"
    małe logo zmniejszając deklarowaną wysokość (żeby mieściło się w wąskim
    slocie), znak stałby się mały NA STAŁE, także na desktopie — a wąskiego
    slotu i tak by to nie naprawiło. 2,25 rem = 36 px, powyżej celu z dyspozycji
    (28–32 px na telefonie).
  */
  it("pudełko znaku trzyma 2,25 rem wysokości i proporcje pliku", () => {
    const regula = /\.site-logo \{([^}]*)\}/.exec(ARKUSZ);
    expect(regula, "reguła `.site-logo` zniknęła z arkusza").not.toBeNull();
    const cialo = regula![1]!;
    expect(cialo, "wysokość znaku zjechała poniżej celu 28–32 px").toContain("height: 2.25rem");
    expect(cialo, "bez `contain` szeroki plik zostaje spłaszczony zamiast wpisany").toContain(
      "object-fit: contain",
    );
    /*
      Sufit szerokości jest MNIEJSZĄ z dwóch liczb: 12 rem to sufit projektowy,
      100% — sufit slotu. Bez drugiego członu plik 3000 × 200 wyjeżdża poza pas
      strony razem z belką (zmierzone przy oknie 360 px).
    */
    expect(cialo).toContain("max-width: min(12rem, 100%)");
  });
});
