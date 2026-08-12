/**
 * KRÓJ POWŁOKI JEST W REPOZYTORIUM, NIE W CUDZYM CDN-ie (dziennik 2026-08-12).
 *
 * `next/font/google` pobiera plik w czasie BUDOWANIA. 2026-08-12
 * `fonts.gstatic.com` przez kilkanaście minut oddawał 404 na wycofywaną
 * rodzinę adresów i wywrócił nam CI dwa razy — joby `ci` i `e2e`, komunikat
 * „Module not found: Can't resolve '@vercel/turbopack-next/internal/font/
 * google/font'". Ten sam commit zbudował się później bez ŻADNEJ zmiany, więc
 * czerwone CI mówiło o pogodzie u dostawcy, a nie o naszym kodzie.
 *
 * Ta bramka pilnuje stanu docelowego z obu stron: krój ma być deklarowany
 * przez `next/font/local`, a plik ma NAPRAWDĘ leżeć pod wskazaną ścieżką
 * (sam napis w źródle niczego nie dowodzi — sprawdzamy, czy ścieżka się
 * rozwiązuje i czy plik jest woff2). Zachowanie potwierdza sam build obu
 * aplikacji w CI: przy zerwanej ścieżce `next build` pada.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(process.cwd(), "../..");

/** Pliki powłok, które deklarują krój aplikacji. */
const DEKLARACJE = [
  "apps/panel/app/[locale]/layout.tsx",
  "apps/storefront/app/fonts.ts",
] as const;

/** Katalogi ze źródłami obu aplikacji — bez artefaktów budowania. */
const ZRODLA = ["apps/panel", "apps/storefront"] as const;
const POMIJANE = new Set([".next", "node_modules", ".turbo", "coverage"]);

function pliki(katalog: string): string[] {
  const wynik: string[] = [];
  for (const wpis of readdirSync(katalog)) {
    if (POMIJANE.has(wpis)) continue;
    const sciezka = resolve(katalog, wpis);
    if (statSync(sciezka).isDirectory()) wynik.push(...pliki(sciezka));
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(wpis)) wynik.push(sciezka);
  }
  return wynik;
}

describe("krój powłoki nie zależy od sieci w czasie budowania", () => {
  it("panel i sklep deklarują krój przez next/font/local, a wskazany plik ISTNIEJE", () => {
    for (const deklaracja of DEKLARACJE) {
      const sciezka = resolve(repoRoot, deklaracja);
      const zrodlo = readFileSync(sciezka, "utf8");
      expect(zrodlo.length, `${deklaracja} pusty?`).toBeGreaterThan(200);
      expect(zrodlo, `${deklaracja}: brak next/font/local`).toContain('from "next/font/local"');
      expect(zrodlo, `${deklaracja}: krój nie trzyma zmiennej --font-geist-sans`).toContain(
        '"--font-geist-sans"',
      );

      // Nie napis, tylko ŚCIEŻKA: wyjmujemy `src` i sprawdzamy, czy się rozwiązuje.
      const src = zrodlo.match(/src:\s*"(\.\.[^"]+\.woff2)"/)?.[1];
      expect(src, `${deklaracja}: deklaracja kroju bez ścieżki do pliku woff2`).toBeDefined();
      const plik = resolve(sciezka, "..", src!);
      expect(existsSync(plik), `${deklaracja}: src wskazuje na nieistniejący plik ${plik}`).toBe(
        true,
      );
      const bajty = readFileSync(plik);
      expect(bajty.subarray(0, 4).toString("latin1"), `${plik} to nie woff2`).toBe("wOF2");
      expect(bajty.length, `${plik} podejrzanie mały`).toBeGreaterThan(10_000);
    }
  });

  it("druga strona: żadne źródło panelu ani sklepu nie IMPORTUJE next/font/google", () => {
    // Szukamy importu, nie wzmianki — o nieboszczyku wolno pisać w komentarzu.
    const wzorzec = /(?:from|import|require)\s*\(?\s*["']next\/font\/google["']/;
    // Kontrola pozytywna wzorca: gdyby przestał łapać, „zero winnych" byłoby
    // prawdą o niedziałającym sicie, a nie o czystych źródłach.
    expect(wzorzec.test('import { Geist } from "next/font/google";')).toBe(true);
    expect(wzorzec.test('const g = await import("next/font/google");')).toBe(true);

    // Ten plik nosi wzorzec w kontroli pozytywnej wyżej — sam siebie pomija.
    const kontrakt = resolve(repoRoot, "apps/panel/test/shell-font-local-contract.test.ts");

    const winne: string[] = [];
    let przeskanowane = 0;
    for (const katalog of ZRODLA) {
      for (const plik of pliki(resolve(repoRoot, katalog))) {
        if (plik === kontrakt) continue;
        przeskanowane += 1;
        if (wzorzec.test(readFileSync(plik, "utf8"))) {
          winne.push(plik.slice(repoRoot.length + 1));
        }
      }
    }
    // Kontrola po pustym zbiorze: skan naprawdę czytał pliki obu aplikacji.
    expect(przeskanowane, "skan nie znalazł ŻADNEGO pliku źródłowego").toBeGreaterThan(200);
    expect(winne, `krój pobierany w czasie budowania:\n${winne.join("\n")}`).toEqual([]);
  });

  it("plik kroju leży obok treści licencji — OFL wymaga jej przy redystrybucji", () => {
    const licencja = resolve(repoRoot, "packages/ui/fonts/OFL-geist.txt");
    expect(existsSync(licencja), "brak packages/ui/fonts/OFL-geist.txt").toBe(true);
    const tresc = readFileSync(licencja, "utf8");
    expect(tresc).toContain("SIL OPEN FONT LICENSE");
  });
});
