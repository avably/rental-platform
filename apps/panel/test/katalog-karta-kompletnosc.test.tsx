import { formatMoney } from "@avably/core";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

/**
 * KOMPLETNOŚĆ karty mobilnej katalogu (ADR-205) — druga bramka pary z
 * geometrią (`packages/e2e/tests/09-katalog-mobilny.spec.ts`), wzorzec
 * ADR-188/ADR-204: najtańszym sposobem, żeby cokolwiek „zmieściło się" na
 * telefonie, jest wyrzucenie z tego danych — a bramka geometryczna byłaby
 * wtedy zielona. Dlatego ten test przypina KOMPLET kolumn tabeli na karcie:
 * miniatura, nazwa, cena/doba, kaucja, egzemplarze, dziś w terenie, status
 * publikacji i akcje — wszystko NA WIERZCHU (zero `<details>`, zero `hidden`
 * na polach danych), bo operator na telefonie ma widzieć to samo co przy
 * biurku.
 *
 * Render jak w `catalog-screen-contract` — `renderToStaticMarkup` w node,
 * `Link` z next-intl podmieniony na kotwicę. Ten test NIE mierzy pikseli
 * (jsdom nie liczy layoutu — reguła repo); geometria mieszka w chromium.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/katalog",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { ProductsTable } = await import("@/app/[locale]/(panel)/katalog/products-table");
const { resolveProductSort } = await import("@/lib/catalog/product-sort");

const rows = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Nagrzewnica olejowa 20 kW",
    basePriceDayGrosze: 54000,
    depositGrosze: 120000,
    active: true,
    unitCount: 3,
    deployedToday: 1,
    thumbnail: {
      url: "http://127.0.0.1:54321/storage/v1/object/public/product-images/t/p/a.jpg",
      alt: "Nagrzewnica na stojaku",
    },
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    name: "Zestaw nagłośnieniowy 600 W",
    basePriceDayGrosze: 49500,
    depositGrosze: 0,
    active: false,
    unitCount: 0,
    deployedToday: 0,
    thumbnail: null,
  },
];

const html = renderToStaticMarkup(
  <NextIntlClientProvider locale="pl" messages={messages}>
    <ProductsTable
      rows={rows}
      currency="PLN"
      locale="pl"
      sort={resolveProductSort(undefined, undefined)}
      baseParams={{}}
    />
  </NextIntlClientProvider>,
);

/** Bloki kart w kolejności wierszy — `<li data-product-card …>…</li>`. */
const cards = [...html.matchAll(/<li[^>]*data-product-card[^>]*>([\s\S]*?)<\/li>/g)].map(
  (match) => match[0],
);

/** Komplet pól karty = komplet kolumn tabeli. */
const CARD_FIELDS = [
  "thumbnail",
  "name",
  "price",
  "deposit",
  "units",
  "deployed",
  "availability",
  "actions",
] as const;

describe("karta mobilna katalogu — kompletność (ADR-205)", () => {
  it("fixture pokrywa oba stany dostępności, kartę ze zdjęciem i bez", () => {
    // Kontrola po pustym zbiorze: bez niej asercje niżej mogłyby nie obejrzeć
    // ani jednej karty i wciąż być zielone.
    expect(rows.some((row) => row.active)).toBe(true);
    expect(rows.some((row) => !row.active)).toBe(true);
    expect(rows.some((row) => row.thumbnail !== null)).toBe(true);
    expect(rows.some((row) => row.thumbnail === null)).toBe(true);
    expect(cards).toHaveLength(rows.length);
  });

  it("każda karta niesie KOMPLET pól tabeli", () => {
    for (const [index, card] of cards.entries()) {
      for (const field of CARD_FIELDS) {
        expect(card, `karta ${index} bez pola ${field}`).toContain(`data-card-field="${field}"`);
      }
    }
  });

  it("wartości pól to dane wiersza, nie atrapy", () => {
    for (const [index, row] of rows.entries()) {
      const card = cards[index]!;
      expect(card, `karta ${index}: nazwa`).toContain(row.name);
      expect(card, `karta ${index}: cena/doba`).toContain(
        formatMoney(row.basePriceDayGrosze, "PLN", "pl"),
      );
      // Kaucja jest na karcie ZAWSZE — także 0,00 zł: brak kwoty wyglądałby
      // jak brak danych, a 0 to informacja („bez kaucji"), nie jej brak.
      expect(card, `karta ${index}: kaucja`).toContain(formatMoney(row.depositGrosze, "PLN", "pl"));
      expect(card, `karta ${index}: status`).toContain(
        row.active ? messages.catalog.list.activeYes : messages.catalog.list.activeNo,
      );
    }
    // „Dziś w terenie" tym samym zapisem co tabela: „x z y" albo myślnik.
    expect(cards[0], "karta 0: teren").toContain("1 z 3");
    expect(cards[1], "karta 1: teren przy zerze egzemplarzy").toContain(
      messages.catalog.list.deployedNone,
    );
    // Miniatura: obraz na karcie ze zdjęciem, placeholder na karcie bez.
    expect(cards[0]).toMatch(/<img[^>]*data-product-thumbnail="image"/);
    expect(cards[1]).toMatch(/<span[^>]*data-product-thumbnail="placeholder"/);
    expect(cards[1]).not.toContain('data-product-thumbnail="image"');
  });

  it("nic nie chowa się za rozwinięciem ani pod hidden", () => {
    for (const [index, card] of cards.entries()) {
      expect(card, `karta ${index}: <details>`).not.toContain("<details");
      // Pola danych stoją na wierzchu. `aria-hidden` wolno mieć wyłącznie
      // elementom DEKORACYJNYM (glif placeholdera, „•••" triggera) — nigdy
      // samemu polu danych.
      for (const field of CARD_FIELDS) {
        const tag = card.match(new RegExp(`<[a-z]+[^>]*data-card-field="${field}"[^>]*>`))?.[0];
        expect(tag, `karta ${index}: brak znacznika pola ${field}`).toBeDefined();
        expect(tag, `karta ${index}: pole ${field} ukryte`).not.toMatch(
          /\b(?:hidden|aria-hidden)=/,
        );
      }
    }
  });

  it("akcje są dostępne z karty i stoją POZA kotwicą nazwy", () => {
    for (const [index, row] of rows.entries()) {
      const card = cards[index]!;
      // Trigger menu akcji (button z etykietą nazwaną produktem) jest w karcie…
      const trigger = card.match(/<button[^>]*aria-label="([^"]*)"[^>]*>/);
      expect(trigger, `karta ${index}: brak triggera akcji`).not.toBeNull();
      expect(trigger![1]).toContain(row.name);
      // …a żadna kotwica karty nie zawiera kontrolki: button w <a> to
      // niepoprawny HTML i pułapka na klik (lekcja kart zamówień).
      for (const anchor of [...card.matchAll(/<a[^>]*>([\s\S]*?)<\/a>/g)]) {
        expect(anchor[1], `karta ${index}: kontrolka wewnątrz kotwicy`).not.toMatch(
          /<(?:button|input)[\s>]/,
        );
      }
    }
  });

  it("warianty są rozłączne progiem md: karty do md, tabela od md", () => {
    // Statyczna połowa bramki „brak podwójnego renderu" — komputowaną
    // widoczność mierzy w chromium spec 09 (jsdom nie liczy layoutu).
    const list = html.match(/<ul[^>]*>/)?.[0];
    expect(list, "brak listy kart").toBeDefined();
    expect(list).toContain("md:hidden");
    const tableWrap = html.match(/<div[^>]*class="[^"]*overflow-x-auto[^"]*"[^>]*>/)?.[0];
    expect(tableWrap, "brak ramki tabeli").toBeDefined();
    expect(tableWrap).toMatch(/class="[^"]*\bhidden\b[^"]*"/);
    expect(tableWrap).toContain("md:block");
    // Tabela desktopowa NIETKNIĘTA co do zachowania: znaczniki wierszy
    // (`data-product-row`/`data-product-id`) zostają — mogą na nich wisieć
    // testy i sondy spoza tego pakietu.
    expect([...html.matchAll(/data-product-row/g)]).toHaveLength(rows.length);
    expect([...html.matchAll(/data-product-id/g)]).toHaveLength(rows.length * 2);
  });
});
