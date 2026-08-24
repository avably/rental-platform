import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) =>
    key === "loading" ? "Ładowanie panelu…" : key,
}));

describe("ogólna granica ładowania panelu", () => {
  it("pokazuje pełny loader z jednym przetłumaczonym statusem", async () => {
    const { default: PanelLoading } = await import("@/app/[locale]/(panel)/loading");
    const html = renderToStaticMarkup(await PanelLoading());

    expect(html).toContain("data-panel-route-loading");
    expect(html).toContain('data-brand-loader-variant="full"');
    expect(html.match(/role="status"/g)).toHaveLength(1);
    expect(html.match(/Ładowanie panelu…/g)).toHaveLength(1);
    expect(html).not.toContain('data-slot="loading-rail"');
  });
});
