/**
 * BRAMKA JEDYNOŚCI nazw env kluczy Supabase (ADR-142) — wzorzec bramki
 * jedyności decyzji z ADR-134 (packages/db/test/commercial-active-predicate):
 * skan + kontrola pozytywna „czujnik widzi" + test-przynęta na świeżym
 * drzewie.
 *
 * Reguła: nazwy env klucza PUBLIKOWALNEGO (nowa i legacy) występują w kodzie
 * produkcyjnym WYŁĄCZNIE w packages/core/src/supabase-env.ts; nazwy klucza
 * SEKRETNEGO — wyłącznie w fabryce packages/db/src/service.ts (inwariant
 * ADR-099). Konsument, który sięgnie po `process.env.<nazwa>` z pominięciem
 * warstwy, pali build — a razem z nim ominąłby fallback dwu-nazwowy i
 * wyłączenie legacy w Supabase wywróciłoby mu ścieżkę po cichu.
 *
 * CO ŚWIADOMIE POZA SKANEM: pliki testowe (stubują legacy env, żeby DOWODZIĆ
 * fallbacku), linie komentarza (docblock musi móc NAZWAĆ regułę — ta sama
 * konwencja co scripts/audit-service-role.sh) i harness packages/e2e
 * (SUPABASE_LOCAL_* to inne nazwy, a mapowanie env procesów aplikacji w
 * playwright.config.ts przechodzi przez fallback warstwy). Ślepa plama
 * regexu plikowego (lekcja kontraktu źródła) jest domknięta z drugiej
 * strony: dowody behawioralne wołają warstwę tak, jak woła ją produkcja
 * (supabase-env.test.ts, packages/db/test/supabase-key-env.test.ts,
 * rate-limit-key-env.test.ts, tenant-lookup-key-env.test.ts).
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..", "..", "..");

// Nazwy składane z kawałków, żeby bramki literałowe (ta i
// scripts/audit-service-role.sh) nie łapały samych siebie.
const NP_SUPABASE = ["NEXT", "PUBLIC", "SUPABASE"].join("_");
const PUBLISHABLE_NAMES = [`${NP_SUPABASE}_PUBLISHABLE_KEY`, `${NP_SUPABASE}_ANON_KEY`];
const SECRET_NAMES = [
  ["SUPABASE", "SECRET_KEY"].join("_"),
  ["SUPABASE", "SERVICE_ROLE_KEY"].join("_"),
];

/** Jedyne legalne miejsca literałów (ścieżki względem korzenia repo). */
const PUBLISHABLE_LAYER = "packages/core/src/supabase-env.ts";
const SECRET_LAYER = "packages/db/src/service.ts";

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", "test", "tests", "__tests__"]);

/** Linie komentarza mogą NAZWAĆ regułę — identycznie jak audit-service-role.sh. */
function isCommentLine(line: string): boolean {
  const trimmed = line.trimStart();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

interface Hit {
  file: string;
  line: number;
  name: string;
}

function walk(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(path, files);
      continue;
    }
    if (EXTENSIONS.test(entry) && !TEST_FILE.test(entry)) files.push(path);
  }
}

/** Skan drzew źródłowych pod literały nazw env — zwraca trafienia w KODZIE. */
function scanForNames(rootDirs: string[], names: string[], baseDir: string): Hit[] {
  const files: string[] = [];
  for (const root of rootDirs) walk(root, files);
  const hits: Hit[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (isCommentLine(line)) continue;
      for (const name of names) {
        if (line.includes(name)) {
          hits.push({ file: relative(baseDir, file), line: index + 1, name });
        }
      }
    }
  }
  return hits;
}

function productionRoots(): string[] {
  const roots = [join(REPO_ROOT, "apps", "panel"), join(REPO_ROOT, "apps", "storefront")];
  for (const pkg of readdirSync(join(REPO_ROOT, "packages"))) {
    const src = join(REPO_ROOT, "packages", pkg, "src");
    try {
      if (statSync(src).isDirectory()) roots.push(src);
    } catch {
      // pakiet bez src (np. e2e) — poza skanem, patrz docblock
    }
  }
  return roots;
}

function formatHits(hits: Hit[]): string {
  return hits.map((h) => `${h.file}:${h.line} (${h.name})`).join("\n  ");
}

describe("jedyność nazw env kluczy Supabase (ADR-142)", () => {
  it("nazwy klucza PUBLIKOWALNEGO tylko w warstwie @avably/core/supabase-env", () => {
    const hits = scanForNames(productionRoots(), PUBLISHABLE_NAMES, REPO_ROOT).filter(
      (h) => h.file !== PUBLISHABLE_LAYER,
    );
    expect(
      hits,
      "odczyt klucza publikowalnego poza warstwą ADR-142 omija fallback dwu-nazwowy " +
        "(wyłączenie legacy w Supabase wywróci tę ścieżkę po cichu). Przenieś odczyt do " +
        `${PUBLISHABLE_LAYER}:\n  ${formatHits(hits)}`,
    ).toEqual([]);
  });

  it("nazwy klucza SEKRETNEGO tylko w fabryce packages/db/src/service.ts", () => {
    const hits = scanForNames(productionRoots(), SECRET_NAMES, REPO_ROOT).filter(
      (h) => h.file !== SECRET_LAYER,
    );
    expect(
      hits,
      "nazwa klucza sekretnego poza fabryką service-role łamie ADR-099/ADR-142. " +
        `Jedyne legalne miejsce: ${SECRET_LAYER}:\n  ${formatHits(hits)}`,
    ).toEqual([]);
  });

  it("kontrola pozytywna: warstwy ZAWIERAJĄ swoje literały (skan nie jest pusty)", () => {
    // Gdyby literały wyprowadziły się z warstw (albo skan czytał złe pliki),
    // `toEqual([])` wyżej byłby zielony PUSTO — ten test to wyklucza.
    const publishable = scanForNames(productionRoots(), PUBLISHABLE_NAMES, REPO_ROOT);
    expect(
      [...new Set(publishable.filter((h) => h.file === PUBLISHABLE_LAYER).map((h) => h.name))].sort(),
      "warstwa publikowalna nie zawiera obu nazw — fallback dwu-nazwowy nie istnieje",
    ).toEqual([...PUBLISHABLE_NAMES].sort());

    const secret = scanForNames(productionRoots(), SECRET_NAMES, REPO_ROOT);
    expect(
      [...new Set(secret.filter((h) => h.file === SECRET_LAYER).map((h) => h.name))].sort(),
      "fabryka service-role nie zawiera obu nazw — fallback dwu-nazwowy nie istnieje",
    ).toEqual([...SECRET_NAMES].sort());
  });

  it("kontrola pozytywna: skan realnie chodzi po drzewie (niepusty zbiór plików)", () => {
    const files: string[] = [];
    for (const root of productionRoots()) walk(root, files);
    expect(
      files.length,
      "skan widzi podejrzanie mało plików — sprawdź ścieżki korzeni",
    ).toBeGreaterThan(200);
  });

  it("test-przynęta: świeży plik z literałem legacy ZOSTAJE wykryty", () => {
    const dir = mkdtempSync(join(tmpdir(), "supabase-env-bait-"));
    try {
      writeFileSync(
        join(dir, "bait.ts"),
        `const key = process.env.${NP_SUPABASE}_ANON_KEY;\nexport default key;\n`,
      );
      // Linia komentarza NIE jest trafieniem (docblock może nazwać regułę)…
      writeFileSync(join(dir, "comment-only.ts"), `// ${NP_SUPABASE}_ANON_KEY\nexport {};\n`);
      // …a plik testowy jest poza skanem (stubuje legacy, żeby dowodzić fallbacku).
      writeFileSync(
        join(dir, "bait.test.ts"),
        `const key = process.env.${NP_SUPABASE}_ANON_KEY;\nexport default key;\n`,
      );
      const hits = scanForNames([dir], PUBLISHABLE_NAMES, dir);
      expect(
        hits,
        "skaner nie wykrył świeżego literału w kodzie — bramka jedyności jest dekoracją",
      ).toEqual([{ file: "bait.ts", line: 1, name: `${NP_SUPABASE}_ANON_KEY` }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
