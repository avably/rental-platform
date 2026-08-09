/**
 * Klasyfikator zakresu zmian dla CI (ADR-117) — decyduje, czy przebieg może
 * pominąć ciężkie joby (`ci`, `rls`, `e2e`), bo zmiana jest WYŁĄCZNIE
 * dokumentacyjna.
 *
 * DOBÓR JEST LISTĄ DOZWOLONYCH, nie listą wyjątków. Ciężkie joby biegną
 * zawsze, CHYBA ŻE **każda** zmieniona ścieżka pasuje do wąskiej białej listy.
 * Odwrotna konstrukcja (czarna lista „pomiń, gdy nie ruszono kodu") tworzy
 * martwe pole przy każdej nowej ścieżce, której wzorzec nie zna — dokładnie
 * z tego powodu warunkowanie po ścieżkach zostało świadomie odrzucone przy
 * jobie `wp-plugin` (recenzja PM #216). Tutaj nieznana ścieżka nie pasuje do
 * białej listy, więc z definicji oznacza PEŁNE CI.
 *
 * FAIL-CLOSED: brak wiedzy nigdy nie znaczy „pomiń". Pusta lista, lista
 * nie-tablica, ścieżka niepoprawna składniowo (`..`, ukośnik odwrotny, nazwa
 * cytowana przez gita, znak sterujący) — każdy z tych przypadków daje pełne
 * CI, a nie pominięcie.
 *
 * DOKUMENTACJA CZYTANA PRZEZ KOD NIE JEST „TYLKO DOKUMENTACJĄ". Część plików
 * w `docs/` jest źródłem prawdy dla testów (artefakt handoffu tokenów czyta
 * 13 miejsc w suitach `packages/ui`, `packages/pdf` i `apps/panel`), więc ich
 * edycja potrafi legalnie zapalić CI. Gdyby wpadły pod białą listę, powstałoby
 * martwe pole: czerwony test przechodziłby jako „pominięty". Wykaz takich
 * ścieżek jest jawny (`CODE_READ_DIRECTORIES`, `CODE_READ_FILES`), a jego
 * kompletności pilnuje skan repo w `apps/panel/test/ci-zakres-zmian.test.ts`.
 *
 * Użycie w workflow (bez `pnpm install` — same moduły wbudowane Node):
 *   git diff --name-only --no-renames -z BAZA...HEAD | node scripts/ci-zakres-zmian.mjs --zero
 * Werdykt trafia do `$GITHUB_OUTPUT` jako `pomin=true|false` (i na stdout).
 */

import { appendFileSync } from "node:fs";

/** Katalog dokumentacji — jedyny katalog kwalifikujący się do pominięcia. */
export const DOCS_DIRECTORY = "docs/";

/** Pliki Markdown w KORZENIU repo (README.md itp.) — bez zagnieżdżeń. */
export const ROOT_MARKDOWN = /^[^/]+\.md$/;

/**
 * Katalogi w `docs/`, których zawartość czyta kod repo. Wyjęte z białej listy:
 * `docs/branding/**` to powierzchnia handoffu tokenów/statusów/kolorów,
 * porównywana bajt w bajt przez kontrakty w `packages/ui`, `packages/pdf`
 * i `apps/panel` — zmiana artefaktu MUSI przejść pełne CI.
 */
export const CODE_READ_DIRECTORIES = ["docs/branding/"];

/**
 * Pojedyncze pliki dokumentacji wymienione w kodzie (nie w komentarzu).
 * `hub.html` czytają skrypty weryfikacji brandingu; `konwencje-migracji.md`
 * pojawia się w treści komunikatów błędu strażników testów integracyjnych.
 * Skan nie odróżnia taniej odczytu od wzmianki, a przy wątpliwości obowiązuje
 * fail-closed — więc obie pozycje kosztują pełne CI.
 */
export const CODE_READ_FILES = ["docs/dokumentacja/hub.html", "docs/konwencje-migracji.md"];

/**
 * Czy ścieżka jest składniowo bezpieczna do klasyfikacji.
 *
 * Odrzucamy wszystko, co mogłoby znaczyć co innego niż wygląda: nazwę
 * cytowaną przez gita (`"docs/a\nb"` — git cytuje nazwy ze znakami
 * specjalnymi, gdy nie użyto `-z`), ukośnik odwrotny, segment `.`/`..`,
 * ścieżkę absolutną, pusty segment i znaki sterujące. Taka ścieżka nie jest
 * „niebezpieczna" sama w sobie — jest NIEZROZUMIANA, a to wystarczy, żeby
 * puścić pełne CI.
 */
export function isWellFormedPath(path) {
  if (typeof path !== "string" || path.length === 0) return false;
  if (path !== path.trim()) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  if (path.includes("\\") || path.startsWith('"') || path.startsWith("'")) return false;
  if (path.startsWith("/")) return false;
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return false;
  }
  return true;
}

/**
 * Czy POJEDYNCZA ścieżka kwalifikuje się do pominięcia ciężkich jobów.
 * Kolejność jest istotna: najpierw poprawność składniowa, potem biała lista,
 * na końcu odjęcie dokumentacji czytanej przez kod.
 */
export function isDocumentationOnlyPath(path) {
  if (!isWellFormedPath(path)) return false;

  const inDocs = path.startsWith(DOCS_DIRECTORY) && path.length > DOCS_DIRECTORY.length;
  const inRootMarkdown = ROOT_MARKDOWN.test(path);
  if (!inDocs && !inRootMarkdown) return false;

  if (CODE_READ_FILES.includes(path)) return false;
  if (CODE_READ_DIRECTORIES.some((directory) => path.startsWith(directory))) return false;

  return true;
}

/**
 * Werdykt dla całego zakresu zmian.
 *
 * @param {readonly string[]} paths ścieżki względem korzenia repo
 * @returns {{ skipHeavyJobs: boolean, reason: string, blockingPaths: string[] }}
 */
export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths)) {
    return {
      skipHeavyJobs: false,
      reason: "nie udało się ustalić zakresu zmian (brak listy ścieżek)",
      blockingPaths: [],
    };
  }

  const cleaned = paths.filter((path) => typeof path === "string" && path.trim() !== "");
  if (cleaned.length === 0) {
    return {
      skipHeavyJobs: false,
      reason: "pusty zakres zmian — pełne CI (brak wiedzy nie znaczy „pomiń”)",
      blockingPaths: [],
    };
  }

  const blockingPaths = cleaned.filter((path) => !isDocumentationOnlyPath(path));
  if (blockingPaths.length > 0) {
    return {
      skipHeavyJobs: false,
      reason: `zmiany poza dokumentacją: ${blockingPaths.length} z ${cleaned.length} ścieżek`,
      blockingPaths,
    };
  }

  return {
    skipHeavyJobs: true,
    reason: `wyłącznie dokumentacja (${cleaned.length} ścieżek)`,
    blockingPaths: [],
  };
}

/** Rozbiór wejścia: `--zero` = separator NUL (git diff -z), inaczej znak nowej linii. */
export function parsePathList(input, { zeroSeparated = false } = {}) {
  if (typeof input !== "string") return [];
  return input
    .split(zeroSeparated ? "\u0000" : "\n")
    .map((path) => (zeroSeparated ? path : path.replace(/\r$/, "")))
    .filter((path) => path !== "");
}

/** Wejście z stdin — czytane w całości, bo lista zmian jest krótka. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const zeroSeparated = process.argv.includes("--zero");
  const paths = parsePathList(await readStdin(), { zeroSeparated });
  const verdict = classifyChangedPaths(paths);

  process.stderr.write(`Zakres zmian: ${paths.length} ścieżek\n`);
  for (const path of paths.slice(0, 50)) process.stderr.write(`  ${path}\n`);
  if (paths.length > 50) process.stderr.write(`  … (${paths.length - 50} więcej)\n`);
  process.stderr.write(
    verdict.skipHeavyJobs
      ? `WERDYKT: pomijam ciężkie joby — ${verdict.reason}\n`
      : `WERDYKT: pełne CI — ${verdict.reason}\n`,
  );
  for (const path of verdict.blockingPaths.slice(0, 20)) {
    process.stderr.write(`  wymusza pełne CI: ${path}\n`);
  }

  const line = `pomin=${verdict.skipHeavyJobs ? "true" : "false"}`;
  process.stdout.write(`${line}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
}

// Uruchomienie jako CLI (import w teście tego nie odpala). Każdy błąd kończy
// się werdyktem „pełne CI", a nie czerwonym przebiegiem: zepsuty klasyfikator
// ma kosztować minuty, nie zdejmować bramkę.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`BŁĄD klasyfikatora — pełne CI: ${error?.message ?? error}\n`);
    const line = "pomin=false";
    process.stdout.write(`${line}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`);
  });
}
