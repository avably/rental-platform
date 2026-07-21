import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zakaz natywnych pól daty na WSZYSTKICH ekranach tenanta (decyzja
 * właściciela 2026-07-21; ADR-057 D6 dla zamówień, ADR-058 rozszerza zakres
 * na całą grupę tras `(panel)/**` wraz z katalogiem).
 *
 * Natywny `input type="date"` maluje się chromem systemu operacyjnego: nie
 * obowiązują na nim tokeny Fazy 2 ani stany sekcji 07, a wygląd i sposób
 * wpisywania różnią się między przeglądarkami. Daty wybiera się naszym
 * `Calendar` w `Popover` — jednym widżetem w całym panelu (`lib/fields`).
 *
 * Skan patrzy na KOD, nie na prozę: komentarze są usuwane przed
 * wyszukiwaniem, żeby zdanie „nigdy natywnym input type=date" w dokumentacji
 * modułu nie wywracało własnego kontraktu.
 */

const screensDir = resolve(process.cwd(), "app/[locale]/(panel)");
const helperDir = resolve(process.cwd(), "lib/fields");

function collectSources(dir: string): { path: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) return collectSources(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [{ path, source: readFileSync(path, "utf8") }];
  });
}

/**
 * Usuwa komentarze blokowe (`/* … *\/`, w tym `{/* … *\/}` z JSX) oraz linie
 * będące w całości komentarzem `//`. Świadomie NIE tyka `//` w środku linii —
 * tam mieszkają adresy URL, a ucięcie ich mogłoby ukryć prawdziwe wystąpienie.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const sources = collectSources(screensDir)
  .concat(collectSources(helperDir))
  .map((file) => ({ ...file, code: stripComments(file.source) }));

/** Ścieżka względem `app/[locale]/(panel)` — czytelniejsza w komunikatach. */
const relative = (path: string) => path.replace(`${screensDir}/`, "");

describe("kontrakt pól daty — wszystkie ekrany tenanta", () => {
  it("skan obejmuje realny zbiór plików, z katalogiem włącznie", () => {
    // Kontrola po pustym zbiorze: bez plików zakaz niżej broniłby niczego.
    expect(sources.length).toBeGreaterThanOrEqual(40);
    expect(sources.some((file) => file.path.endsWith("lib/fields/date-fields.tsx"))).toBe(true);
    // Podłoga ZAKRESU: rozszerzenie z P4 (same zamówienia) na CAŁĄ grupę tras
    // musi być widoczne w zbiorze, inaczej test cofnąłby się po cichu do P4.
    for (const segment of ["katalog/", "zamowienia/", "ustawienia-domen/", "bezpieczenstwo/"]) {
      expect(
        sources.some((file) => relative(file.path).startsWith(segment)),
        `skan nie objął ${segment}`,
      ).toBe(true);
    }
  });

  it("stripComments czyści prozę, ale zostawia kod", () => {
    // Bez tej asercji pusty wynik strippera dawałby zielone na pustym tekście.
    const probe = stripComments(
      [
        '/* type="date" w komentarzu */',
        '  // type="date" w linii',
        "const a = 'type=\"date\"';",
      ].join("\n"),
    );
    expect(probe).not.toContain('/* type="date"');
    expect(probe).toContain("const a =");
  });

  it("żaden ekran tenanta nie używa natywnego pola daty", () => {
    const offenders = sources
      .filter((file) => /type\s*=\s*["'{]?\s*["']?date["']?\s*["'}]?/.test(file.code))
      .map((file) => relative(file.path));

    expect(
      offenders,
      `natywny input daty zamiast Calendar w Popover: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("daty jadą przez wspólne pola na Calendarze", () => {
    // Podłoga użycia: gdyby ktoś usunął pola dat zamiast je przepiąć, zakaz
    // wyżej byłby spełniony przez sam brak dat.
    const fields = sources.find((file) => file.path.endsWith("lib/fields/date-fields.tsx"));
    expect(fields).toBeDefined();
    expect(fields!.code).toContain('mode="single"');
    expect(fields!.code).toContain('mode="range"');
    // Kontrakt wysyłki: wartość nadal jedzie ukrytym polem jako string ISO.
    expect(fields!.code).toContain('type="hidden"');

    const users = sources.filter((file) => /DateField|DateRangeField/.test(file.code));
    expect(users.map((file) => file.path.split("/").at(-1)!).sort()).toEqual([
      "date-fields.tsx",
      "extension-form.tsx",
      "order-wizard.tsx",
      "orders-date-filter.tsx",
      "unit-forms.tsx",
    ]);
  });

  it("zakres pokazuje jeden miesiąc na mobile i dwa od md", () => {
    const fields = sources.find((file) => file.path.endsWith("lib/fields/date-fields.tsx"));
    expect(fields).toBeDefined();
    expect(fields!.code).toContain('matchMedia("(min-width: 768px)")');
    expect(fields!.code).toMatch(/numberOfMonths=\{\w+\s*\?\s*2\s*:\s*1\}/);
    expect(fields!.code).not.toContain("numberOfMonths={2}");
  });
});
