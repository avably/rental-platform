import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  // ADR-053: panel jedzie w całości na Geist Sans (zero Geist Mono),
  // storefront zostaje na Interze — jeden stack --font-sans, dwie zmienne.
  it.each([
    ["panel", "Geist", 'variable: "--font-geist-sans"'],
    ["storefront", "Inter", 'variable: "--font-inter"'],
  ])(
    "%s importuje wspólny arkusz i ładuje %s",
    (application, family, variableDeclaration) => {
      const globals = readFileSync(
        resolve(repositoryRoot, `apps/${application}/app/globals.css`),
        "utf8",
      );
      const layout = readFileSync(
        resolve(repositoryRoot, `apps/${application}/app/[locale]/layout.tsx`),
        "utf8",
      );

      expect(globals).toContain('@import "@avably/ui/styles.css"');
      expect(layout).toContain(family);
      expect(layout).toContain(variableDeclaration);
    },
  );

  it("panel nie deklaruje Geist Mono ani Safiro", () => {
    const layout = readFileSync(
      resolve(repositoryRoot, "apps/panel/app/[locale]/layout.tsx"),
      "utf8",
    );
    expect(layout).not.toContain("Geist_Mono");
    expect(layout).not.toContain("Safiro");
  });
});
