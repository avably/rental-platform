/**
 * ZADEKLAROWANE vs NAMALOWANE (E1, ADR-094 — delta recenzji PM do PR #178).
 *
 * ==================== CO ZŁAPAŁA RECENZJA ====================
 *
 * Macierz kontrastu chodzi po ROLACH ZADEKLAROWANYCH w rejestrze. Recenzja PM
 * wstrzyknęła do renderu FAQ realną klasę `site-text-accent` przy deklaracji
 * `[ink, inkMuted, border]` — i cała bramka (1806 sprawdzeń) przeszła na
 * zielono. Deklaracja nie była z niczym zestawiona: nikt nie pytał ŹRÓDEŁ
 * komponentu, czym on naprawdę maluje. To jest ta sama klasa wady, co w PR #83
 * („bramka liczy po tablicy obok testu, nie po zbiorze").
 *
 * ==================== CO ROBI TEN PLIK ====================
 *
 * Skanuje źródła komponentów strukturalnych i wyprowadza z nich zbiór ról
 * NAMALOWANYCH, po czym zestawia go z deklaracją — W OBIE STRONY:
 *
 *   1. UŻYTE ⊆ ZADEKLAROWANE — rola malowana, ale niezadeklarowana, wypada
 *      z macierzy kontrastu (dokładnie mutacja PM);
 *   2. ZADEKLAROWANE ⊆ UŻYTE — deklaracja „na zapas" puchnie i przestaje
 *      cokolwiek znaczyć, a macierz liczy pary, których na ekranie nie ma.
 *
 * Skan sięga po TRZY źródła klas, bo tyle ich naprawdę jest:
 *   • literały w `className` komponentu,
 *   • odwołania `styles.<klucz>` — rozwijane przez WYWOŁANIE `siteStyles()`,
 *     a nie przez parsowanie pliku, więc nie da się ich rozjechać;
 *   • pliki wciągnięte lokalnymi importami (powłoka sekcji), liczone
 *     domknięciem przechodnim od komponentu z REJESTRU RENDERU.
 *
 * Klasy spoza tablic `role-classes.ts` są BŁĘDEM, nie pominięciem: nowa klasa
 * musi dostać jawną decyzję („rola X" albo „neutralna"). Bez tego wystarczyłoby
 * nazwać klasę inaczej, żeby wyjść spod skanu.
 *
 * Zamknięcie od strony ŹRÓDEŁ klas: komponenty strukturalne mogą sięgać poza
 * swój katalog wyłącznie po wypisany niżej zbiór modułów. Nowy import (czyli
 * potencjalnie nowy producent klas) zapala test, zamiast po cichu ominąć skan.
 */
import { STRUCTURED_SECTIONS, STRUCTURED_SECTION_TYPES } from "@avably/core/site";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { NEUTRAL_CLASSES, ROLE_CLASSES } from "./role-classes";
import { STRUCTURED_RENDERERS } from "./structured/registry";
import { siteStyles } from "./template";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "structured");

/**
 * Moduły spoza katalogu, po które komponentom strukturalnym WOLNO sięgać.
 * Każdy z uzasadnieniem, bo lista bez uzasadnień zamienia się w wysypisko:
 *   • `../../lib/cn` — sklejanie klas, samo nie wnosi żadnej;
 *   • `../rich-text` — bezpieczny render tekstu najemcy (bez klas roli);
 *   • `../template` — TABLICA KLAS, rozwijana w skanie przez `siteStyles()`;
 *   • `../bands` — pas motywu, czyli klasy NEUTRALNE (wybór pasa, nie rola);
 *   • `@avably/core/site`, `react` — typy i runtime, zero klas.
 */
const ALLOWED_FOREIGN_IMPORTS = [
  "../../lib/cn",
  "../rich-text",
  "../template",
  "../bands",
  "@avably/core/site",
  "react",
  /*
   * E3 (galeria) — trzy moduły, każdy CZYSTY z klas:
   *   • `../image-url` — przelicznik publicznego adresu zdjęcia. Mieszkał
   *     w `sections.tsx`, ale tamten plik JEST producentem klas, więc zamiast
   *     wpuszczać go na tę listę, wyprowadziliśmy stąd samą funkcję;
   *   • `../links` — reguła `rel` linków wychodzących (funkcja czysta);
   *   • `../types` — WYŁĄCZNIE typy (etykiety chrome renderu), zero runtime'u.
   */
  "../image-url",
  "../links",
  "../types",
];

const SOURCES = new Map<string, string>(
  readdirSync(DIR)
    .filter((name) => name.endsWith(".tsx") || name.endsWith(".ts"))
    .map((name) => [name, readFileSync(join(DIR, name), "utf8")]),
);

/** Plik, w którym zadeklarowano komponent o danej nazwie. */
function fileOfComponent(name: string): string | undefined {
  for (const [file, source] of SOURCES) {
    if (new RegExp(`export function ${name}\\b`).test(source)) return file;
  }
  return undefined;
}

/** Domknięcie przechodnie lokalnych importów (w obrębie katalogu). */
function closureOf(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = SOURCES.get(file) ?? "";
    for (const [, spec] of source.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
      const base = spec!.replace(/^\.\//, "");
      for (const candidate of [`${base}.tsx`, `${base}.ts`]) {
        if (SOURCES.has(candidate)) queue.push(candidate);
      }
    }
  }
  return [...seen];
}

/**
 * Klasy użyte w pliku: literały `className` PLUS rozwinięte odwołania
 * `styles.<klucz>`. Rozwinięcie idzie przez wywołanie `siteStyles()`, więc
 * zmiana wartości w tablicy klas natychmiast przestawia wynik skanu.
 */
function classesIn(file: string): string[] {
  const source = SOURCES.get(file) ?? "";
  const styles = siteStyles() as unknown as Record<string, string>;
  const out: string[] = [];

  for (const [, literal] of source.matchAll(/"([^"\n]*)"/g)) {
    out.push(...literal!.split(/\s+/).filter(Boolean));
  }
  for (const [, key] of source.matchAll(/\bstyles\.([A-Za-z0-9_]+)/g)) {
    const value = styles[key!];
    expect(value, `komponent sięga po styles.${key}, którego nie ma w tablicy klas`).toBeTypeOf(
      "string",
    );
    out.push(...value!.split(/\s+/).filter(Boolean));
  }
  return out;
}

/** Klasy motywu (nasze), odsiane od utylitarnych klas układu. */
function themeClasses(tokens: string[]): string[] {
  return tokens.filter((token) => /^(site|landing)-/.test(token));
}

/** Pliki i klasy jednego typu strukturalnego — po wszystkich jego układach. */
function scanType(type: (typeof STRUCTURED_SECTION_TYPES)[number]) {
  const files = new Set<string>();
  for (const layout of STRUCTURED_SECTIONS[type].layouts) {
    const component = STRUCTURED_RENDERERS[type]?.[layout];
    expect(component, `brak komponentu ${type}/${layout}`).toBeTypeOf("function");
    const entry = fileOfComponent(component!.name);
    expect(entry, `nie znaleziono pliku komponentu ${component!.name}`).toBeTruthy();
    for (const file of closureOf(entry!)) files.add(file);
  }
  const tokens = [...files].flatMap(classesIn);
  return { files: [...files], tokens: themeClasses(tokens) };
}

describe("skan ma co czytać (kontrola pozytywna, anty-pusta)", () => {
  it("każdy typ ma pliki, a w nich klasy motywu", () => {
    expect(STRUCTURED_SECTION_TYPES.length).toBeGreaterThan(0);
    for (const type of STRUCTURED_SECTION_TYPES) {
      const { files, tokens } = scanType(type);
      expect(files.length, `typ "${type}": skan nie znalazł ANI JEDNEGO pliku`).toBeGreaterThan(0);
      expect(
        tokens.length,
        `typ "${type}": skan nie znalazł ANI JEDNEJ klasy motywu — pusty wynik nie broni niczego`,
      ).toBeGreaterThan(0);
      // Domknięcie MUSI wciągnąć powłokę: gdyby liczyło sam plik układu,
      // nagłówek sekcji (rola `ink`) wypadłby ze skanu.
      expect(files.length, `typ "${type}": domknięcie importów nie wciągnęło powłoki`).toBeGreaterThan(1);
    }
  });

  it("tablica klas jest niepusta i spójna z allowlistą ról", () => {
    expect(Object.keys(ROLE_CLASSES).length).toBeGreaterThan(0);
    expect(NEUTRAL_CLASSES.length).toBeGreaterThan(0);
    for (const [klasa, role] of Object.entries(ROLE_CLASSES)) {
      expect(role.length, `klasa "${klasa}" bez roli`).toBeGreaterThan(0);
      expect(
        NEUTRAL_CLASSES,
        `klasa "${klasa}" jest jednocześnie rolą i neutralną`,
      ).not.toContain(klasa);
    }
  });
});

describe("KAŻDA klasa motywu ma jawną decyzję", () => {
  it.each(STRUCTURED_SECTION_TYPES)("%s: zero klas spoza tablic", (type) => {
    const { tokens } = scanType(type);
    const nieznane = [...new Set(tokens)].filter(
      (token) => !Object.hasOwn(ROLE_CLASSES, token) && !NEUTRAL_CLASSES.includes(token),
    );
    expect(
      nieznane,
      `klasy bez decyzji w role-classes.ts (dopisz rolę albo uzasadnij neutralność):\n${nieznane.join("\n")}`,
    ).toEqual([]);
  });
});

describe("ZADEKLAROWANE vs NAMALOWANE — zestawienie w obie strony", () => {
  it.each(STRUCTURED_SECTION_TYPES)(
    "%s: role NAMALOWANE mieszczą się w zadeklarowanych (mutacja PM)",
    (type) => {
      const zadeklarowane = new Set<string>(STRUCTURED_SECTIONS[type].themeRoles);
      const { tokens } = scanType(type);
      const nadmiarowe = new Map<string, string>();
      for (const token of new Set(tokens)) {
        for (const rola of ROLE_CLASSES[token] ?? []) {
          if (!zadeklarowane.has(rola)) nadmiarowe.set(rola, token);
        }
      }
      expect(
        [...nadmiarowe].map(([rola, klasa]) => `${rola} (przez klasę ${klasa})`),
        `typ "${type}" MALUJE rolę, której NIE ZADEKLAROWAŁ — macierz kontrastu jej nie liczy. ` +
          `Dopisz ją do themeRoles w STRUCTURED_SECTIONS albo zdejmij klasę z komponentu.`,
      ).toEqual([]);
    },
  );

  it.each(STRUCTURED_SECTION_TYPES)(
    "%s: każda ZADEKLAROWANA rola jest naprawdę malowana",
    (type) => {
      const { tokens } = scanType(type);
      const uzyte = new Set<string>();
      for (const token of new Set(tokens)) {
        for (const rola of ROLE_CLASSES[token] ?? []) uzyte.add(rola);
      }
      const martwe = STRUCTURED_SECTIONS[type].themeRoles.filter((rola) => !uzyte.has(rola));
      expect(
        martwe,
        `typ "${type}" deklaruje role, których nie maluje — deklaracja puchnie na zapas, ` +
          `a macierz liczy pary, których na ekranie nie ma`,
      ).toEqual([]);
    },
  );
});

describe("źródła klas są zamknięte", () => {
  it("komponenty strukturalne importują spoza katalogu tylko z allowlisty", () => {
    const obce: string[] = [];
    for (const [file, source] of SOURCES) {
      for (const [, spec] of source.matchAll(/from\s+"([^"]+)"/g)) {
        if (spec!.startsWith("./")) continue;
        if (ALLOWED_FOREIGN_IMPORTS.includes(spec!)) continue;
        obce.push(`${file}: ${spec}`);
      }
    }
    expect(
      obce,
      `import spoza allowlisty — nowy producent klas ominąłby skan ról:\n${obce.join("\n")}`,
    ).toEqual([]);
  });

  it("zero kolorów palety Tailwinda i zero tokenów PANELU w komponentach", () => {
    // Hex ma własną bramkę (structured-registry.test.tsx); tu domykamy dwie
    // pozostałe drogi „koloru pod inną nazwą": paletę utylitarną i tokeny
    // aplikacji, które na stronie najemcy znaczą „wygląda jak panel".
    // Granica `(?<![-\w])` zamiast `\b`: bez niej `site-text-muted` trafiałby
    // we wzorzec „text-muted" — nasza klasa roli udawałaby token panelu.
    const PALETA =
      /(?<![-\w])(?:text|bg|border|fill|stroke|ring|from|via|to)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/;
    const TOKENY_PANELU =
      /(?<![-\w])(?:text|bg|border|ring)-(?:card|background|foreground|muted|muted-foreground|primary|secondary|accent|destructive|popover|input|border|ring)\b/;
    for (const [file, source] of SOURCES) {
      expect(source, `${file}: kolor z palety Tailwinda`).not.toMatch(PALETA);
      expect(source, `${file}: token PANELU na stronie najemcy`).not.toMatch(TOKENY_PANELU);
    }
  });
});
