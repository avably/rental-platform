/**
 * `rel` NA LINKACH WYCHODZĄCYCH ŻYWEJ STRONY (E1, ADR-094 — sprzątanie z audytu).
 *
 * Znalezisko audytu: element `button` płótna v2 renderował `<a href>` BEZ `rel`,
 * a jego adres pochodzi od najemcy. Link do obcego hosta bez `noopener` oddaje
 * stronie docelowej `window.opener`, czyli uchwyt do karty klienta sklepu.
 *
 * Test jest ZAMIATAJĄCY, a nie punktowy: montuje stronę złożoną ze wszystkich
 * miejsc, w których na żywej ścieżce powstaje link (hero, baner CTA, stopka,
 * przycisk płótna, link w tekście sformatowanym, atrybucja zdjęcia) i pyta
 * KAŻDY link o `rel`. Test wypisany z nazwy dla sześciu przypadków przestałby
 * bronić siódmego w dniu, w którym ten siódmy powstał.
 */
import { structuredPresetFor, type SectionCanvas } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { externalLinkRel, EXTERNAL_LINK_REL } from "./links";
import { SiteRenderer } from "./site-renderer";
import type { RenderSection } from "./types";

afterEach(cleanup);

const OBCY = "https://przyklad.zewnetrzny.test/cennik";

const canvas: SectionCanvas = {
  version: 2,
  rows: 40,
  background: "default",
  elements: [
    {
      id: "b1",
      kind: "button",
      label: "Przycisk zewnętrzny",
      href: OBCY,
      variant: "solid",
      align: "left",
      layout: { desktop: { x: 0, y: 0, w: 20, h: 6, z: 0 } },
    },
    {
      id: "b2",
      kind: "button",
      label: "Przycisk wewnętrzny",
      href: "#kontakt",
      variant: "solid",
      align: "left",
      layout: { desktop: { x: 0, y: 8, w: 20, h: 6, z: 1 } },
    },
    {
      id: "t1",
      kind: "text",
      text: "Link w tekście",
      runs: [{ text: "Link w tekście", href: OBCY }],
      variant: "body",
      align: "left",
      layout: { desktop: { x: 0, y: 16, w: 40, h: 6, z: 2 } },
    },
    {
      id: "i1",
      kind: "image",
      alt: "Kadr",
      fit: "cover",
      source: {
        kind: "unsplash",
        url: "https://images.example.test/kadr.jpg",
        authorName: "Autor",
        authorUrl: "https://autor.example.test/",
      },
      layout: { desktop: { x: 0, y: 24, w: 40, h: 12, z: 3 } },
    },
  ],
} as unknown as SectionCanvas;

const SECTIONS = [
  {
    id: "hero",
    position: 0,
    type: "hero",
    content: { heading: "Hero", ctaText: "Do partnera", ctaHref: OBCY },
  },
  {
    id: "cta",
    position: 1,
    type: "cta",
    content: { heading: "Baner", buttonLabel: "Do partnera", buttonHref: OBCY },
  },
  {
    id: "footer",
    position: 2,
    type: "footer",
    content: {
      businessName: "Wypożyczalnia",
      legal: "© Wypożyczalnia",
      links: [
        { label: "Partner", href: OBCY },
        { label: "Regulamin", href: "/regulamin" },
      ],
    },
  },
  { id: "canvas", position: 3, type: "freeform", content: canvas },
  /*
   * GALERIA STRUKTURALNA (E3) wnosi DWA nowe źródła linków wychodzących: kafel
   * z odnośnikiem (adres od najemcy) i atrybucję autora zdjęcia. Test jest
   * ZAMIATAJĄCY, więc nowe miejsce ma wejść do PRÓBKI, a nie dostać własne
   * zdanie wypisane z nazwy — to jest cała jego wartość.
   */
  {
    id: "galeria",
    position: 4,
    type: "gallery",
    content: {
      ...structuredPresetFor("gallery", "pl"),
      items: [
        {
          ...((structuredPresetFor("gallery", "pl") as unknown as {
            items: Record<string, unknown>[];
          }).items[0] as Record<string, unknown>),
          link: OBCY,
        },
        { image: { kind: "storage", path: "tenant-a/site/a.jpg" }, alt: "Kadr", link: "/kontakt" },
      ],
    },
  },
] as unknown as RenderSection[];

describe("reguła `rel` (funkcja czysta)", () => {
  it("adres http(s) dostaje OBA tokeny", () => {
    expect(externalLinkRel("https://obcy.test/a")).toBe(EXTERNAL_LINK_REL);
    expect(externalLinkRel("http://obcy.test/a")).toBe(EXTERNAL_LINK_REL);
    expect(EXTERNAL_LINK_REL.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
  });

  it("kotwica, ścieżka własna i protokoły bez karty zostają bez `rel`", () => {
    for (const href of ["#kontakt", "/store", "/", "mailto:kontakt@przyklad.test", "tel:+48500600700"]) {
      expect(externalLinkRel(href), `„${href}” nie jest linkiem wychodzącym`).toBeUndefined();
    }
    expect(externalLinkRel(undefined)).toBeUndefined();
    expect(externalLinkRel("   ")).toBeUndefined();
  });
});

describe("żywa ścieżka: KAŻDY link wychodzący ma noopener i noreferrer", () => {
  it("zamiatanie po całej wyrenderowanej stronie", () => {
    const { container } = render(<SiteRenderer sections={SECTIONS} />);
    const external = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="http"]'),
    );

    // Kontrola po pustym zbiorze: gdyby renderer nic nie narysował, pętla niżej
    // byłaby zielona bez ani jednego sprawdzenia.
    expect(external.length, "strona testowa nie wystawiła linków wychodzących").toBeGreaterThanOrEqual(5);

    const braki = external
      .filter((link) => {
        const tokens = new Set((link.getAttribute("rel") ?? "").split(/\s+/));
        return !tokens.has("noopener") || !tokens.has("noreferrer");
      })
      .map((link) => `${link.textContent?.trim() || "(bez treści)"} → ${link.getAttribute("href")}`);

    expect(braki, `linki wychodzące bez pełnego rel:\n${braki.join("\n")}`).toEqual([]);
  });

  it("linki WEWNĘTRZNE zostają bez `rel` — atrybut niczego by tam nie chronił", () => {
    const { container } = render(<SiteRenderer sections={SECTIONS} />);
    const internal = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('a[href^="/"], a[href^="#"]'),
    );
    expect(internal.length, "brak linków wewnętrznych w próbce").toBeGreaterThan(0);
    for (const link of internal) {
      expect(link.hasAttribute("rel"), `zbędny rel na „${link.getAttribute("href")}”`).toBe(false);
    }
  });
});
