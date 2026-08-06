/**
 * TREŚĆ SFORMATOWANA W RENDERZE — DRUGA POŁOWA DOWODU (K3, ADR-086).
 *
 * Schemat w `@avably/core` dowodzi, że wrogi ADRES nie przejdzie. Ten plik
 * dowodzi rzeczy komplementarnej: że wrogi TEKST, który przejść MA (bo to
 * tekst), nigdy nie stanie się znacznikiem. Obie połowy są konieczne — sam
 * schemat nie broni przed renderem, który wsadzi treść przez `innerHTML`.
 *
 * Sprawdzamy WYNIK (co wylądowało w dokumencie) i SPOSÓB (czy w źródłach
 * renderu w ogóle istnieje droga do wstrzyknięcia HTML-u). Skan źródeł jest
 * tu istotny: test na wyniku przechodzi także wtedy, gdy ktoś dołoży
 * `dangerouslySetInnerHTML` w gałęzi, której akurat nie renderujemy.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SectionCanvas } from "@avably/core/site";
import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

const WROGI_TEKST = '<script>alert(1)</script><img src=x onerror=alert(2)>';

function canvasWith(elements: SectionCanvas["elements"]): SectionCanvas {
  return { version: 2, rows: 40, background: "default", elements };
}

function renderCanvas(canvas: SectionCanvas) {
  const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
  return render(<SiteRenderer sections={sections} />);
}

describe("formatowanie składa się ze ZNACZNIKÓW REACTA", () => {
  const canvas = canvasWith([
    {
      id: "t1",
      kind: "text",
      text: "Sprzęt na już z cennikiem",
      runs: [
        { text: "Sprzęt " },
        { text: "na już", bold: true },
        { text: " z " },
        { text: "cennikiem", italic: true, href: "/cennik" },
      ],
      variant: "body",
      align: "left",
      layout: { desktop: { x: 0, y: 0, w: 100, h: 10, z: 0 } },
    },
  ] as SectionCanvas["elements"]);

  it("pogrubienie i pochylenie wychodzą jako <strong>/<em>", () => {
    const { container } = renderCanvas(canvas);
    expect(container.querySelector("strong")?.textContent).toBe("na już");
    expect(container.querySelector("em")?.textContent).toBe("cennikiem");
  });

  it("link niesie adres z treści i domknięty rel", () => {
    const { container } = renderCanvas(canvas);
    const link = container.querySelector("a[href='/cennik']");
    expect(link).not.toBeNull();
    expect(link?.getAttribute("rel")).toContain("noopener");
  });

  it("cała treść czyta się tak samo, jak tekst prosty elementu", () => {
    const { container } = renderCanvas(canvas);
    expect(container.textContent).toContain("Sprzęt na już z cennikiem");
  });

  it("element BEZ runów renderuje sam tekst", () => {
    const { container } = renderCanvas(
      canvasWith([
        {
          id: "t2",
          kind: "text",
          text: "Bez formatowania",
          variant: "body",
          align: "left",
          layout: { desktop: { x: 0, y: 0, w: 100, h: 10, z: 0 } },
        },
      ] as SectionCanvas["elements"]),
    );
    expect(container.textContent).toContain("Bez formatowania");
    expect(container.querySelector("strong")).toBeNull();
  });
});

describe("wrogi tekst zostaje TEKSTEM", () => {
  const canvas = canvasWith([
    {
      id: "x1",
      kind: "heading",
      text: WROGI_TEKST,
      runs: [{ text: WROGI_TEKST, bold: true }],
      level: 2,
      align: "left",
      layout: { desktop: { x: 0, y: 0, w: 100, h: 10, z: 0 } },
    },
  ] as SectionCanvas["elements"]);

  it("w dokumencie NIE POWSTAJE ani skrypt, ani obrazek z obsługą błędu", () => {
    const { container } = renderCanvas(canvas);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("napis jest widoczny jako TREŚĆ — czyli naprawdę doszedł do renderu", () => {
    // Kontrola po pustym zbiorze: gdyby render pomijał treść, asercje wyżej
    // przechodziłyby, nie broniąc niczego.
    const { container } = renderCanvas(canvas);
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });

  it("w wygenerowanym HTML-u znaczniki są ZAESCAPE'OWANE", () => {
    const sections = [{ id: "s1", position: 0, type: "hero", content: canvas }] as RenderSection[];
    const html = renderToStaticMarkup(<SiteRenderer sections={sections} />);
    expect(html).toContain("&lt;script&gt;");
    // Sedno: żaden ZNACZNIK nie powstał. Sam napis „onerror=" w treści jest
    // nieszkodliwy (siedzi w zaescape'owanym tekście) — groźny byłby atrybut
    // na prawdziwym elemencie, czyli `<img` albo `<script` w wyjściu.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
  });
});

describe("w renderze NIE MA drogi do wstrzyknięcia HTML-u", () => {
  /**
   * Komentarze WYPADAJĄ ze skanu — inaczej zdanie o tym, DLACZEGO nie wolno
   * wstrzykiwać HTML-u, samo zapalałoby ten test na czerwono i albo znikłoby
   * wyjaśnienie, albo kontrakt (ta sama lekcja co w kontrakcie kontenerowym).
   */
  const read = (path: string) =>
    readFileSync(resolve(process.cwd(), "../..", path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

  const ZRODLA_RENDERU = [
    "packages/ui/src/site/element-canvas.tsx",
    "packages/ui/src/site/sections.tsx",
    "packages/ui/src/site/site-renderer.tsx",
  ] as const;

  it.each(ZRODLA_RENDERU)("%s nie używa dangerouslySetInnerHTML", (path) => {
    const source = read(path);
    // Kontrola pozytywna: plik musi naprawdę być źródłem renderu.
    expect(source.length).toBeGreaterThan(500);
    expect(source, "render wstrzykuje HTML — treść operatora przestaje być tekstem").not.toContain(
      "dangerouslySetInnerHTML",
    );
  });

  it("JEDYNE dozwolone wstrzyknięcie wstrzykuje STAŁĄ, a nie dane", () => {
    /*
     * Skrypt uzbrajający wejście sekcji (ADR-097) musi wejść do dokumentu
     * inline, więc ma własny plik i własne, węższe zdanie zamiast rozszczelnienia
     * skanu wyżej. Pytamy o dwie rzeczy: że wstrzykiwana jest IMPORTOWANA STAŁA
     * (nie napis składany na miejscu) i że plik nie przyjmuje żadnej treści —
     * jedyny props jedzie atrybutem, czyli drogą, którą React escape'uje.
     */
    const source = read("packages/ui/src/site/site-reveal-script.tsx");
    expect(source.length).toBeGreaterThan(200);
    // Wyłuskujemy KAŻDĄ wstrzykiwaną wartość i pytamy, czy jest to dokładnie
    // importowana stała. Regex z wyprzedzeniem negatywnym dałby się tu obejść
    // przez nawrót silnika wyrażeń, więc porównujemy wprost.
    const wstrzykiwane = [...source.matchAll(/__html:\s*([^}]+?)\s*\}/g)].map(([, v]) => (v ?? "").trim());
    expect(wstrzykiwane, "brak wstrzyknięcia — plik przestał być tym, czym był").not.toEqual([]);
    expect(wstrzykiwane, "wstrzyknięcie dostaje coś innego niż samą stałą").toEqual([
      "SITE_REVEAL_SCRIPT",
    ]);
    expect(source, "plik przyjmuje treść do wstrzyknięcia").not.toMatch(/\$\{/);
    expect(source, "wstrzyknięcie skleja napis").not.toContain("__html: `");
  });

  it("składanie formatowania idzie przez elementy Reacta, nie przez string", () => {
    const source = read("packages/ui/src/site/element-canvas.tsx");
    expect(source).toContain("<strong>");
    expect(source).toContain("<em>");
  });
});
