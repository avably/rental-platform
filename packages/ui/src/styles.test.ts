import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const stylesPath = resolve(process.cwd(), "src/styles.css");
const css = readFileSync(stylesPath, "utf8");

function getThemeVariables(selector: ":root" | ".dark") {
  const start = css.indexOf(`${selector} {`);
  const end = css.indexOf("}", start);
  if (start === -1 || end === -1) throw new Error(`Brak motywu ${selector}`);

  const variables = new Map<string, string>();
  for (const match of css
    .slice(start, end)
    .matchAll(/--([a-z0-9-]+):\s*(oklch\([^)]+\))/g)) {
    const [, name, value] = match;
    if (name && value) variables.set(name, value);
  }
  return variables;
}

function relativeLuminance(color: string) {
  const match = color.match(
    /oklch\(([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/[^)]*)?\)/,
  );
  if (!match) throw new Error(`Nieobsługiwany kolor: ${color}`);

  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const red = Math.min(
    1,
    Math.max(0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
  );
  const green = Math.min(
    1,
    Math.max(0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
  );
  const blue = Math.min(
    1,
    Math.max(0, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

it("udostępnia arkusz design systemu", () => {
  expect(existsSync(stylesPath)).toBe(true);
});

it("zawiera kanoniczne motywy bez starszego wyjątku backoffice", () => {
  expect(css).toContain(":root {");
  expect(css).toContain(".dark {");
  expect(css).not.toContain("office-light");
  expect(css).toContain("--background: oklch(1 0 0)");
  expect(css).toContain("--background: oklch(0.13 0.028 261.692)");
});

it("utrzymuje zatwierdzony radius i typografię", () => {
  expect(css).toContain("--radius: 0.625rem");
  expect(css).toContain("--font-sans: var(--font-inter)");
  expect(css).toMatch(/--font-mono:\s+var\(--font-geist-mono\)/);
});

it("rozdziela płaskie powierzchnie od nakładek", () => {
  expect(css).toContain("--shadow-xs: none");
  expect(css).toContain("--shadow-sm: none");
  expect(css).toMatch(/--shadow-md:\s+0/);
  expect(css).toMatch(/--shadow-lg:\s+0/);
});

it("definiuje dostępny foreground dla akcji destrukcyjnych i redukcję ruchu", () => {
  expect(css).toContain("--color-destructive-foreground:");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});

it.each([":root", ".dark"] as const)(
  "motyw %s spełnia WCAG AA dla tekstu",
  (selector) => {
    const variables = getThemeVariables(selector);
    const pairs = [
      ["foreground", "background"],
      ["card-foreground", "card"],
      ["popover-foreground", "popover"],
      ["primary-foreground", "primary"],
      ["secondary-foreground", "secondary"],
      ["accent-foreground", "accent"],
      ["destructive-foreground", "destructive"],
      ["muted-foreground", "background"],
    ] as const;

    for (const [foregroundName, backgroundName] of pairs) {
      const foreground = variables.get(foregroundName);
      const background = variables.get(backgroundName);
      if (!foreground || !background) {
        throw new Error(`Brak pary ${foregroundName}/${backgroundName}`);
      }
      expect(
        contrastRatio(foreground, background),
        `${selector}: ${foregroundName}/${backgroundName}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  },
);
