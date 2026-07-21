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

const HEX_PATTERN = /#[0-9A-Fa-f]{6}/g;
const artifactColors = new Set(
  [...foundations.matchAll(HEX_PATTERN)].map(([hex]) => hex.toUpperCase()),
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

describe("kontrakt kolorów umowy PDF (sekcja 01 artefaktu → src)", () => {
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

  it("każdy hex w źródłach należy do palety artefaktu lub whitelisty druku", () => {
    for (const { relativePath, source } of sources) {
      const usedColors = [...source.matchAll(HEX_PATTERN)].map(([hex]) => hex.toUpperCase());
      const unknownColors = [...new Set(usedColors)].filter((hex) => !allowedColors.has(hex));
      expect(unknownColors, `${relativePath}: kolory spoza palety`).toEqual([]);
    }
  });
});
