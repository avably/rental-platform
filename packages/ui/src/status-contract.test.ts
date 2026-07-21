import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { statusSemantics, statusTones } from "./lib/status-semantics";

// Kontrakt statusów Fazy 2 (ADR-055): tokeny --status-* w styles.css są KOPIĄ
// klas .chip-* z artefaktu, a mapa domenowa statusSemantics jest KOPIĄ
// powierzchni status-map. Wzorzec tokens-contract.test.ts (ADR-053 D2):
// iterujemy po zbiorze ARTEFAKTU — brakujący lub przekłamany wpis wywraca
// suitę bez rejestracji; tokeny to rozszerzenie kontraktu, nie handoff.

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
  for (const declaration of body.replace(/\/\*[\s\S]*?\*\//g, "").split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    declarations.set(
      name,
      declaration
        .slice(colon + 1)
        .trim()
        .replace(/\s+/g, " "),
    );
  }
  return declarations;
}

// ===== 1. Tokeny chipów: artefakt .chip-* → styles.css --status-* =====

type ChipColors = { background: string; color: string; border: string };

function parseChipRules(scope: "light" | "dark"): Map<string, ChipColors> {
  const prefix = scope === "dark" ? "\\.dark \\." : "(?<!\\.dark )\\.";
  const pattern = new RegExp(
    `${prefix}chip-(neutral|attention|positive|problem)\\s*\\{\\s*` +
      `background:\\s*(#[0-9A-Fa-f]{6});\\s*` +
      `color:\\s*(#[0-9A-Fa-f]{6});\\s*` +
      `border-color:\\s*(#[0-9A-Fa-f]{6});\\s*\\}`,
    "g",
  );
  const chips = new Map<string, ChipColors>();
  for (const match of artifact.matchAll(pattern)) {
    const [, tone, background, color, border] = match;
    if (!tone || !background || !color || !border) continue;
    chips.set(tone, { background, color, border });
  }
  return chips;
}

const styleRootTokens = parseCustomProperties(extractBalancedBlock(css, ":root {"));
const styleDarkTokens = parseCustomProperties(extractBalancedBlock(css, ".dark {"));

describe("kontrakt tokenów statusów (artefakt .chip-* → styles.css)", () => {
  for (const scope of ["light", "dark"] as const) {
    const chips = parseChipRules(scope);
    const styleTokens = scope === "light" ? styleRootTokens : styleDarkTokens;

    // Podłoga liczności: bez niej usunięcie klasy .chip-* z ARTEFAKTU
    // kurczyłoby kontrakt po cichu (lekcja ADR-053 D2).
    it(`artefakt definiuje komplet czterech chipów (${scope})`, () => {
      expect([...chips.keys()].sort()).toEqual([
        "attention",
        "neutral",
        "positive",
        "problem",
      ]);
    });

    for (const [tone, colors] of chips) {
      it(`token --status-${tone}-* ma wartości artefaktu (${scope})`, () => {
        expect(
          styleTokens.get(`--status-${tone}-bg`),
          `--status-${tone}-bg (${scope})`,
        ).toBe(colors.background);
        expect(
          styleTokens.get(`--status-${tone}-fg`),
          `--status-${tone}-fg (${scope})`,
        ).toBe(colors.color);
        expect(
          styleTokens.get(`--status-${tone}-border`),
          `--status-${tone}-border (${scope})`,
        ).toBe(colors.border);
      });
    }
  }
});

// ===== 2. Mapa domenowa: powierzchnia status-map → statusSemantics =====

describe("kontrakt mapy statusów domenowych (status-map → statusSemantics)", () => {
  const surface = JSON.parse(extractHandoffSurface("status-map")) as Record<
    string,
    Record<string, string>
  >;

  it("powierzchnia obejmuje osie order/payment/shipment", () => {
    expect(Object.keys(surface).sort()).toEqual(["order", "payment", "shipment"]);
  });

  it("statusSemantics jest identyczna 1:1 z powierzchnią artefaktu", () => {
    expect(statusSemantics).toEqual(surface);
  });

  it("każdy rodzaj z mapy jest jednym z czterech rodzajów semantycznych", () => {
    for (const axis of Object.values(surface)) {
      for (const tone of Object.values(axis)) {
        expect(statusTones).toContain(tone);
      }
    }
  });
});

// ===== 3. Kontrasty: pary statusowe ≥ rejestru artefaktu (matematyka WCAG) =====

function hexRelativeLuminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const [red, green, blue] = channels as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(
    hexRelativeLuminance(foreground),
    hexRelativeLuminance(background),
  );
  const darker = Math.min(
    hexRelativeLuminance(foreground),
    hexRelativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

type RegistryPair = {
  name: string;
  foreground: string;
  background: string;
  minimum: number;
  ratio: number;
};

function parseStatusRegistry(): RegistryPair[] {
  const pattern =
    /data-contrast-pair="(status-(?:light|dark)-[a-z-]+)" data-foreground="(#[0-9A-Fa-f]{6})" data-background="(#[0-9A-Fa-f]{6})" data-kind="(?:text|ui)" data-minimum="([0-9.]+)" data-ratio="([0-9.]+)"/g;
  const pairs: RegistryPair[] = [];
  for (const match of artifact.matchAll(pattern)) {
    const [, name, foreground, background, minimum, ratio] = match;
    if (!name || !foreground || !background || !minimum || !ratio) continue;
    pairs.push({
      name,
      foreground,
      background,
      minimum: Number(minimum),
      ratio: Number(ratio),
    });
  }
  return pairs;
}

describe("kontrasty par statusowych ≥ rejestru artefaktu", () => {
  const registry = parseStatusRegistry();

  it("rejestr artefaktu zawiera komplet par statusowych (8 tekstowych + 4 obrysów dark)", () => {
    expect(registry).toHaveLength(12);
  });

  for (const pair of registry) {
    const [, theme, rest] = pair.name.match(/^status-(light|dark)-(.+)$/) ?? [];
    if (!theme || !rest) throw new Error(`Nieznana para ${pair.name}`);
    const tone = rest.replace(/-border$/, "");
    const isBorder = rest.endsWith("-border");
    const tokens = theme === "light" ? styleRootTokens : styleDarkTokens;

    it(`${pair.name}: tokeny arkusza zgodne z rejestrem i kontrast ≥ ${pair.ratio}`, () => {
      const foreground = tokens.get(
        `--status-${tone}-${isBorder ? "border" : "fg"}`,
      );
      const background = tokens.get(`--status-${tone}-bg`);
      expect(foreground, `brak tokenu fg/border dla ${pair.name}`).toBe(
        pair.foreground,
      );
      expect(background, `brak tokenu bg dla ${pair.name}`).toBe(
        pair.background,
      );
      const ratio = contrastRatio(pair.foreground, pair.background);
      expect(ratio).toBeGreaterThanOrEqual(pair.minimum);
      // Rejestr zaokrągla w dół do 2 miejsc — dopuszczamy błąd zaokrąglenia.
      expect(ratio).toBeGreaterThanOrEqual(pair.ratio - 0.005);
    });
  }
});
