import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("landing visual system", () => {
  // ADR-053 (delta P1a): sklep w całości w Geist Sans — sekcja 08 artefaktu
  // Fazy 2 zakazuje w produkcie innych rodzin (sans, mono, serif włącznie).
  it("ładuje wyłącznie Geist Sans przez jeden moduł fontów", () => {
    const fonts = read("app/fonts.ts");
    const layout = read("app/[locale]/layout.tsx");
    const components = [
      read("components/landing-page.tsx"),
      read("components/landing-wireframes.tsx"),
    ].join("\n");

    expect(fonts).toContain('variable: "--font-geist-sans"');
    expect(fonts).toContain('subsets: ["latin", "latin-ext"]');
    expect(fonts).not.toMatch(/Geist_Mono|Lora|Safiro|\bInter\b/);
    expect(layout).toContain("fontVariables");
    expect(components).not.toMatch(/Lora|Source Serif|Fraunces/);
  });

  it("defines centralized landing typography and reduced-motion rules", () => {
    const css = read("app/globals.css");
    const form = read("components/waitlist-form.tsx");
    const themeToggle = read("components/theme-toggle.tsx");
    const languageSwitcher = read("components/language-switcher.tsx");
    expect(css).not.toMatch(/--font-(?:sans|mono|serif):/);
    expect(css).toContain(".landing-display");
    expect(css).toContain(".landing-heading");
    expect(css).toContain(".landing-statement");
    expect(css).toContain(".landing-hero");
    expect(css).toContain(".landing-dark-section");
    expect(css).toContain(".landing-pill");
    expect(css).toContain(".landing-ghost-pill");
    expect(css).toContain("animation-timeline: view()");
    expect(css).toContain("prefers-reduced-motion: no-preference");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
    expect(css).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*scroll-behavior: auto/,
    );
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/);
    expect(form.match(/landing-pill/g)?.length).toBeGreaterThanOrEqual(2);
    expect(form).toContain("resultFocusArmedRef.current = true");
    expect(form).toContain("if (!resultFocusArmedRef.current");
    expect(themeToggle).toContain("landing-ghost-pill");
    expect(languageSwitcher).toContain("landing-ghost-pill");
  });
});
