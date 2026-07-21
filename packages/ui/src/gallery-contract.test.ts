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
