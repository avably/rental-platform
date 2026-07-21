import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Kontrakt tokenów Fazy 2 (ADR-053): źródłem prawdy jest artefakt handoffu,
// nie ręcznie utrzymywany rejestr par. Test iteruje po KOMPLECIE tokenów
// z powierzchni handoffu — brakujący lub przekłamany token w styles.css
// wywraca suitę bez żadnej rejestracji (lekcja PR #83: kontrakt opt-in
// nie jest kontraktem).

const repositoryRoot = resolve(process.cwd(), "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);
const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function extractHandoffSurface(name: string): string {
  const pattern = new RegExp(
    `<pre[^>]*data-code-surface="${name}"[^>]*><code>([\\s\\S]*?)</code></pre>`,
  );
  const body = artifact.match(pattern)?.[1];
  if (!body) throw new Error(`Brak powierzchni handoffu ${name}`);
  return decodeHtmlEntities(body);
}

// Kotwica MUSI zawierać otwierającą klamrę (np. ":root {"), inaczej
// `.dark` z @custom-variant złapałby cudzy blok.
function extractBalancedBlock(source: string, anchor: string): string {
  if (!anchor.endsWith("{")) throw new Error(`Kotwica bez klamry: ${anchor}`);
  const anchorIndex = source.indexOf(anchor);
  if (anchorIndex === -1) throw new Error(`Brak bloku ${anchor}`);
  const openIndex = anchorIndex + anchor.length - 1;
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(openIndex + 1, index);
  }
  throw new Error(`Niedomknięty blok ${anchor}`);
}

function parseCustomProperties(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of body
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    declarations.set(name, declaration.slice(colon + 1).trim().replace(/\s+/g, " "));
  }
  return declarations;
}

// Podłoga liczności: bez niej usunięcie tokenu z ARTEFAKTU cicho kurczy
// kontrakt (iteracja po mniejszym zbiorze dalej jest zielona). Wartości =
// faktyczna liczność powierzchni handoffu w chwili zamrożenia Fazy 2.
const surfaces = [
  { surface: "tokens-light", selector: ":root", minimumTokens: 58 },
  { surface: "tokens-dark", selector: ".dark", minimumTokens: 32 },
] as const;

describe("kontrakt tokenów Fazy 2 (handoff → styles.css)", () => {
  for (const { surface, selector, minimumTokens } of surfaces) {
    const handoffTokens = parseCustomProperties(
      extractBalancedBlock(extractHandoffSurface(surface), surface === "tokens-light" ? ":root {" : ".dark {"),
    );
    const styleTokens = parseCustomProperties(extractBalancedBlock(css, `${selector} {`));

    it(`powierzchnia ${surface} ma komplet tokenów (≥ ${minimumTokens})`, () => {
      expect(handoffTokens.size).toBeGreaterThanOrEqual(minimumTokens);
    });

    describe(`${surface} → ${selector}`, () => {
      for (const [name, value] of handoffTokens) {
        it(`token ${name} istnieje i ma wartość handoffu`, () => {
          expect(styleTokens.has(name), `Brak tokenu ${name} w bloku ${selector}`).toBe(true);
          expect(styleTokens.get(name)).toBe(value);
        });
      }
    });
  }
});
