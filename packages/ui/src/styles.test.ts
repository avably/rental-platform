import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

const stylesPath = resolve(process.cwd(), "src/styles.css");

it("udostępnia arkusz design systemu", () => {
  expect(existsSync(stylesPath)).toBe(true);
});

it("zawiera kanoniczne motywy bez starszego wyjątku backoffice", () => {
  const css = readFileSync(stylesPath, "utf8");

  expect(css).toContain(":root {");
  expect(css).toContain(".dark {");
  expect(css).not.toContain("office-light");
  expect(css).toContain("--background: oklch(1 0 0)");
  expect(css).toContain("--background: oklch(0.13 0.028 261.692)");
});

it("utrzymuje zatwierdzony radius i typografię", () => {
  const css = readFileSync(stylesPath, "utf8");

  expect(css).toContain("--radius: 0.625rem");
  expect(css).toContain("--font-sans: var(--font-inter)");
  expect(css).toMatch(/--font-mono:\s+var\(--font-geist-mono\)/);
});

it("rozdziela płaskie powierzchnie od nakładek", () => {
  const css = readFileSync(stylesPath, "utf8");

  expect(css).toContain("--shadow-xs: none");
  expect(css).toContain("--shadow-sm: none");
  expect(css).toMatch(/--shadow-md:\s+0/);
  expect(css).toMatch(/--shadow-lg:\s+0/);
});

it("definiuje dostępny foreground dla akcji destrukcyjnych i redukcję ruchu", () => {
  const css = readFileSync(stylesPath, "utf8");

  expect(css).toContain("--color-destructive-foreground:");
  expect(css).toContain("@media (prefers-reduced-motion: reduce)");
});
