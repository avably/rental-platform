import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zakaz literałów tonu na ekranach zamówień (ADR-057).
 *
 * Reguła: rodzaj semantyczny statusu wynika WYŁĄCZNIE z `statusSemantics`
 * (ADR-055), nigdy z ręcznego `tone="…"` przy wartości. Bez tej bramki
 * najtańszą poprawką „ten chip ma zły kolor" jest wpisanie koloru z palca —
 * i po trzech takich poprawkach mapa semantyki przestaje cokolwiek znaczyć,
 * a artefakt i produkt rozjeżdżają się bez śladu w testach.
 *
 * Skan patrzy na ŹRÓDŁO, bo pilnuje sposobu pisania kodu, a nie wyniku
 * renderu (ten pilnuje `orders-screen-contract.test.tsx`).
 */

const screensDir = resolve(process.cwd(), "app/[locale]/(panel)/zamowienia");
const helperDir = resolve(process.cwd(), "lib/orders");

function collectSources(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

const sources = [...collectSources(screensDir), ...collectSources(helperDir)];

describe("kontrakt tonu statusów — ekrany zamówień", () => {
  it("skan obejmuje realny zbiór plików", () => {
    // Kontrola po pustym zbiorze: gdyby ścieżka się rozjechała, pętla niżej
    // przechodziłaby na zero plików i broniła niczego.
    expect(sources.length).toBeGreaterThanOrEqual(15);
    expect(sources.some((file) => file.path.endsWith("orders-table.tsx"))).toBe(true);
    expect(sources.some((file) => file.path.endsWith("status-chip.tsx"))).toBe(true);
  });

  it("żaden plik nie przypisuje tonu literałem", () => {
    const offenders = sources
      .filter((file) => /\btone\s*=\s*["'{]\s*["']/.test(file.source) || /\btone=["']/.test(file.source))
      .map((file) => file.path);

    expect(
      offenders,
      `ton wpisany z palca zamiast ze statusSemantics: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("jedynym źródłem tonu jest helper nad statusSemantics", () => {
    const helper = sources.find((file) => file.path.endsWith("lib/orders/status-chip.tsx"));
    expect(helper).toBeDefined();
    expect(helper!.source).toContain("statusSemantics[axis][value]");

    // Ekrany sięgają po ton wyłącznie przez ten helper — i naprawdę go używają
    // (inaczej zakaz literałów byłby spełniony przez brak statusów w ogóle).
    const users = sources.filter((file) => /StatusChip|statusBadgeProps/.test(file.source));
    expect(users.length).toBeGreaterThanOrEqual(4);
  });
});
