import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import pl from "../messages/pl.json";

/**
 * Kontrakt treści stanów pustego i 404 (ADR-057).
 *
 * Copy tych ekranów jest w artefakcie (sekcja 07) i to ONO jest źródłem
 * prawdy — pusty ekran i 404 to miejsca, w których produkt najłatwiej zaczyna
 * mówić własnym, przypadkowym głosem. Test parsuje artefakt i porównuje ze
 * słownikiem PL, więc przepisanie komunikatu „przy okazji" nie przechodzi.
 */

const repositoryRoot = resolve(process.cwd(), "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

/** Blok `<article data-screen="…">` z sekcji 07. */
function screenBlock(screen: string): string {
  const block = artifact.match(
    new RegExp(`<article[^>]*data-screen="${screen}"[\\s\\S]*?<\\/article>`),
  );
  if (!block) throw new Error(`Brak ekranu ${screen} w artefakcie`);
  return block[0];
}

/**
 * Tekst pierwszego znacznika danego typu, bez zagnieżdżonych znaczników.
 * `\b` po nazwie jest konieczne: bez niego `<a` łapie `<article` i test
 * porównuje z treścią całego bloku zamiast z treścią odsyłacza.
 */
function textOf(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) throw new Error(`Brak <${tag}> w bloku`);
  return match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

const emptyBlock = screenBlock("empty");
const notFoundBlock = screenBlock("not-found");

describe("kontrakt copy stanów — artefakt Fazy 2 sekcja 07", () => {
  it("parser wyciąga niepuste teksty z obu ekranów", () => {
    // Kontrola po pustym zbiorze: porównania niżej muszą mieć co porównywać.
    for (const text of [
      textOf(emptyBlock, "h3"),
      textOf(emptyBlock, "button"),
      textOf(emptyBlock, "a"),
      textOf(notFoundBlock, "p"),
      textOf(notFoundBlock, "h3"),
      textOf(notFoundBlock, "a"),
    ]) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("pusty stan listy niesie copy i obie akcje z artefaktu", () => {
    expect(pl.orders.emptyState.title).toBe(textOf(emptyBlock, "h3"));
    expect(pl.orders.emptyState.addOrder).toBe(textOf(emptyBlock, "button"));
    expect(pl.orders.emptyState.goToCatalog).toBe(textOf(emptyBlock, "a"));
  });

  it("404 szczegółu niesie kod, copy i powrót z artefaktu", () => {
    expect(pl.orders.notFound.code).toBe(textOf(notFoundBlock, "p"));
    expect(pl.orders.notFound.title).toBe(textOf(notFoundBlock, "h3"));
    expect(pl.orders.notFound.backToOrders).toBe(textOf(notFoundBlock, "a"));
  });
});
