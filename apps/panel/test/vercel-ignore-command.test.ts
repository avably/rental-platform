/**
 * WARUNEK POMINIĘCIA BUILDU NA VERCELU (ADR-192 + aneks) — kontrakt z zależnościami.
 *
 * Limit Hobby to 100 deployów na dobę, a KAŻDY push budował oba projekty, także
 * gdy diff ich nie dotyczył. Reguła świeżej bazy wymusza rebase i push wszystkich
 * otwartych PR-ów po każdym merge'u, więc limit wyczerpał się dwukrotnie
 * (2026-08-13 i 2026-08-14). Warunek pominięcia mieszka w
 * `apps/<app>/scripts/vercel-ignore.sh` (per aplikacja, bo listy się różnią),
 * a `vercel.json` trzyma wyłącznie krótkie `ignoreCommand` wołające ten skrypt.
 *
 * ==================== TRZY PUŁAPKI, KTÓRE TEN PLIK PILNUJE ====================
 *
 * 1. LISTA PAKIETÓW MILCZY, GDY SIĘ ZDEZAKTUALIZUJE. Dołożenie `@avably/x` do
 *    aplikacji bez dopisania go do warunku sprawia, że Vercel POMIJA build,
 *    który był potrzebny — czyli produkcja zostaje na starym kodzie, bez
 *    jednego czerwonego sygnału.
 *
 * 2. ŚCIEŻKA BEZ PREFIKSU `:/` ZNACZY COŚ INNEGO, NIŻ WYGLĄDA. Vercel uruchamia
 *    `ignoreCommand` z katalogu projektu (`rootDirectory`), nie z korzenia repo.
 *    `git diff -- apps/panel` szuka wtedy `apps/panel/apps/panel`, nie znajduje
 *    NICZEGO i warunek zawsze mówi „pomiń" — żaden deploy się nie wykonuje,
 *    cicho. Zmierzone: z `apps/panel` ścieżka `:/apps/panel` daje exit 1 na
 *    commicie dotykającym panelu, a `apps/panel` daje exit 0.
 *
 * 3. SCHEMAT `vercel.json` UCINA `ignoreCommand` NA 256 ZNAKACH. Literał
 *    z pełną listą ścieżek miał 292 (panel) i 282 (storefront) — walidacja
 *    schematu wywracała KAŻDY deployment panelu ERROR-em przed startem builda
 *    („should NOT be longer than 256 characters"), więc produkcja stała na
 *    ostatnim dobrym buildzie. Dlatego warunek mieszka w skrypcie, a nie
 *    w literale.
 *
 * 4. `HEAD^..HEAD` GUBI ZMIANY PRZY NAPRZEMIENNYCH MERGE'ACH. Porównanie tylko
 *    z rodzicem widzi jeden commit. Gdy do main lecą szybko merge'y raz jednej,
 *    raz drugiej aplikacji, build dotykający aplikacji bywa auto-anulowany przez
 *    kolejny commit, a build tego kolejnego pomija aplikację (bo JEGO HEAD^..HEAD
 *    jej nie tyka) — produkcja stoi na starym kodzie bez sygnału (incydent
 *    2026-08-25). Dlatego warunek porównuje z OSTATNIM WDROŻONYM commitem
 *    (`VERCEL_GIT_PREVIOUS_SHA`), a przy jego braku/niedostępności buduje.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const korzen = resolve(process.cwd(), "../..");

/** Limit długości `ignoreCommand` w schemacie vercel.json (patrz pułapka 3). */
const LIMIT_SCHEMATU_VERCELA = 256;

function czytaj(sciezka: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(korzen, sciezka), "utf8")) as Record<string, unknown>;
}

/** Treść skryptu z warunkiem pominięcia — to TU mieszka lista ścieżek. */
function warunekZeSkryptu(app: string): string {
  return readFileSync(resolve(korzen, `apps/${app}/scripts/vercel-ignore.sh`), "utf8");
}

function pakietyWewnetrzne(app: string): string[] {
  const pkg = czytaj(`apps/${app}/package.json`);
  const deps = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };
  return Object.keys(deps)
    .filter((n) => n.startsWith("@avably/"))
    .map((n) => n.slice("@avably/".length))
    .sort();
}

const APLIKACJE = ["panel", "storefront"] as const;

describe("ignoreCommand: warunek pominięcia buildu", () => {
  for (const app of APLIKACJE) {
    describe(app, () => {
      const komenda = String(czytaj(`apps/${app}/vercel.json`).ignoreCommand ?? "");
      const warunek = warunekZeSkryptu(app);
      const pakiety = pakietyWewnetrzne(app);

      it("warunek w ogóle istnieje i ma kształt do sprawdzania", () => {
        // Kontrola po pustym zbiorze: bez niej wszystkie asercje niżej
        // przechodziłyby dlatego, że nie ma czego sprawdzać.
        expect(komenda.length).toBeGreaterThan(0);
        expect(warunek.length).toBeGreaterThan(0);
        expect(pakiety.length).toBeGreaterThan(0);
        expect(warunek).toContain("git diff --quiet");
        // Porównanie z OSTATNIM WDROŻONYM commitem, nie z HEAD^ (patrz pułapka 4).
        expect(warunek).toContain("VERCEL_GIT_PREVIOUS_SHA");
      });

      it("ignoreCommand w vercel.json mieści się w limicie schematu Vercela (patrz pułapka 3)", () => {
        expect(
          komenda.length,
          `ignoreCommand ${app} ma ${komenda.length} znaków — schemat Vercela ucina na ${LIMIT_SCHEMATU_VERCELA} i deploy pada ERROR-em przed buildem`,
        ).toBeLessThan(LIMIT_SCHEMATU_VERCELA);
      });

      it("ignoreCommand wskazuje istniejący plik skryptu", () => {
        // Kształt `sh scripts/vercel-ignore.sh` — ostatni token to ścieżka
        // względem katalogu projektu (Vercel uruchamia komendę stamtąd).
        const tokeny = komenda.trim().split(/\s+/);
        const sciezka = tokeny[tokeny.length - 1] ?? "";
        expect(sciezka.length).toBeGreaterThan(0);
        expect(
          existsSync(resolve(korzen, "apps", app, sciezka)),
          `ignoreCommand ${app} wskazuje ${sciezka}, a takiego pliku nie ma w apps/${app}`,
        ).toBe(true);
      });

      it("KAŻDA zależność @avably/* jest w warunku", () => {
        for (const p of pakiety) {
          expect(warunek, `brak packages/${p} w warunku ${app}`).toContain(`:/packages/${p}`);
        }
      });

      it("własny katalog aplikacji jest w warunku", () => {
        expect(warunek).toContain(`:/apps/${app}`);
      });

      it("ŻADNA ścieżka nie jest podana bez prefiksu :/ (patrz pułapka 2)", () => {
        const bezPrefiksu = warunek
          .split(/\s+/)
          .filter((t) => /^(apps|packages)\//.test(t) || /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/.test(t));
        expect(bezPrefiksu, `ścieżki bez :/ znaczą co innego: ${bezPrefiksu.join(", ")}`).toEqual([]);
      });

      it("pliki korzenia wymuszające przebudowę są w warunku", () => {
        for (const plik of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json"]) {
          expect(warunek, `brak ${plik}`).toContain(`:/${plik}`);
        }
      });

      it("brak sha ostatniego wdrożenia buduje, zamiast pomijać", () => {
        // Płytki klon / pierwszy deploy / niedostępny sha: lepiej zbudować
        // niepotrzebnie niż pominąć potrzebne. Warunek porównuje z OSTATNIM
        // WDROŻONYM commitem (VERCEL_GIT_PREVIOUS_SHA); gdy go brak albo nie ma
        // w płytkim klonie — exit 1 (buduj) PRZED jakimkolwiek diffem.
        expect(warunek).toContain("VERCEL_GIT_PREVIOUS_SHA");
        expect(warunek).toContain("exit 1");
        expect(warunek.indexOf("exit 1")).toBeLessThan(warunek.indexOf("git diff"));
      });
    });
  }

  it("panel ma packages/pdf, storefront go NIE ma (różnica jest zamierzona)", () => {
    const panel = warunekZeSkryptu("panel");
    const sklep = warunekZeSkryptu("storefront");
    expect(pakietyWewnetrzne("panel")).toContain("pdf");
    expect(pakietyWewnetrzne("storefront")).not.toContain("pdf");
    expect(panel).toContain(":/packages/pdf");
    expect(sklep).not.toContain(":/packages/pdf");
  });
});
