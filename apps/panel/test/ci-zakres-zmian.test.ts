/**
 * Bramka kosztowa CI (ADR-117) — klasyfikator zakresu zmian.
 *
 * Ta suita jest JEDYNYM dowodem na tę bramkę, jaki mamy: minuty Actions są
 * wyczerpane, więc zielony przebieg w CI nie jest dostępny jako weryfikacja.
 * Stąd trzy warstwy:
 *   1. WERDYKTY klasyfikatora (biała lista, mieszany diff, fail-closed).
 *   2. SKAN REPO — żadna ścieżka `docs/` wymieniona w KODZIE nie może być
 *      klasyfikowana jako „tylko dokumentacja"; inaczej powstaje martwe pole,
 *      w którym czerwony test przechodzi jako „pominięty".
 *   3. KONTRAKT WORKFLOW — `concurrency`, warunek `pull_request` przy
 *      `cancel-in-progress` i podpięcie ciężkich jobów pod job `zakres`;
 *      dołożony dowód behawioralny na CLI, bo sam skan pliku ma ślepą plamę.
 *
 * Testy tego pliku są w apps/panel, bo tu już mieszka bramka drugiego skryptu
 * korzeniowego (wordpress-plugin-package.test.ts) — pas CI i pas panelu mają
 * tego samego właściciela.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CODE_READ_DIRECTORIES,
  CODE_READ_FILES,
  classifyChangedPaths,
  isDocumentationOnlyPath,
  jobsAffectedByPath,
} from "../../../scripts/ci-zakres-zmian.mjs";

const repositoryRoot = resolve(process.cwd(), "../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
const workflow = readFileSync(workflowPath, "utf8");

/** Ten plik nazywa ścieżki `docs/` jako DANE TESTOWE, nie jako odczyt. */
const SCAN_SELF = "apps/panel/test/ci-zakres-zmian.test.ts";

/**
 * Czytelnicy `docs/` WYJĘCI ze skanu — każdy z własnym powodem, nie kategorią.
 *
 * Martwe pole, przed którym broni ten skan, wygląda tak: czerwony TEST
 * przechodzi jako `skipped`, bo jego źródło prawdy wpadło pod białą listę
 * dokumentacji. Bramka numeracji ADR (ADR-187) tego pola nie tworzy, bo nie
 * mieszka w żadnym pomijalnym jobie — stoi w `zakres`, który biegnie
 * bezwarunkowo, więc jej odczyt nie ma jak zostać pominięty.
 *
 * Odpowiedź alternatywna — dopisanie `docs/dokumentacja/index.html` do
 * `CODE_READ_FILES` — wymuszałaby pełne CI na KAŻDYM PR-ze, bo każdy dokłada
 * do tego pliku wpis ADR i wpis dziennika. To byłaby bramka kupiona za cenę
 * CAŁEJ bramki kosztowej ADR-117.
 *
 * Wyjątek jest prawdziwy dokładnie tak długo, jak długo bramka stoi w
 * `zakres` — i dokładnie to jest pilnowane osobno:
 * `apps/panel/test/adr-numeracja-bramka.test.ts` sprawdza BLOK tego joba
 * i jego bezwarunkowość. Przeniesienie kroku do `ci` pali tamtą suitę, czyli
 * w tej samej chwili, w której ten wyjątek przestaje obowiązywać.
 */
const SCAN_EXEMPT = new Map<string, string>([
  ["scripts/audit-adr-duplikaty.mjs", "bramka numeracji ADR w jobie `zakres` (ADR-187)"],
]);

/** Ścieżki `docs/` wymienione w pliku poza komentarzami (rdzeń skanu repo). */
function docsPathsIn(file: string): Map<string, string> {
  const found = new Map<string, string>();
  readFileSync(resolve(repositoryRoot, file), "utf8")
    .split("\n")
    .forEach((line, index) => {
      // Komentarze pomijamy: wzmianka „patrz docs/…" nie jest odczytem.
      if (/^\s*(\/\/|\*|\/\*|#)/.test(line)) return;
      // Lookbehind odcina adresy URL (…/en-US/docs/Web/…), gdzie przed
      // „docs/" stoi ukośnik — to cudza dokumentacja, nie nasze repo.
      for (const match of line.matchAll(/(?<![\w/.-])(?:\.\.\/)*docs\/[A-Za-z0-9._/-]+/g)) {
        const candidate = match[0].replace(/^(\.\.\/)+/, "").replace(/[.,;:]+$/, "");
        if (!found.has(candidate)) found.set(candidate, `${file}:${index + 1}`);
      }
    });
  return found;
}

/** Ciężkie joby, które wolno pominąć — wymienione z nazwy, nie zgadywane. */
const HEAVY_JOBS = ["ci", "wp-plugin", "rls", "e2e"] as const;

/** Joby z warstwą per-job (ADR-207) i ich outputs w jobie `zakres`. */
const PER_JOB_OUTPUTS = {
  "wp-plugin": "pomin_wp_plugin",
  rls: "pomin_rls",
  e2e: "pomin_e2e",
} as const;

/** Blok YAML pojedynczego joba (od `  nazwa:` do następnego joba). */
function jobBlock(name: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[A-Za-z][\w-]*:$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

describe("klasyfikator zakresu zmian — biała lista", () => {
  it("dokumentacja w docs/ kwalifikuje się do pominięcia", () => {
    const verdict = classifyChangedPaths(["docs/dokumentacja/index.html"]);
    expect(verdict.skipHeavyJobs).toBe(true);
  });

  it("Markdown w KORZENIU repo kwalifikuje się do pominięcia", () => {
    expect(classifyChangedPaths(["README.md"]).skipHeavyJobs).toBe(true);
  });

  it("dwa pliki dokumentacji naraz nadal kwalifikują się do pominięcia", () => {
    const verdict = classifyChangedPaths(["docs/dokumentacja/index.html", "README.md"]);
    expect(verdict.skipHeavyJobs).toBe(true);
  });
});

describe("klasyfikator zakresu zmian — wszystko inne to pełne CI", () => {
  it("mieszany diff: dokumentacja + JEDEN plik kodu → pełne CI", () => {
    const verdict = classifyChangedPaths([
      "docs/dokumentacja/index.html",
      "apps/panel/lib/review-ingest-guard.ts",
    ]);
    expect(verdict.skipHeavyJobs).toBe(false);
    expect(verdict.blockingPaths).toEqual(["apps/panel/lib/review-ingest-guard.ts"]);
  });

  it("zmiana samego workflow CI → pełne CI (bramka nie zwalnia sama siebie)", () => {
    expect(classifyChangedPaths([".github/workflows/ci.yml"]).skipHeavyJobs).toBe(false);
  });

  it("skrypty, manifesty i lockfile → pełne CI", () => {
    for (const path of [
      "scripts/audit-service-role.sh",
      "scripts/ci-zakres-zmian.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "turbo.json",
      "packages/db/migrations/0056_cos.sql",
    ]) {
      expect(classifyChangedPaths([path]).skipHeavyJobs, path).toBe(false);
    }
  });

  it("nazwa „docs” poza katalogiem docs/ nie jest dokumentacją", () => {
    for (const path of [
      "docsy/plan.html",
      "apps/panel/docs/notatka.md",
      "packages/ui/docs.md",
      "docs",
    ]) {
      expect(classifyChangedPaths([path]).skipHeavyJobs, path).toBe(false);
    }
  });

  it("Markdown POZA korzeniem (i poza docs/) → pełne CI", () => {
    expect(
      classifyChangedPaths(["integrations/wordpress/avably-booking/README.md"]).skipHeavyJobs,
    ).toBe(false);
  });
});

describe("klasyfikator zakresu zmian — fail-closed", () => {
  it("pusta lista → pełne CI", () => {
    expect(classifyChangedPaths([]).skipHeavyJobs).toBe(false);
  });

  it("lista samych pustych wpisów → pełne CI", () => {
    expect(classifyChangedPaths(["", "   "]).skipHeavyJobs).toBe(false);
  });

  it("brak listy (null/undefined/nie-tablica) → pełne CI", () => {
    for (const input of [null, undefined, "docs/x.html", 42, {}]) {
      expect(classifyChangedPaths(input as never).skipHeavyJobs).toBe(false);
    }
  });

  it("ścieżka z `..` → pełne CI (nie rozwijamy jej, tylko odmawiamy)", () => {
    for (const path of [
      "docs/../scripts/audit-service-role.sh",
      "docs/a/../../package.json",
      "../docs/x.html",
    ]) {
      expect(classifyChangedPaths([path]).skipHeavyJobs, path).toBe(false);
    }
  });

  it("nazwa cytowana przez gita, ukośnik odwrotny i znak sterujący → pełne CI", () => {
    for (const path of [
      '"docs/dziwna\\nnazwa.md"',
      "docs\\dziwna.md",
      "docs/dziwna\nnazwa.md",
      "docs/dziwna\tnazwa.md",
      "/docs/absolutna.md",
      "docs//pusty-segment.md",
      " docs/spacja.md",
    ]) {
      expect(classifyChangedPaths([path]).skipHeavyJobs, JSON.stringify(path)).toBe(false);
    }
  });
});

describe("dokumentacja czytana przez kod nie jest „tylko dokumentacją”", () => {
  it("artefakt handoffu tokenów wymusza pełne CI", () => {
    // Ten plik jest źródłem prawdy dla kontraktów tokenów/statusów/kolorów
    // (packages/ui, packages/pdf, apps/panel) — jego edycja POTRAFI zapalić
    // CI, więc pominięcie ciężkich jobów ukryłoby czerwony test.
    expect(
      classifyChangedPaths(["docs/branding/2026-07-20-avably-faza-2-system.html"]).skipHeavyJobs,
    ).toBe(false);
  });

  it("każdy wpis wykazu ścieżek czytanych przez kod jest nieprzepuszczalny", () => {
    expect(CODE_READ_FILES.length + CODE_READ_DIRECTORIES.length).toBeGreaterThan(0);
    for (const path of CODE_READ_FILES) {
      expect(isDocumentationOnlyPath(path), path).toBe(false);
    }
    for (const directory of CODE_READ_DIRECTORIES) {
      expect(isDocumentationOnlyPath(`${directory}dowolny-plik.html`), directory).toBe(false);
    }
  });

  it("SKAN REPO: żadna ścieżka docs/ wymieniona w kodzie nie jest pomijalna", () => {
    const tracked = execFileSync("git", ["ls-files"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean)
      .filter((file) => !file.startsWith("docs/") && file !== SCAN_SELF)
      .filter((file) => !SCAN_EXEMPT.has(file))
      .filter((file) => /\.(ts|tsx|mjs|mts|cjs|js|json|sh|php|ya?ml)$/.test(file));

    const found = new Map<string, string>();
    for (const file of tracked) {
      for (const [candidate, where] of docsPathsIn(file)) {
        if (!found.has(candidate)) found.set(candidate, where);
      }
    }

    // Anty-pustka: skan po pustym zbiorze niczego nie broni. Artefakt handoffu
    // MUSI się znaleźć — jeśli zniknie, to skan przestał działać, a nie kod.
    expect([...found.keys()]).toContain("docs/branding/2026-07-20-avably-faza-2-system.html");

    const deadSpots = [...found.entries()].filter(([path]) => isDocumentationOnlyPath(path));
    expect(
      deadSpots.map(([path, where]) => `${path} (${where})`),
      "ścieżka docs/ czytana przez kod, a klasyfikowana jako pomijalna — dopisz ją do CODE_READ_FILES/CODE_READ_DIRECTORIES",
    ).toEqual([]);
  });

  it("wyjątki skanu są ŻYWE — martwy wyjątek tylko poszerzałby ślepą plamę", () => {
    // Wyjątek, który niczego już nie osłania, jest gorszy niż jego brak:
    // wygląda na uzasadniony, a wyłącza plik ze skanu na zawsze. Każdy wpis
    // musi więc wskazywać istniejący plik i faktycznie wnosić ścieżkę, którą
    // skan bez niego zgłosiłby jako martwe pole.
    expect(SCAN_EXEMPT.size).toBeGreaterThan(0);
    for (const [file, powod] of SCAN_EXEMPT) {
      expect(powod.trim().length, file).toBeGreaterThan(0);
      const oslaniane = [...docsPathsIn(file).keys()].filter((path) =>
        isDocumentationOnlyPath(path),
      );
      expect(oslaniane, `${file}: wyjątek nie osłania już żadnej ścieżki`).not.toEqual([]);
    }
  });
});

describe("klasyfikator per-job (ADR-207) — tabela decyzji", () => {
  // Job jest pomijalny, gdy ŻADNA zmieniona ścieżka go nie dotyka. Strefy są
  // białą listą: ścieżka spoza znanych stref dotyka WSZYSTKICH jobów.

  it("scenariusz (a): zmiana tylko w apps/storefront → wp-plugin i rls pominięte, e2e biegnie", () => {
    const { skipHeavyJobs, skipJobs } = classifyChangedPaths(["apps/storefront/app/page.tsx"]);
    expect(skipHeavyJobs).toBe(false); // job `ci` biegnie (globalny pomin nie obowiązuje)
    expect(skipJobs).toEqual({ "wp-plugin": true, rls: true, e2e: false });
  });

  it("scenariusz (b): zmiana w packages/db → rls i e2e biegną, wp-plugin pominięty", () => {
    const { skipHeavyJobs, skipJobs } = classifyChangedPaths([
      "packages/db/migrations/0060_nowa.sql",
    ]);
    expect(skipHeavyJobs).toBe(false);
    expect(skipJobs).toEqual({ "wp-plugin": true, rls: false, e2e: false });
  });

  it("scenariusz (c): zmiana tylko we wtyczce WordPress → wp-plugin biegnie, rls i e2e pominięte", () => {
    const { skipHeavyJobs, skipJobs } = classifyChangedPaths([
      "integrations/wordpress/avably-booking/avably-booking.php",
    ]);
    expect(skipHeavyJobs).toBe(false); // `ci` biegnie
    expect(skipJobs).toEqual({ "wp-plugin": false, rls: true, e2e: true });
  });

  it("scenariusz (d): zmiana tylko w docs → globalny pomin jak dotąd, per-job spójnie `true`", () => {
    const { skipHeavyJobs, skipJobs } = classifyChangedPaths(["docs/dokumentacja/index.html"]);
    expect(skipHeavyJobs).toBe(true);
    expect(skipJobs).toEqual({ "wp-plugin": true, rls: true, e2e: true });
  });

  it("powierzchnia WordPress w panelu uruchamia wp-plugin (segment wordpress*/wp-*)", () => {
    for (const path of [
      "apps/panel/lib/wordpress/api-base-url.ts",
      "apps/panel/test/wordpress-plugin-package.test.ts",
      "apps/panel/test/wp-booking-field-errors.test.ts",
      "apps/panel/app/[locale]/(panel)/ustawienia-api/wordpress-guide.tsx",
    ]) {
      const { skipJobs } = classifyChangedPaths([path]);
      expect(skipJobs["wp-plugin"], path).toBe(false);
      expect(skipJobs.e2e, path).toBe(false); // apps/** → e2e biegnie
      expect(skipJobs.rls, path).toBe(true);
    }
  });

  it("panel POZA powierzchnią WordPress nie uruchamia wp-plugin", () => {
    const { skipJobs } = classifyChangedPaths(["apps/panel/lib/review-write-guard.ts"]);
    expect(skipJobs).toEqual({ "wp-plugin": true, rls: true, e2e: false });
  });

  it("pakiety aplikacyjne (ui/core/emails/pdf/security/e2e) → e2e biegnie, wp-plugin i rls pominięte", () => {
    for (const path of [
      "packages/ui/src/tokens.ts",
      "packages/core/src/pricing.ts",
      "packages/emails/src/order.tsx",
      "packages/pdf/src/umowa.ts",
      "packages/security/src/rate-limit.ts",
      "packages/e2e/tests/checkout.spec.ts",
    ]) {
      const { skipJobs } = classifyChangedPaths([path]);
      expect(skipJobs, path).toEqual({ "wp-plugin": true, rls: true, e2e: false });
    }
  });

  it("STREFA NIEZNANA = pełne CI: workflow, skrypty, manifesty, lockfile, .github, nieznany katalog", () => {
    // Kontrola pozytywna tego PR-a: zmiana `.github/workflows/ci.yml` lub
    // samego klasyfikatora NIGDY nie kwalifikuje się do żadnego pominięcia —
    // bramka nie zwalnia sama siebie.
    for (const path of [
      ".github/workflows/ci.yml",
      ".github/scripts/supabase-ci-izolacja.sh",
      "scripts/ci-zakres-zmian.mjs",
      "scripts/build-wp-plugin-zip.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "turbo.json",
      "nieznany-katalog/plik.ts",
    ]) {
      const { skipJobs } = classifyChangedPaths([path]);
      expect(skipJobs, path).toEqual({ "wp-plugin": false, rls: false, e2e: false });
    }
  });

  it("dokumentacja czytana przez kod nie kwalifikuje się do żadnego pominięcia", () => {
    const { skipJobs } = classifyChangedPaths([
      "docs/branding/2026-07-20-avably-faza-2-system.html",
    ]);
    expect(skipJobs).toEqual({ "wp-plugin": false, rls: false, e2e: false });
  });

  it("suma po ścieżkach: jeden plik spoza stref gasi WSZYSTKIE pominięcia", () => {
    const { skipJobs } = classifyChangedPaths([
      "apps/storefront/app/page.tsx",
      "pnpm-lock.yaml",
    ]);
    expect(skipJobs).toEqual({ "wp-plugin": false, rls: false, e2e: false });
  });

  it("diff mieszany docs+kod: ścieżka dokumentacji nie gasi pominięć per-job", () => {
    const { skipHeavyJobs, skipJobs } = classifyChangedPaths([
      "docs/dokumentacja/index.html",
      "apps/storefront/app/page.tsx",
    ]);
    expect(skipHeavyJobs).toBe(false);
    expect(skipJobs).toEqual({ "wp-plugin": true, rls: true, e2e: false });
  });

  it("fail-closed: pusta lista, nie-tablica i ścieżka zdeformowana → zero pominięć per-job", () => {
    for (const input of [[], null, undefined, 42, ["docs/../packages/db/x.sql"], ["", "  "]]) {
      const { skipJobs } = classifyChangedPaths(input as never);
      expect(skipJobs, JSON.stringify(input)).toEqual({
        "wp-plugin": false,
        rls: false,
        e2e: false,
      });
    }
  });

  it("jobsAffectedByPath: ścieżka zdeformowana dotyka wszystkich jobów", () => {
    expect(jobsAffectedByPath("docs/../packages/db/x.sql").sort()).toEqual([
      "e2e",
      "rls",
      "wp-plugin",
    ]);
    expect(jobsAffectedByPath("README.md")).toEqual([]);
  });
});

describe("kontrakt workflow — concurrency", () => {
  it("workflow deklaruje grupę współbieżności per workflow + ref", () => {
    expect(workflow).toMatch(/^concurrency:$/m);
    const group = workflow.split("\n").find((line) => line.trim().startsWith("group:")) ?? "";
    expect(group).toContain("github.workflow");
    expect(group).toContain("github.ref");
  });

  it("cancel-in-progress obowiązuje WYŁĄCZNIE dla pull_request", () => {
    const cancel =
      workflow.split("\n").find((line) => line.trim().startsWith("cancel-in-progress:")) ?? "";
    expect(cancel).toContain("github.event_name == 'pull_request'");
    // Bezwarunkowe `true` ubijałoby przebiegi z pusha na main — a to jedyny
    // zapis o tym, że dana wersja main przeszła bramki.
    expect(workflow).not.toMatch(/cancel-in-progress:\s*true/);
  });

  it("przebiegi z pusha mają własną grupę (nie ubijają się i nie czekają)", () => {
    const group = workflow.split("\n").find((line) => line.trim().startsWith("group:")) ?? "";
    expect(group).toContain("github.event_name == 'push'");
    expect(group).toContain("github.sha");
  });
});

describe("kontrakt workflow — pominięcie ciężkich jobów", () => {
  it("job `zakres` woła klasyfikator ze skryptu, a nie duplikuje warunków w YAML", () => {
    const zakres = jobBlock("zakres");
    expect(zakres).toContain("node scripts/ci-zakres-zmian.mjs --zero");
    // Separator NUL po OBU stronach: bez tego nazwa ze znakiem specjalnym
    // rozpadłaby się na dwie ścieżki jeszcze przed klasyfikacją.
    expect(zakres).toContain("git diff --name-only --no-renames -z");
    // Bez pełnej historii baza jest nieosiągalna i bramka nigdy nie oszczędza.
    expect(zakres).toContain("fetch-depth: 0");
    expect(zakres).toContain("pomin: ${{ steps.ocena.outputs.pomin }}");
    // Warstwa per-job (ADR-207): outputs zadeklarowane w jobie `zakres` —
    // bez deklaracji warunek per-job w ciężkim jobie czyta pustkę na zawsze.
    for (const output of Object.values(PER_JOB_OUTPUTS)) {
      expect(zakres).toContain(`${output}: \${{ steps.ocena.outputs.${output} }}`);
    }
    // Fail-safe bash: wczesne wyjście `pelne_ci` pisze też werdykty per-job,
    // żeby log przebiegu nazywał stan wprost (pustka i tak znaczy „biegnie").
    for (const output of Object.values(PER_JOB_OUTPUTS)) {
      expect(zakres).toContain(`echo "${output}=false"`);
    }
  });

  it("warstwa per-job (ADR-207): każdy job z własnym warunkiem, `ci` świadomie bez niego", () => {
    for (const [job, output] of Object.entries(PER_JOB_OUTPUTS)) {
      expect(jobBlock(job), job).toContain(`needs.zakres.outputs.${output} != 'true'`);
    }
    // `ci` biegnie na każdej zmianie kodu — testy jednostkowe i bramki
    // bezpieczeństwa są tanie względem ryzyka pominięcia. Dopisanie mu
    // warunku per-job to regresja decyzji ADR-207.
    expect(jobBlock("ci")).not.toContain("pomin_");
  });

  it("każdy ciężki job jest podpięty pod `zakres` i przepuszcza przy pustym wyjściu", () => {
    for (const job of HEAVY_JOBS) {
      const block = jobBlock(job);
      expect(block, job).toContain("needs: zakres");
      expect(block, job).toContain("needs.zakres.outputs.pomin != 'true'");
      // `!cancelled()`: padnięty klasyfikator ma dać pełne CI, nie ciszę.
      expect(block, job).toContain("!cancelled()");
    }
  });

  it("zawartość ciężkich jobów nietknięta — zmieniamy KIEDY biegną, nie CO robią", () => {
    const ci = jobBlock("ci");
    expect(ci).toContain("bash scripts/audit-service-role.sh");
    expect(ci).toContain("bash scripts/audit-public-env.sh");
    expect(ci).toContain("bash scripts/audit-browser-env-inlining.sh");
    expect(ci).toContain("pnpm audit --audit-level high");
    expect(ci).toContain('ALLOW_INTEGRATION_SKIP: "1"');
    // Bramki designu (ADR-183). Wpis TUTAJ, a nie tylko w YAML-u, bo dokładnie
    // ta wada zamknęła ADR-183: verifier brandingu nie biegł NIGDZIE i nikt
    // nie dostawał sygnału, że rdzewieje. Krok skasowany albo przeniesiony do
    // innego joba musi wywrócić suitę, nie zniknąć po cichu.
    expect(ci).toContain("pnpm verify:branding");

    const rls = jobBlock("rls");
    expect(rls).toContain("pnpm --filter @avably/db test");
    expect(rls).toContain("pnpm --filter panel test");
    expect(rls).toContain("pnpm --filter storefront test");
    expect(rls).not.toContain("ALLOW_INTEGRATION_SKIP");

    const e2e = jobBlock("e2e");
    expect(e2e).toContain("pnpm --filter @avably/e2e e2e:build");
    expect(e2e).toContain("pnpm --filter @avably/e2e e2e");
  });
});

describe("CLI klasyfikatora — dowód behawioralny", () => {
  function runClassifier(paths: string[]): { stdout: string; output: string } {
    const directory = mkdtempSync(join(tmpdir(), "avably-zakres-"));
    const outputFile = join(directory, "github-output.txt");
    writeFileSync(outputFile, "");
    const stdout = execFileSync("node", ["scripts/ci-zakres-zmian.mjs", "--zero"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      input: `${paths.map((path) => `${path}\0`).join("")}`,
      env: { ...process.env, GITHUB_OUTPUT: outputFile },
    });
    return { stdout, output: readFileSync(outputFile, "utf8") };
  }

  /** Komplet czterech linii werdyktu — kolejność przypięta świadomie. */
  function verdictLines(
    pomin: boolean,
    perJob: { wp: boolean; rls: boolean; e2e: boolean },
  ): string {
    return [
      `pomin=${pomin}`,
      `pomin_wp_plugin=${perJob.wp}`,
      `pomin_rls=${perJob.rls}`,
      `pomin_e2e=${perJob.e2e}`,
    ].join("\n");
  }

  it("dokumentacja: komplet werdyktów trafia na stdout i do GITHUB_OUTPUT", () => {
    const { stdout, output } = runClassifier(["docs/dokumentacja/index.html"]);
    const expected = verdictLines(true, { wp: true, rls: true, e2e: true });
    expect(stdout.trim()).toBe(expected);
    expect(output.trim()).toBe(expected);
  });

  it("kod bazy: globalny pomin=false, rls i e2e biegną, wp-plugin pominięty", () => {
    const { stdout, output } = runClassifier([
      "docs/dokumentacja/index.html",
      "packages/db/src/index.ts",
    ]);
    const expected = verdictLines(false, { wp: true, rls: false, e2e: false });
    expect(stdout.trim()).toBe(expected);
    expect(output.trim()).toBe(expected);
  });

  it("storefront-only: wp-plugin i rls pominięte także na poziomie CLI", () => {
    const { stdout, output } = runClassifier(["apps/storefront/app/page.tsx"]);
    const expected = verdictLines(false, { wp: true, rls: true, e2e: false });
    expect(stdout.trim()).toBe(expected);
    expect(output.trim()).toBe(expected);
  });

  it("pusty diff: pełne CI we wszystkich werdyktach", () => {
    const { stdout } = runClassifier([]);
    expect(stdout.trim()).toBe(verdictLines(false, { wp: false, rls: false, e2e: false }));
  });

  it("nazwa pliku ze znakiem nowej linii nie przechodzi jako dokumentacja", () => {
    // Wejście -z trzyma taką nazwę w JEDNYM rekordzie (dlatego jest -z),
    // a klasyfikator odmawia jej zrozumienia i żąda pełnego CI.
    const { stdout } = runClassifier(["docs/a\nb.md"]);
    expect(stdout.trim()).toBe(verdictLines(false, { wp: false, rls: false, e2e: false }));
  });
});
