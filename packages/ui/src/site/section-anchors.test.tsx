// @vitest-environment jsdom

/**
 * KOTWICE SEKCJI W DOKUMENCIE — KONTRAKT RENDERU.
 *
 * ==================== TRZY ZDANIA, KTÓRYCH TU BRONIMY ====================
 *
 *   1. PRZYCISK NAPRAWDĘ MA DOKĄD PROWADZIĆ. Adres z treści (`#produkty`)
 *      i identyfikator w dokumencie muszą się spotkać. Zdanie mierzymy tak, jak
 *      mierzy je przeglądarka: bierzemy KAŻDY `href` zaczynający się od `#`
 *      z wyrenderowanej strony i szukamy elementu o takim `id`. Test „owijka ma
 *      atrybut id" przechodziłby także wtedy, gdyby rejestr kotwic rozjechał się
 *      z treścią co do jednej litery.
 *
 *   2. DOKUMENT ZOSTAJE POPRAWNY. Kotwicę dostaje pierwsza sekcja danego typu,
 *      więc strona z dwoma pasmami atutów nie ma dwóch elementów `id="atuty"`.
 *
 *   3. KOTWICE SĄ WYŁĄCZONE DOMYŚLNIE. To nie jest ostrożność, tylko warunek
 *      poprawności: galeria szablonów montuje SZEŚĆ stron w jednym dokumencie,
 *      a picker sekcji — po jednym podglądzie na wariant. Gołe `id` dałoby tam
 *      komplet duplikatów. Kontrola negatywna jest tu więc ważniejsza od
 *      pozytywnej i pali się na mutacji „włączmy kotwice na stałe".
 *
 * Czego ten plik NIE dowodzi: jsdom nie przewija okna, więc o tym, że cel nie
 * chowa się pod przyklejonym paskiem, wnioskujemy z ODCZYTU arkusza (noga
 * ostatnia) — tak samo jak przy animacjach wejścia.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SECTION_ANCHORS, SECTION_TYPES, presetContentFor } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const ARKUSZ = readFileSync(resolve(__dirname, "site.css"), "utf8");

function sekcja(id: string, type: (typeof SECTION_TYPES)[number]): RenderSection {
  return { id, position: 0, type, content: presetContentFor(type, "pl") } as RenderSection;
}

/** Strona z presetów: hero prowadzi na `#produkty`, stopka na `#kontakt`. */
function stronaZPresetow(): RenderSection[] {
  return [
    sekcja("s-hero", "hero"),
    sekcja("s-products", "products"),
    sekcja("s-contact", "contact"),
    sekcja("s-footer", "footer"),
  ];
}

/** Cele odnośników wewnątrzstronicowych, tak jak czyta je przeglądarka. */
function celeKotwic(root: HTMLElement): string[] {
  return [...root.querySelectorAll("a[href^='#']")].map((a) => a.getAttribute("href")!.slice(1));
}

/*
 * SPRZĄTANIE PO KAŻDYM RENDERZE JEST TU CZĘŚCIĄ POMIARU, a nie higieną.
 *
 * Ten plik pyta dokument o `#kotwica`, czyli dokładnie tak, jak pyta go
 * przeglądarka po kliknięciu w odnośnik. Zostawione w dokumencie poprzednie
 * rendery dają temu pytaniu WIĘCEJ NIŻ JEDNĄ odpowiedź — a jsdom rozwiązuje
 * selektor identyfikatora przez `getElementById` (pierwszy w CAŁYM dokumencie)
 * i dopiero potem sprawdza, czy trafiony element leży w zapytanym poddrzewie.
 * Bez sprzątania test mierzyłby więc kolejność montowania fikstur, a nie
 * kotwice — i to mierzyłby na czerwono.
 */
afterEach(cleanup);

describe("kotwice są wyłączone, dopóki powierzchnia ich nie włączy", () => {
  it("domyślnie żadna owijka nie niesie id", () => {
    // Mutacja „anchors domyślnie true" pali się TU, a nie u najemcy, który
    // otworzył galerię szablonów z sześcioma stronami w jednym dokumencie.
    const { container } = render(<SiteRenderer sections={stronaZPresetow()} />);
    expect(container.querySelectorAll("[data-section-id]")).toHaveLength(4);
    expect(container.querySelectorAll("[data-section-id][id]")).toHaveLength(0);
  });

  it("owijka domyślna zostaje PRZEZROCZYSTA — kotwica dokłada wyłącznie id", () => {
    const { container } = render(<SiteRenderer sections={stronaZPresetow()} anchors />);
    for (const owijka of container.querySelectorAll("[data-section-id]")) {
      expect(owijka.getAttributeNames().sort()).toEqual(["data-section-id", "id"]);
    }
  });

  it("własna owijka sekcji NIE dostaje kotwic — powierzchnia edycyjna ich nie ma", () => {
    // Płótno kreatora wnosi swoją owijkę i to ona rozstrzyga o znacznikach.
    // Kotwice zostają wtedy bez skutku — jawnie, a nie po połowie.
    const { container } = render(
      <SiteRenderer
        sections={stronaZPresetow()}
        anchors
        sectionWrapper={(section, children) => (
          <div data-canvas-section={section.id}>{children}</div>
        )}
      />,
    );
    expect(container.querySelectorAll("[id]")).toHaveLength(0);
  });
});

describe("kotwice włączone: przycisk ma dokąd prowadzić", () => {
  it("KAŻDY adres `#…` na wyrenderowanej stronie trafia w istniejący element", () => {
    const { container } = render(<SiteRenderer sections={stronaZPresetow()} anchors />);

    const cele = celeKotwic(container);
    // Kontrola po pustym zbiorze: bez odnośnika w treści cała pętla niżej
    // przechodzi dla zera adresów i nie broni niczego.
    expect(cele, "preset przestał kierować gdziekolwiek kotwicą").toContain("produkty");
    expect(cele, "stopka presetu przestała kierować na kontakt").toContain("kontakt");

    const martwe = cele.filter((cel) => container.querySelector(`[id="${cel}"]`) === null);
    expect(martwe, `adres bez celu w dokumencie: ${martwe.join(", ")}`).toEqual([]);
  });

  it("kotwicę niesie sekcja TEGO typu, którego dotyczy adres", () => {
    const { container } = render(<SiteRenderer sections={stronaZPresetow()} anchors />);
    expect(container.querySelector(`#${SECTION_ANCHORS.products}`)?.getAttribute("data-section-id")).toBe(
      "s-products",
    );
    expect(container.querySelector(`#${SECTION_ANCHORS.contact}`)?.getAttribute("data-section-id")).toBe(
      "s-contact",
    );
  });

  it("dwie sekcje tego samego typu = JEDNA kotwica (dokument zostaje poprawny)", () => {
    const { container } = render(
      <SiteRenderer
        sections={[sekcja("s-usp-1", "usp"), sekcja("s-products", "products"), sekcja("s-usp-2", "usp")]}
        anchors
      />,
    );
    expect(container.querySelectorAll(`[id="${SECTION_ANCHORS.usp}"]`)).toHaveLength(1);
    expect(container.querySelector(`#${SECTION_ANCHORS.usp}`)?.getAttribute("data-section-id")).toBe(
      "s-usp-1",
    );
  });

  it("identyfikatory na stronie ze WSZYSTKIMI typami sekcji są unikalne", () => {
    // Najostrzejszy wsad, jaki model dopuszcza: po jednej sekcji każdego typu.
    // Gdyby dwa typy dzieliły nazwę kotwicy, dokument miałby duplikat i to jest
    // jedyne miejsce, w którym widać to na renderze, a nie w samej tabeli.
    const { container } = render(
      <SiteRenderer sections={SECTION_TYPES.map((type) => sekcja(`s-${type}`, type))} anchors />,
    );
    const ids = [...container.querySelectorAll("[data-section-id][id]")].map((el) => el.id);
    expect(ids).toHaveLength(SECTION_TYPES.length);
    expect(new Set(ids).size, `powtórzony identyfikator sekcji: ${ids.join(", ")}`).toBe(ids.length);
  });
});

describe("arkusz: cel skoku nie ląduje pod krawędzią okna", () => {
  const REGULA = /\.site-root \[data-section-id\]\[id\] \{([^}]*)\}/;

  it("kontrola po pustym zbiorze: arkusz jest niepusty", () => {
    expect(ARKUSZ.length).toBeGreaterThan(1000);
  });

  it("owijka z kotwicą ma odstęp od góry — i to na CELU, nie na oknie", () => {
    /*
     * `scroll-margin` przy celu, a nie `scroll-padding` przy oknie: sekcje
     * renderuje ten sam kod w dwóch dokumentach o różnym chrome (sklep bez
     * przyklejonego nagłówka, podgląd szkicu z paskiem). Wartość przy celu
     * jedzie z sekcją wszędzie; wartość przy oknie trzeba by wpisać osobno
     * w arkusz każdej aplikacji i utrzymywać dwie liczby znaczące to samo.
     */
    const regula = ARKUSZ.match(REGULA);
    expect(regula, "arkusz stracił regułę odstępu przy kotwicy sekcji").not.toBeNull();
    expect(regula![1]).toMatch(/scroll-margin-top:\s*[^;]+;/);
  });

  it("selektor celuje w owijkę Z KOTWICĄ, a nie w każdą sekcję", () => {
    // `[data-section-id]` bez `[id]` dawałby odstęp także sekcjom bez kotwicy —
    // czyli KAŻDEJ sekcji na płótnie kreatora, gdzie nie ma czego omijać.
    expect(ARKUSZ).not.toMatch(/\.site-root \[data-section-id\] \{[^}]*scroll-margin/);
  });
});
