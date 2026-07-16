import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

describe("landing visual system", () => {
  it("keeps the replaceable serif in one module", () => {
    const fonts = read("app/fonts.ts");
    const layout = read("app/[locale]/layout.tsx");
    const components = [
      read("components/landing-page.tsx"),
      read("components/landing-wireframes.tsx"),
    ].join("\n");

    expect(fonts).toContain("Lora");
    expect(fonts).toContain('variable: "--font-serif-source"');
    expect(fonts).toContain('subsets: ["latin-ext"]');
    expect(layout).toContain("fontVariables");
    expect(components).not.toMatch(/Lora|Source Serif|Fraunces/);
  });

  it("defines centralized landing typography and reduced-motion rules", () => {
    const css = read("app/globals.css");
    const form = read("components/waitlist-form.tsx");
    const themeToggle = read("components/theme-toggle.tsx");
    const languageSwitcher = read("components/language-switcher.tsx");
    expect(css).toContain("--font-serif: var(--font-serif-source)");
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
    expect(css).not.toMatch(/(?:linear|radial|conic)-gradient/);
    expect(form.match(/landing-pill/g)?.length).toBeGreaterThanOrEqual(2);
    expect(themeToggle).toContain("landing-ghost-pill");
    expect(languageSwitcher).toContain("landing-ghost-pill");
  });
});
