import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Zakaz natywnych pól daty na ekranach zamówień (decyzja właściciela
 * 2026-07-21, ADR-057).
 *
 * Natywny `input type="date"` maluje się chromem systemu operacyjnego: nie
 * obowiązują na nim tokeny Fazy 2 ani stany sekcji 07, a wygląd i sposób
 * wpisywania różnią się między przeglądarkami. Daty wybiera się naszym
 * `Calendar` w `Popover` — jednym widżetem w całym panelu.
 *
 * Skan patrzy na KOD, nie na prozę: komentarze są usuwane przed
 * wyszukiwaniem, żeby zdanie „nigdy natywnym input type=date" w dokumentacji
 * modułu nie wywracało własnego kontraktu.
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

/**
 * Usuwa komentarze blokowe (`/* … *\/`, w tym `{/* … *\/}` z JSX) oraz linie
 * będące w całości komentarzem `//`. Świadomie NIE tyka `//` w środku linii —
 * tam mieszkają adresy URL, a ucięcie ich mogłoby ukryć prawdziwe wystąpienie.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const sources = collectSources(screensDir)
  .concat(collectSources(helperDir))
  .map((file) => ({ ...file, code: stripComments(file.source) }));

describe("kontrakt pól daty — ekrany zamówień", () => {
  it("skan obejmuje realny zbiór plików", () => {
    // Kontrola po pustym zbiorze: bez plików zakaz niżej broniłby niczego.
    expect(sources.length).toBeGreaterThanOrEqual(15);
    expect(sources.some((file) => file.path.endsWith("date-fields.tsx"))).toBe(true);
  });

  it("stripComments czyści prozę, ale zostawia kod", () => {
    // Bez tej asercji pusty wynik strippera dawałby zielone na pustym tekście.
    const probe = stripComments(
      ['/* type="date" w komentarzu */', '  // type="date" w linii', 'const a = \'type="date"\';'].join(
        "\n",
      ),
    );
    expect(probe).not.toContain('/* type="date"');
    expect(probe).toContain("const a =");
  });

  it("żaden ekran zamówień nie używa natywnego pola daty", () => {
    const offenders = sources
      .filter((file) => /type\s*=\s*["'{]?\s*["']?date["']?\s*["'}]?/.test(file.code))
      .map((file) => file.path);

    expect(
      offenders,
      `natywny input daty zamiast Calendar w Popover: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("daty jadą przez wspólne pola na Calendarze", () => {
    // Podłoga użycia: gdyby ktoś usunął pola dat zamiast je przepiąć, zakaz
    // wyżej byłby spełniony przez sam brak dat.
    const fields = sources.find((file) => file.path.endsWith("lib/orders/date-fields.tsx"));
    expect(fields).toBeDefined();
    expect(fields!.code).toContain("mode=\"single\"");
    expect(fields!.code).toContain("mode=\"range\"");
    // Kontrakt wysyłki: wartość nadal jedzie ukrytym polem jako string ISO.
    expect(fields!.code).toContain('type="hidden"');

    const users = sources.filter((file) => /DateField|DateRangeField/.test(file.code));
    expect(users.map((file) => file.path.split("/").at(-1)).sort()).toEqual([
      "date-fields.tsx",
      "extension-form.tsx",
      "order-wizard.tsx",
      "orders-date-filter.tsx",
    ]);
  });
});
