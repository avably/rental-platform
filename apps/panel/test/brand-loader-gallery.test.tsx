import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const app = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(app, path), "utf8");

describe("dokumentacja i granice użycia BrandLoader", () => {
  it("galeria pokazuje pełny i kompaktowy wariant oraz regułę reduced motion", () => {
    const gallery = source("app/[locale]/design-system/page.tsx");

    expect(gallery).toContain('import { BrandLoader } from "@/components/shell/brand-loader"');
    expect(gallery).toContain('id="brand-loader"');
    expect(gallery).toContain('<BrandLoader label="Ładowanie panelu…" variant="full" showLabel />');
    expect(gallery).toContain(
      '<BrandLoader label="Przekierowujemy…" variant="compact" showLabel />',
    );
    expect(gallery).toContain("prefers-reduced-motion");
    expect(gallery).toContain("200 ms");
    expect(gallery).not.toContain("<LoadingRail");
  });

  it("prawdziwe empty states nie udają, że dane nadal się ładują", () => {
    const emptyStateFiles = [
      "app/[locale]/(panel)/zamowienia/orders-empty-state.tsx",
      "app/[locale]/(panel)/klienci/customers-empty-state.tsx",
      "app/[locale]/(panel)/katalog/catalog-empty-state.tsx",
    ];

    for (const file of emptyStateFiles) {
      const emptyState = source(file);
      expect(emptyState, file).toContain('data-screen="empty"');
      expect(emptyState, file).not.toContain("BrandLoader");
      expect(emptyState, file).not.toContain("LoadingRail");
    }
  });
});
