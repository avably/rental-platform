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
} from "../../../scripts/ci-zakres-zmian.mjs";

const repositoryRoot = resolve(process.cwd(), "../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
const workflow = readFileSync(workflowPath, "utf8");

/** Ten plik nazywa ścieżki `docs/` jako DANE TESTOWE, nie jako odczyt. */
const SCAN_SELF = "apps/panel/test/ci-zakres-zmian.test.ts";

/** Ciężkie joby, które wolno pominąć — wymienione z nazwy, nie zgadywane. */
const HEAVY_JOBS = ["ci", "rls", "e2e"] as const;

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
      .filter((file) => /\.(ts|tsx|mjs|mts|cjs|js|json|sh|php|ya?ml)$/.test(file));

    const found = new Map<string, string>();
    for (const file of tracked) {
      const content = readFileSync(resolve(repositoryRoot, file), "utf8");
      content.split("\n").forEach((line, index) => {
        // Komentarze pomijamy: wzmianka „patrz docs/…" nie jest odczytem.
        if (/^\s*(\/\/|\*|\/\*|#)/.test(line)) return;
        // Lookbehind odcina adresy URL (…/en-US/docs/Web/…), gdzie przed
        // „docs/" stoi ukośnik — to cudza dokumentacja, nie nasze repo.
        for (const match of line.matchAll(/(?<![\w/.-])(?:\.\.\/)*docs\/[A-Za-z0-9._/-]+/g)) {
          const candidate = match[0].replace(/^(\.\.\/)+/, "").replace(/[.,;:]+$/, "");
          if (!found.has(candidate)) found.set(candidate, `${file}:${index + 1}`);
        }
      });
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

  it("dokumentacja: werdykt `pomin=true` trafia na stdout i do GITHUB_OUTPUT", () => {
    const { stdout, output } = runClassifier(["docs/dokumentacja/index.html"]);
    expect(stdout.trim()).toBe("pomin=true");
    expect(output.trim()).toBe("pomin=true");
  });

  it("kod: werdykt `pomin=false`", () => {
    const { stdout, output } = runClassifier([
      "docs/dokumentacja/index.html",
      "packages/db/src/index.ts",
    ]);
    expect(stdout.trim()).toBe("pomin=false");
    expect(output.trim()).toBe("pomin=false");
  });

  it("pusty diff: werdykt `pomin=false`", () => {
    const { stdout } = runClassifier([]);
    expect(stdout.trim()).toBe("pomin=false");
  });

  it("nazwa pliku ze znakiem nowej linii nie przechodzi jako dokumentacja", () => {
    // Wejście -z trzyma taką nazwę w JEDNYM rekordzie (dlatego jest -z),
    // a klasyfikator odmawia jej zrozumienia i żąda pełnego CI.
    const { stdout } = runClassifier(["docs/a\nb.md"]);
    expect(stdout.trim()).toBe("pomin=false");
  });
});
