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
 * WARSTWA PER-JOB (ADR-207). Obok globalnego `pomin` klasyfikator oddaje
 * werdykty per-job: `pomin_wp_plugin`, `pomin_rls`, `pomin_e2e` — job, którego
 * żadna zmieniona ścieżka NIE DOTYKA, jest pomijany także wtedy, gdy zmiana
 * nie jest czysto dokumentacyjna. Konstrukcja jest tą samą białą listą
 * STREF co wyżej, tylko o jedno piętro niżej: każda ścieżka dostaje zbiór
 * jobów, które dotyka (`jobsAffectedByPath`), a ścieżka SPOZA znanych stref
 * (skrypty, manifesty, lockfile, `.github/**`, nieznany katalog) dotyka
 * WSZYSTKICH — czyli nieznana strefa znaczy pełne CI, nigdy pominięcie.
 * Job `ci` świadomie NIE MA warstwy per-job (testy jednostkowe i bramki
 * bezpieczeństwa biegną na każdej zmianie kodu), job `zakres` klasyfikuje,
 * więc z definicji biegnie zawsze.
 *
 * Użycie w workflow (bez `pnpm install` — same moduły wbudowane Node):
 *   git diff --name-only --no-renames -z BAZA...HEAD | node scripts/ci-zakres-zmian.mjs --zero
 * Werdykty trafiają do `$GITHUB_OUTPUT` jako `pomin=true|false`,
 * `pomin_wp_plugin=…`, `pomin_rls=…`, `pomin_e2e=…` (i na stdout).
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
 * pojawia się w treści komunikatów błędu strażników testów integracyjnych;
 * `audyt-env-rate-limit.md` (aneks ADR-039/ADR-106, 2026-08-10) pojawia się
 * w treści `console.warn` w `packages/security/src/rate-limit.ts` — ten sam
 * wzorzec co `konwencje-migracji.md`. Skan nie odróżnia taniej odczytu od
 * wzmianki, a przy wątpliwości obowiązuje fail-closed — więc wszystkie trzy
 * pozycje kosztują pełne CI.
 */
export const CODE_READ_FILES = [
  "docs/dokumentacja/hub.html",
  "docs/konwencje-migracji.md",
  "docs/audyty/2026-08-10-audyt-env-rate-limit.md",
];

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

/** Joby z pomijaniem per-job (ADR-207). `ci` świadomie poza listą — patrz nagłówek. */
export const PER_JOB_SKIPPABLE = Object.freeze(["wp-plugin", "rls", "e2e"]);

/** Strefa wtyczki WordPress — izolowana od aplikacji (PHP + paczka zip). */
export const WP_PLUGIN_DIRECTORY = "integrations/wordpress/";

/** Strefa pakietu bazy — RLS, migracje, polityki żyją wyłącznie tu. */
export const DB_PACKAGE_DIRECTORY = "packages/db/";

/**
 * Czy ścieżka w `apps/panel` jest powierzchnią wtyczki WordPress: dowolny
 * segment za `apps/panel/` zaczynający się od `wordpress` lub `wp-`
 * (`lib/wordpress/**`, `test/wordpress-*.test.ts`, `test/wp-*.test.ts`,
 * ekran `wordpress-guide.tsx`). Dopasowanie nadmiarowe jest bezpieczne —
 * job co najwyżej pobiegnie niepotrzebnie.
 */
export function isWpAdjacentPanelPath(path) {
  if (!path.startsWith("apps/panel/")) return false;
  return path
    .split("/")
    .slice(2)
    .some((segment) => segment.startsWith("wordpress") || segment.startsWith("wp-"));
}

/**
 * Zbiór ciężkich jobów per-job, które dana ścieżka DOTYKA (ADR-207).
 *
 * FAIL-CLOSED per strefa: ścieżka spoza znanych stref dotyka WSZYSTKICH
 * jobów — `.github/**` (workflow i skrypty izolacji Supabase, z których
 * korzystają `rls`/`e2e`), `scripts/**` (audyty joba `ci`, kontrola paczki
 * wtyczki, TEN klasyfikator), manifesty i lockfile (każdy job robi install
 * albo checkout), nieznany katalog. Zmiana samego `ci.yml` czy klasyfikatora
 * NIGDY nie kwalifikuje się do pominięcia — bramka nie zwalnia sama siebie.
 *
 * ŚWIADOMA GRANICA (decyzja PM w ADR-207): `rls` reaguje wyłącznie na
 * `packages/db/**`. Job `rls` uruchamia też suity integracyjne panelu
 * i storefrontu na żywym Supabase — dla PR-a czysto frontowego te suity nie
 * pobiegną; pokrycie ścieżki krytycznej trzyma wtedy `e2e`, który na każdej
 * zmianie `apps/**`/`packages/**` biegnie.
 */
export function jobsAffectedByPath(path) {
  if (!isWellFormedPath(path)) return [...PER_JOB_SKIPPABLE];
  if (isDocumentationOnlyPath(path)) return [];
  if (path.startsWith(WP_PLUGIN_DIRECTORY)) return ["wp-plugin"];
  if (path.startsWith(DB_PACKAGE_DIRECTORY)) return ["rls", "e2e"];
  if (isWpAdjacentPanelPath(path)) return ["wp-plugin", "e2e"];
  if (path.startsWith("apps/") || path.startsWith("packages/")) return ["e2e"];
  return [...PER_JOB_SKIPPABLE];
}

/**
 * Werdykt dla całego zakresu zmian.
 *
 * @param {readonly string[]} paths ścieżki względem korzenia repo
 * @returns {{ skipHeavyJobs: boolean, reason: string, blockingPaths: string[] }}
 */
export function classifyChangedPaths(paths) {
  // Fail-closed dla warstwy per-job: dopóki nie policzymy stref, żaden job
  // nie jest pomijalny.
  const noSkips = Object.fromEntries(PER_JOB_SKIPPABLE.map((job) => [job, false]));

  if (!Array.isArray(paths)) {
    return {
      skipHeavyJobs: false,
      reason: "nie udało się ustalić zakresu zmian (brak listy ścieżek)",
      blockingPaths: [],
      skipJobs: noSkips,
    };
  }

  const cleaned = paths.filter((path) => typeof path === "string" && path.trim() !== "");
  if (cleaned.length === 0) {
    return {
      skipHeavyJobs: false,
      reason: "pusty zakres zmian — pełne CI (brak wiedzy nie znaczy „pomiń”)",
      blockingPaths: [],
      skipJobs: noSkips,
    };
  }

  // Warstwa per-job (ADR-207): job jest pomijalny, gdy ŻADNA ścieżka go nie
  // dotyka. Suma zbiorów po ścieżkach — nieznana strefa dotyka wszystkich,
  // więc pojedynczy nieznany plik gasi wszystkie pominięcia.
  const affectedJobs = new Set();
  for (const path of cleaned) {
    for (const job of jobsAffectedByPath(path)) affectedJobs.add(job);
  }
  const skipJobs = Object.fromEntries(
    PER_JOB_SKIPPABLE.map((job) => [job, !affectedJobs.has(job)]),
  );

  const blockingPaths = cleaned.filter((path) => !isDocumentationOnlyPath(path));
  if (blockingPaths.length > 0) {
    return {
      skipHeavyJobs: false,
      reason: `zmiany poza dokumentacją: ${blockingPaths.length} z ${cleaned.length} ścieżek`,
      blockingPaths,
      skipJobs,
    };
  }

  return {
    skipHeavyJobs: true,
    reason: `wyłącznie dokumentacja (${cleaned.length} ścieżek)`,
    blockingPaths: [],
    skipJobs,
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
  for (const job of PER_JOB_SKIPPABLE) {
    process.stderr.write(
      `per-job: ${job} — ${verdict.skipJobs[job] ? "POMINIĘTY (żadna ścieżka go nie dotyka)" : "biegnie"}\n`,
    );
  }

  const lines = verdictOutputLines(verdict);
  process.stdout.write(`${lines.join("\n")}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
}

/**
 * Linie werdyktu dla `$GITHUB_OUTPUT`/stdout. Nazwy jobów z myślnikiem
 * mapują się na podkreślenia (`wp-plugin` → `pomin_wp_plugin`), bo nazwa
 * outputu w Actions nie powinna liczyć na myślnik w wyrażeniach.
 */
export function verdictOutputLines(verdict) {
  return [
    `pomin=${verdict.skipHeavyJobs ? "true" : "false"}`,
    ...PER_JOB_SKIPPABLE.map(
      (job) => `pomin_${job.replaceAll("-", "_")}=${verdict.skipJobs[job] ? "true" : "false"}`,
    ),
  ];
}

// Uruchomienie jako CLI (import w teście tego nie odpala). Każdy błąd kończy
// się werdyktem „pełne CI", a nie czerwonym przebiegiem: zepsuty klasyfikator
// ma kosztować minuty, nie zdejmować bramkę.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`BŁĄD klasyfikatora — pełne CI: ${error?.message ?? error}\n`);
    const lines = [
      "pomin=false",
      ...PER_JOB_SKIPPABLE.map((job) => `pomin_${job.replaceAll("-", "_")}=false`),
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`);
  });
}
