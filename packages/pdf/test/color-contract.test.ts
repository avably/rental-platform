import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Kontrakt palety PDF: źródłem prawdy jest sekcja 01 artefaktu Fazy 2,
// nie ręcznie utrzymywany rejestr kolorów. Biel papieru jest jedynym
// wyjątkiem druku; jawnie ją dopuszczamy nawet wtedy, gdy występuje też
// w rejestrze kontrastów sekcji 01.

const packageRoot = resolve(process.cwd());
const repositoryRoot = resolve(packageRoot, "../..");
const artifact = readFileSync(
  resolve(repositoryRoot, "docs/branding/2026-07-20-avably-faza-2-system.html"),
  "utf8",
);

const foundations = artifact.match(
  /<section id="foundations"[\s\S]*?<\/section>/,
)?.[0];

if (!foundations) throw new Error("Brak sekcji 01 (#foundations) w artefakcie brandingu");

const ARTIFACT_HEX_PATTERN = /#[0-9A-Fa-f]{6}/g;
const SOURCE_HEX_PATTERN = /#(?:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4}|[0-9A-Fa-f]{3})(?![0-9A-Fa-f])/g;
const artifactColors = new Set(
  [...foundations.matchAll(ARTIFACT_HEX_PATTERN)].map(([hex]) => hex.toUpperCase()),
);
const printAllowlist = new Set(["#FFFFFF"]); // Czysta biel papieru.
const allowedColors = new Set([...artifactColors, ...printAllowlist]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return [".ts", ".tsx"].includes(extname(entry.name)) ? [path] : [];
  });
}

const sources = sourceFiles(resolve(packageRoot, "src")).map((path) => ({
  path,
  relativePath: relative(repositoryRoot, path),
  source: readFileSync(path, "utf8"),
}));
const templateSource = readFileSync(resolve(packageRoot, "src/contract-template.tsx"), "utf8");

// Skan hexów pilnuje NOTACJI, nie koloru NAMALOWANEGO — `@react-pdf` przyjmuje
// też `rgb()/hsl()` i nazwy CSS, więc wycofana paleta wróciłaby jako
// `rgb(212, 168, 67)` niewidzialna dla skanu. Dwa poniższe strażniki zamykają
// tę furtkę: notacja funkcyjna jest zakazana, a wartość przypisana do
// właściwości kolorystycznej musi być literałem hex (wtedy łapie ją paleta).
const COLOR_FUNCTION_PATTERN = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const COLOR_PROPERTY_PATTERN =
  /\b(?:color|backgroundColor|borderColor|border(?:Top|Right|Bottom|Left)Color)\s*:\s*(?:"([^"]*)"|'([^']*)')/g;
const HEX_LITERAL_PATTERN = /^#(?:[0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/;

describe("kontrakt kolorów umowy PDF (sekcja 01 artefaktu → src)", () => {
  it("rozpoznaje pełne literały hex zamiast pomijać lub ucinać obce kolory", () => {
    expect([..."#BAD #C0DE #0B101780".matchAll(SOURCE_HEX_PATTERN)].map(([hex]) => hex)).toEqual([
      "#BAD",
      "#C0DE",
      "#0B101780",
    ]);
  });

  it("artefakt zawiera zamrożony rdzeń palety Avably", () => {
    for (const color of ["#F4F6F5", "#0B1017", "#EAFFA4", "#5F7500", "#55616D", "#7E8994"]) {
      expect(artifactColors, `brak ${color} w sekcji 01 artefaktu`).toContain(color);
    }
  });

  it("nie dopuszcza kolorów wycofanej palety", () => {
    for (const { relativePath, source } of sources) {
      expect(source, `${relativePath}: zakazany kolor wycofanej palety`).not.toMatch(
        /#(?:D4A843|1e293b)/i,
      );
    }
  });

  it("utrwala nośniki limonki i role akcentów dokumentu", () => {
    const semanticColors = {
      INK: "#0B1017",
      MUTED: "#55616D",
      CANVAS: "#F4F6F5",
      BORDER: "#7E8994",
      LIME: "#EAFFA4",
      SIGNAL_STRONG: "#5F7500",
      PAPER_WHITE: "#FFFFFF",
    } as const;
    for (const [name, hex] of Object.entries(semanticColors)) {
      expect(templateSource, `${name} musi wskazywać dokładny kolor roli`).toContain(
        `const ${name} = "${hex}";`,
      );
    }

    expect(templateSource).toMatch(/headerBar:\s*\{[\s\S]*?backgroundColor:\s*INK/);
    expect(templateSource).toMatch(/title:\s*\{[^}]*color:\s*PAPER_WHITE/);
    expect(templateSource).toMatch(/headerMeta:\s*\{[^}]*color:\s*PAPER_WHITE/);
    expect(templateSource).toMatch(/orderBadge:\s*\{[\s\S]*?backgroundColor:\s*LIME/);
    expect(templateSource).toMatch(/orderBadgeText:\s*\{[^}]*color:\s*INK/);
    expect(templateSource).toMatch(/partyLabel:\s*\{[\s\S]*?color:\s*SIGNAL_STRONG/);
  });

  it("nie dopuszcza kropki marki jako ozdobnika ani efektów", () => {
    for (const { relativePath, source } of sources) {
      expect(source, `${relativePath}: kropka marki wyłącznie w zatwierdzonym znaku`).not.toMatch(
        /#A8C743/i,
      );
      expect(source, `${relativePath}: zakaz gradientów i cieni`).not.toMatch(/gradient|shadow/i);
    }
  });

  it("wykrywa notację funkcyjną i nie-hexową wartość koloru (kontrola pozytywna)", () => {
    expect(COLOR_FUNCTION_PATTERN.test('color: "rgb(212, 168, 67)"')).toBe(true);
    expect(COLOR_FUNCTION_PATTERN.test('color: "oklch(0.7 0.1 90)"')).toBe(true);
    expect(COLOR_FUNCTION_PATTERN.test('color: "#D4A843"')).toBe(false);
    const probe = 'backgroundColor: "goldenrod", color: "#0B1017"';
    expect(
      [...probe.matchAll(COLOR_PROPERTY_PATTERN)].map(([, dq, sq]) => dq ?? sq),
    ).toEqual(["goldenrod", "#0B1017"]);
    expect(HEX_LITERAL_PATTERN.test("goldenrod")).toBe(false);
    expect(HEX_LITERAL_PATTERN.test("#0B1017")).toBe(true);
  });

  it("nie dopuszcza kolorów zapisanych poza notacją hex", () => {
    for (const { relativePath, source } of sources) {
      expect(source, `${relativePath}: kolor w notacji funkcyjnej omija skan palety`).not.toMatch(
        COLOR_FUNCTION_PATTERN,
      );
      for (const [, doubleQuoted, singleQuoted] of source.matchAll(COLOR_PROPERTY_PATTERN)) {
        const value = doubleQuoted ?? singleQuoted ?? "";
        expect(
          HEX_LITERAL_PATTERN.test(value),
          `${relativePath}: wartość koloru "${value}" nie jest literałem hex, więc paleta jej nie sprawdza`,
        ).toBe(true);
      }
    }
  });

  it("każdy hex w źródłach należy do palety artefaktu lub whitelisty druku", () => {
    for (const { relativePath, source } of sources) {
      const usedColors = [...source.matchAll(SOURCE_HEX_PATTERN)].map(([hex]) => hex.toUpperCase());
      const unknownColors = [...new Set(usedColors)].filter((hex) => !allowedColors.has(hex));
      expect(unknownColors, `${relativePath}: kolory spoza palety`).toEqual([]);
    }
  });
});
