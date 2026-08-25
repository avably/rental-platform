/**
 * OBRYS POLA FORMULARZA MA KONTRAST GRANICY KOMPONENTU (S-32, audyt UX
 * 2026-08-25, WCAG 1.4.11).
 *
 * Dekoracyjna kreska pasa (`--site-border`) miała wobec bieli ~1,2:1 — pole
 * formularza znikało z tła. Kontrakt: obrys `.site-field` powstaje z MIESZANKI
 * tuszu karty z jej powierzchnią (>=50% tuszu), więc dziedziczy gwarancję
 * kontrastu pary tusz↔powierzchnia z macierzy ról W KAŻDYM motywie.
 *
 * Test jest ŹRÓDŁOWY z konieczności (jsdom nie liczy `color-mix`), ale
 * ZAWĘŻONY do wyciętego bloku reguły `.site-field` — nie skanuje pliku na
 * ślepo (lekcja: regex file-wide ma ślepą plamę na przemieszczenie literału).
 * Dowód liczbowy (obliczony kontrast z computed style) niesie przebieg
 * wizualny CDP w raporcie zadania.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function siteFieldRule(): string {
  const css = readFileSync(join(__dirname, "site.css"), "utf8");
  const start = css.indexOf(".site-field {");
  expect(start, "brak reguły .site-field w site.css").toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

/** Pełna deklaracja `border:` reguły — od dwukropka do średnika (bywa łamana). */
function borderDeclaration(): string {
  const rule = siteFieldRule();
  const start = rule.indexOf("border:");
  expect(start, "reguła .site-field nie deklaruje border").toBeGreaterThan(-1);
  return rule.slice(start, rule.indexOf(";", start)).replace(/\s+/g, " ");
}

describe("obrys .site-field (S-32)", () => {
  it("border to mieszanka TUSZU karty z jej powierzchnią, o udziale tuszu >= 50%", () => {
    const border = borderDeclaration();
    const mix = border.match(
      /color-mix\(in srgb, var\(--site-band-card-ink\) (\d+)%, var\(--site-band-card-surface\)\)/,
    );
    expect(mix, `obrys nie miesza tuszu karty z powierzchnią: ${border}`).not.toBeNull();
    expect(Number(mix![1])).toBeGreaterThanOrEqual(50);
  });

  it("obrys NIE spada na dekoracyjną kreskę pasa (--site-border)", () => {
    expect(borderDeclaration()).not.toContain("var(--site-border)");
  });
});
