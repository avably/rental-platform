/**
 * WARUNEK POMINIĘCIA BUILDU NA VERCELU (ADR-192) — kontrakt z zależnościami.
 *
 * Limit Hobby to 100 deployów na dobę, a KAŻDY push budował oba projekty, także
 * gdy diff ich nie dotyczył. Reguła świeżej bazy wymusza rebase i push wszystkich
 * otwartych PR-ów po każdym merge'u, więc limit wyczerpał się dwukrotnie
 * (2026-08-13 i 2026-08-14). `ignoreCommand` w `vercel.json` odcina buildy,
 * których diff nie dotyczy.
 *
 * ==================== DWIE PUŁAPKI, KTÓRE TEN PLIK PILNUJE ====================
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
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const korzen = resolve(process.cwd(), "../..");

function czytaj(sciezka: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(korzen, sciezka), "utf8")) as Record<string, unknown>;
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
      const pakiety = pakietyWewnetrzne(app);

      it("warunek w ogóle istnieje i ma kształt do sprawdzania", () => {
        // Kontrola po pustym zbiorze: bez niej wszystkie asercje niżej
        // przechodziłyby dlatego, że nie ma czego sprawdzać.
        expect(komenda.length).toBeGreaterThan(0);
        expect(pakiety.length).toBeGreaterThan(0);
        expect(komenda).toContain("git diff --quiet HEAD^ HEAD");
      });

      it("KAŻDA zależność @avably/* jest w warunku", () => {
        for (const p of pakiety) {
          expect(komenda, `brak packages/${p} w warunku ${app}`).toContain(`:/packages/${p}`);
        }
      });

      it("własny katalog aplikacji jest w warunku", () => {
        expect(komenda).toContain(`:/apps/${app}`);
      });

      it("ŻADNA ścieżka nie jest podana bez prefiksu :/ (patrz pułapka 2)", () => {
        const bezPrefiksu = komenda
          .split(/\s+/)
          .filter((t) => /^(apps|packages)\//.test(t) || /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/.test(t));
        expect(bezPrefiksu, `ścieżki bez :/ znaczą co innego: ${bezPrefiksu.join(", ")}`).toEqual([]);
      });

      it("pliki korzenia wymuszające przebudowę są w warunku", () => {
        for (const plik of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json"]) {
          expect(komenda, `brak ${plik}`).toContain(`:/${plik}`);
        }
      });

      it("brak rodzica commita buduje, zamiast pomijać", () => {
        // Płytki klon albo pierwszy build: lepiej zbudować niepotrzebnie niż
        // pominąć potrzebne.
        expect(komenda).toContain("git rev-parse HEAD^");
        expect(komenda.indexOf("git rev-parse HEAD^")).toBeLessThan(komenda.indexOf("git diff"));
      });
    });
  }

  it("panel ma packages/pdf, storefront go NIE ma (różnica jest zamierzona)", () => {
    const panel = String(czytaj("apps/panel/vercel.json").ignoreCommand ?? "");
    const sklep = String(czytaj("apps/storefront/vercel.json").ignoreCommand ?? "");
    expect(pakietyWewnetrzne("panel")).toContain("pdf");
    expect(pakietyWewnetrzne("storefront")).not.toContain("pdf");
    expect(panel).toContain(":/packages/pdf");
    expect(sklep).not.toContain(":/packages/pdf");
  });
});
