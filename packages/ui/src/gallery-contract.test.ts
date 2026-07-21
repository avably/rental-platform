import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcssPostcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");

// Trasy obu apek mieszkają pod segmentem [locale] (routing next-intl, ADR-013),
// więc layout i galeria nie leżą bezpośrednio w app/.
const panelGallery = resolve(
  repositoryRoot,
  "apps/panel/app/[locale]/design-system/page.tsx",
);

describe("integracja design systemu", () => {
  it("udostępnia galerię jako konsumenta publicznego API", () => {
    expect(existsSync(panelGallery)).toBe(true);

    if (!existsSync(panelGallery)) return;
    const source = readFileSync(panelGallery, "utf8");
    expect(source).toContain('from "@avably/ui"');
    expect(source).toContain("aria-pressed={darkMode}");
    expect(source).toMatch(/darkMode\s*\?\s*"dark/);
    expect(source).toContain('id="buttons-badges"');
    expect(source).toContain('id="overlays"');
    expect(source).toContain("defaultMonth={new Date(2026, 6, 1)}");
    expect(source).not.toContain('id={`section-${title}`}');
  });

  // ADR-053 (delta P1a): OBA produkty jadą w całości na Geist Sans —
  // jeden stack --font-sans, jedna zmienna --font-geist-sans.
  it.each(["panel", "storefront"])(
    "%s importuje wspólny arkusz i ładuje Geist",
    (application) => {
      const globals = readFileSync(
        resolve(repositoryRoot, `apps/${application}/app/globals.css`),
        "utf8",
      );
      const layout = readFileSync(
        resolve(repositoryRoot, `apps/${application}/app/[locale]/layout.tsx`),
        "utf8",
      );

      expect(globals).toContain('@import "@avably/ui/styles.css"');
      expect(layout).toContain("Geist");
      expect(layout).toContain('variable: "--font-geist-sans"');
    },
  );

  // Twardy zakaz artefaktu Fazy 2: żadnych innych rodzin w produkcie.
  it.each([
    ["panel", ["app/[locale]/layout.tsx"]],
    ["storefront", ["app/[locale]/layout.tsx", "app/fonts.ts"]],
  ] as const)(
    "%s nie deklaruje zakazanych rodzin (Geist Mono, Safiro, Inter, Lora)",
    (application, files) => {
      for (const file of files) {
        const source = readFileSync(
          resolve(repositoryRoot, `apps/${application}/${file}`),
          "utf8",
        );
        expect(source, `${application}/${file}`).not.toMatch(
          /Geist_Mono|Safiro|Lora|\bInter\b/,
        );
      }
    },
  );
});

// ===== Recenzja PM (delta P1a) =====
// Grep źródła po nazwach rodzin (bloki wyżej) NIE łapie tego, że usunięcie
// mapowania --font-mono zostawia gołe <code>/<pre>/<kbd> na twardym
// fallbacku Preflight `ui-monospace, …` — nadal monospace, tylko poza
// kontrolą tokenu. Ten blok kompiluje PRAWDZIWY arkusz przez ten sam silnik
// (@tailwindcss/postcss), którego używa build Next.js, i sprawdza COMPUTED
// STYLE realnego elementu w jsdom, nie treść pliku źródłowego.
describe("typografia <code>/<pre>/<kbd> — computed style, nie grep źródła", () => {
  let expectedMonoFallbackStack: string;
  let expectedSansStack: string;

  beforeAll(async () => {
    const entry = `@import "tailwindcss";\n@import "@avably/ui/styles.css";\n`;
    const result = await postcss([
      tailwindcssPostcss({ base: process.cwd(), optimize: false }),
    ]).process(entry, { from: resolve(process.cwd(), "virtual.css") });

    // jsdom NIE egzekwuje poprawnie priorytetu CSS Cascade Layers (@layer) —
    // zweryfikowane empirycznie: reguła bazowa `code {…}` wygrywała z
    // `.font-sans {…}` mimo że warstwa utilities ma być nadrzędna. Zdejmujemy
    // WYŁĄCZNIE opakowania `@layer nazwa { … }`, zachowując treść i kolejność
    // 1:1 — dla porównania klasa-vs-selektor-typu (nasz jedyny przypadek)
    // specyficzność CSS daje ten sam wynik, co warstwy w prawdziwej
        // przeglądarce, więc to bezpieczne uproszczenie, nie obejście testu.
    const flattened = stripAtLayerWrappers(result.css);

    expectedMonoFallbackStack = extractDeclarationValue(
      flattened,
      "code, kbd, samp, pre {",
      "font-family",
    );
    expectedSansStack = extractDeclarationValue(
      flattened,
      ".font-sans {",
      "font-family",
    );

    const style = document.createElement("style");
    style.textContent = flattened;
    document.head.appendChild(style);
  });

  const renderCode = (className?: string) => {
    const element = document.createElement("code");
    if (className) element.className = className;
    element.textContent = "x";
    document.body.appendChild(element);
    return element;
  };

  it("arkusz naprawdę definiuje inny font dla gołego <code> niż dla .font-sans (dowód ryzyka)", () => {
    // Jeśli to kiedyś przestanie być prawdą (np. handoff zdefiniuje
    // --default-mono-font-family na Geist Sans), reszta bloku traci sens —
    // sprawdzamy więc samo założenie, nie tylko wniosek.
    expect(expectedMonoFallbackStack).not.toBe(expectedSansStack);
    expect(expectedMonoFallbackStack).toMatch(/monospace/);
  });

  it("goły <code> (bez klasy) renderuje się fallbackiem monospace — computed style", () => {
    const element = renderCode();
    expect(getComputedStyle(element).fontFamily).toBe(expectedMonoFallbackStack);
  });

  it("<code className='font-sans'> renderuje się stackiem --font-sans — computed style", () => {
    const element = renderCode("font-sans");
    expect(getComputedStyle(element).fontFamily).toBe(expectedSansStack);
  });

  it("<code className='font-sans tabular-nums'> zostaje w --font-sans (tabular-nums nie dotyka font-family)", () => {
    const element = renderCode("font-sans tabular-nums");
    expect(getComputedStyle(element).fontFamily).toBe(expectedSansStack);
  });

  // Audyt systematyczny: KAŻDE wystąpienie <code>/<pre>/<kbd> w obu apkach
  // musi jawnie nieść font-sans — inaczej pada tu, zanim wróci do produkcji.
  // className dynamiczny (wyrażenie JS) nie da się zweryfikować statycznie,
  // więc też pada — z jawnym żądaniem ręcznego audytu, bez cichego przejścia.
  const scannedFiles = [
    ...walkTsxFiles(resolve(repositoryRoot, "apps/panel")),
    ...walkTsxFiles(resolve(repositoryRoot, "apps/storefront")),
  ];

  it("skan znalazł pliki do audytu (kontrola pozytywna testu)", () => {
    expect(scannedFiles.length).toBeGreaterThan(50);
  });

  it.each(scannedFiles.flatMap((file) => findMonospaceProneTags(file)))(
    "$file:$line <$tag> ma font-sans w className",
    ({ classAttribute }) => {
      if (classAttribute.kind === "dynamic") {
        throw new Error(
          "className dynamiczny na <code>/<pre>/<kbd> — nie da się zweryfikować statycznie; " +
            "dodaj font-sans jawnie albo zweryfikuj ręcznie i wypisz w raporcie.",
        );
      }
      const classes = classAttribute.value.split(/\s+/).filter(Boolean);
      expect(classes).toContain("font-sans");
    },
  );
});

function stripAtLayerWrappers(css: string): string {
  let out = css.replace(/@layer\s+[\w\s,-]+;/g, "");
  let result = "";
  const opener = /@layer\s+[\w-]+\s*\{/;
  for (;;) {
    const match = opener.exec(out);
    if (!match) {
      result += out;
      break;
    }
    result += out.slice(0, match.index);
    const openIndex = match.index + match[0].length - 1;
    let depth = 1;
    let cursor = openIndex + 1;
    while (depth > 0 && cursor < out.length) {
      if (out[cursor] === "{") depth++;
      else if (out[cursor] === "}") depth--;
      cursor++;
    }
    result += out.slice(openIndex + 1, cursor - 1);
    out = out.slice(cursor);
  }
  return result;
}

function requireGroup(match: RegExpMatchArray | RegExpExecArray, index: number): string {
  const group = match[index];
  if (group === undefined) {
    throw new Error(`Brak grupy przechwytującej ${index} w dopasowaniu ${match[0]}`);
  }
  return group;
}

function extractDeclarationValue(
  css: string,
  selectorSource: string,
  property: string,
): string {
  const ruleStart = css.indexOf(selectorSource);
  if (ruleStart === -1) {
    throw new Error(`Brak reguły dla selektora: ${selectorSource}`);
  }
  const braceOpen = css.indexOf("{", ruleStart);
  const braceClose = css.indexOf("}", braceOpen);
  const body = css.slice(braceOpen + 1, braceClose);
  const match = new RegExp(`${property}\\s*:\\s*([^;]+);`).exec(body);
  if (!match) {
    throw new Error(`Brak deklaracji ${property} w regule ${selectorSource}`);
  }
  return requireGroup(match, 1).trim();
}

const IGNORED_DIRECTORIES = new Set(["node_modules", ".next", ".turbo"]);

function walkTsxFiles(directory: string, out: string[] = []): string[] {
  if (!existsSync(directory)) return out;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const full = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      walkTsxFiles(full, out);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

type ClassAttribute =
  | { kind: "static"; value: string }
  | { kind: "dynamic"; value: null }
  | { kind: "absent"; value: "" };

function extractClassAttribute(tagSource: string): ClassAttribute {
  const staticMatch = /className\s*=\s*"([^"]*)"/.exec(tagSource);
  if (staticMatch) return { kind: "static", value: requireGroup(staticMatch, 1) };
  if (/className\s*=\s*\{/.test(tagSource)) return { kind: "dynamic", value: null };
  return { kind: "absent", value: "" };
}

// Znajduje `>` domykający tag JSX, respektując zagnieżdżone `{}` (wyrażenia,
// w tym strzałkowe `=>`) i cudzysłowy — naiwny `[^>]*>` łapie zły `>` przy
// pierwszym wyrażeniu w atrybucie.
function findTagEnd(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
    } else if (ch === ">" && depth === 0) {
      return i;
    }
  }
  return -1;
}

function findMonospaceProneTags(
  file: string,
): { file: string; line: number; tag: string; classAttribute: ClassAttribute }[] {
  const source = readFileSync(file, "utf8");
  const relativePath = file.slice(repositoryRoot.length + 1);
  const results: { file: string; line: number; tag: string; classAttribute: ClassAttribute }[] = [];
  const tagPattern = /<(code|pre|kbd)(?=[\s>])/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(source))) {
    const tagEnd = findTagEnd(source, match.index);
    if (tagEnd === -1) continue;
    const tagSource = source.slice(match.index, tagEnd + 1);
    const line = source.slice(0, match.index).split("\n").length;
    results.push({
      file: relativePath,
      line,
      tag: requireGroup(match, 1),
      classAttribute: extractClassAttribute(tagSource),
    });
  }
  return results;
}
