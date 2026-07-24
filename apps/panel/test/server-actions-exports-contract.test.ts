/**
 * Kontrakt modułów `"use server"`: KAŻDY eksport musi być funkcją asynchroniczną.
 *
 * ================== DLACZEGO TO MA WŁASNY TEST ==================
 *
 * Ten test powstał z realnej awarii buildu, nie z ostrożności. Do
 * `deposit-actions.ts` (moduł akcji serwerowych) trafiła wyeksportowana stała
 * z kodem błędu bazy. Skutek NIE był lokalny: kompilator Next unieważnił CAŁY
 * zbiór eksportów modułu — „The module has no exports at all" — więc
 * `page.tsx` przestał widzieć `collectDepositAction` i `settleDepositAction`,
 * a build padł na ekranie, którego zmiana w ogóle nie dotyczyła.
 *
 * NIE ŁAPIE TEGO ANI TYPECHECK, ANI LINT, ANI VITEST: dla TypeScriptu
 * `export const X = "23P01"` jest poprawne, a vitest importuje ten plik jako
 * zwykły moduł, bez transformacji RSC. Jedyną bramką był `next build` —
 * czyli deploy. Ten test przenosi tę bramkę do suity, gdzie kosztuje sekundy
 * zamiast rundy CI.
 *
 * SKAN ŹRÓDŁA, NIE IMPORT. Zaimportowanie modułu akcji ciągnie za sobą
 * `next/headers` i klienta Supabase z sesją — czyli połowę środowiska
 * żądania. Reguła jest składniowa, więc sprawdzamy ją na składni.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const APP_ROOT = resolve(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "components"];

/** Wszystkie pliki .ts/.tsx pod wskazanymi katalogami aplikacji. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Dyrektywa musi stać na początku pliku (po komentarzach), nie w treści. */
function isServerActionsModule(source: string): boolean {
  return /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*["']use server["']\s*;?/.test(source);
}

const serverActionModules = SCAN_DIRS.flatMap((dir) => sourceFiles(join(APP_ROOT, dir)))
  .map((file) => ({ file, source: readFileSync(file, "utf8") }))
  .filter(({ source }) => isServerActionsModule(source));

describe("moduły akcji serwerowych — kontrakt eksportów", () => {
  it("w repo SĄ moduły `use server` (inaczej ten test niczego nie broni)", () => {
    // Test-przynęta: gdyby skan przestał cokolwiek znajdować (zmiana układu
    // katalogów, inny sposób deklarowania akcji), poniższa asercja świeciłaby
    // na zielono nad PUSTYM zbiorem — czyli udawałaby bramkę.
    expect(serverActionModules.length).toBeGreaterThan(0);
  });

  it("każdy WARTOŚCIOWY eksport modułu `use server` jest funkcją asynchroniczną", () => {
    // Dozwolone: `export async function x(...)` i `export default async function`.
    //
    // `export type` / `export interface` są WYŁĄCZONE z reguły, bo znikają przy
    // kompilacji — po transpilacji nie ma ich w zbiorze eksportów, więc niczego
    // nie unieważniają (i dlatego moduły akcji panelu, które je mają, budują się
    // dziś poprawnie). Reguła dotyczy eksportów, które przeżywają do runtime'u:
    // stałych, klas i funkcji synchronicznych.
    const offenders: string[] = [];

    for (const { file, source } of serverActionModules) {
      source.split("\n").forEach((line, index) => {
        if (!/^export\b/.test(line)) return;
        if (/^export\s+(?:type|interface)\b/.test(line)) return;
        if (/^export\s+async\s+function\s/.test(line)) return;
        if (/^export\s+default\s+async\s+function\b/.test(line)) return;
        offenders.push(`${relative(APP_ROOT, file)}:${index + 1} → ${line.trim()}`);
      });
    }

    expect(
      offenders,
      [
        "Moduł z dyrektywą `use server` eksportuje coś, co nie jest funkcją asynchroniczną.",
        "To NIE jest błąd lokalny: kompilator Next unieważnia wtedy WSZYSTKIE eksporty",
        "modułu, więc importujące ekrany przestają widzieć akcje, a build pada.",
        "Przenieś taki eksport do osobnego modułu (albo zostaw jako prywatną stałą).",
      ].join("\n"),
    ).toEqual([]);
  });
});
