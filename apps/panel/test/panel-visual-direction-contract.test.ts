import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const panelCss = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
const sharedCss = readFileSync(
  resolve(process.cwd(), "../../packages/ui/src/styles.css"),
  "utf8",
);
const deliveryStatusSources = [
  "app/[locale]/(panel)/zamowienia/[id]/contract-section.tsx",
  "app/[locale]/(panel)/zamowienia/[id]/email-log-section.tsx",
  "app/[locale]/(panel)/zamowienia/[id]/invoice-section.tsx",
].map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1];
  expect(body, `brak reguły ${selector}`).toBeDefined();
  return body!;
}

describe("kontrakt kierunku wizualnego panelu — ADR-177", () => {
  it("jasny motyw ma neutralne płótno, białe sekcje i osobny obrys pól", () => {
    const light = rule(panelCss, ":root:not(.dark)");

    expect(light).toContain("--background: #fafafa");
    expect(light).toContain("--foreground: #181b20");
    expect(light).toContain("--muted-foreground: #6f737a");
    expect(light).toContain("--card: #ffffff");
    expect(light).toContain("--border: #eceeeb");
    expect(light).toContain("--input: #8f958d");
    expect(light).toContain("--primary: #d7ff5f");
    expect(light).toContain("--primary-foreground: #151a12");
  });

  it("geometria panelu zamyka promienie w przedziale 3–6 px", () => {
    const geometry = rule(panelCss, ":root");

    expect(geometry).toContain("--radius-sm: 0.1875rem");
    expect(geometry).toContain("--radius-md: 0.25rem");
    expect(geometry).toContain("--radius-lg: 0.3125rem");
    expect(geometry).toContain("--radius-xl: 0.375rem");
  });

  it("zmiana jest odizolowana od współdzielonych tokenów storefrontu", () => {
    expect(panelCss).toContain("ADR-177");
    expect(sharedCss).not.toContain("ADR-177");
    expect(sharedCss).not.toContain(":root:not(.dark)");
    expect(sharedCss).not.toContain("--background: #fafafa");
  });

  it("limonka nie zastępuje semantycznych kolorów statusu wysyłki", () => {
    for (const source of deliveryStatusSources) {
      expect(source).toContain("StatusBadge");
      expect(source).toMatch(/secondaryStatusProps\s*\(\s*"email-log"/);
      expect(source).not.toContain('variant="default"');
      expect(source).not.toContain('? "default"');
      expect(source).not.toMatch(/\btone=/);
    }
  });

  it("pasek uruchomienia nie wnosi twardych hexów marki — kolory żyją w tokenach (ADR-257)", () => {
    const bar = readFileSync(
      resolve(process.cwd(), "components/shell/launch-guide-bar.tsx"),
      "utf8",
    );

    // Cała paleta paska przeniesiona do nazwanych tokenów `--launch-bar-*`.
    // Powrót któregokolwiek z tych literałów = powrót długu z noty ADR-229.
    const brandHexes = [
      "#d7ff5f",
      "#c7f542",
      "#151a12",
      "#e8f3d6",
      "#c8d6b6",
      "#15201c",
      "#0c1310",
      "#26382e",
      "#16241d",
    ];
    for (const hex of brandHexes) {
      expect(bar, `pasek uruchomienia zawiera twardy hex ${hex}`).not.toContain(
        hex,
      );
    }
    // Sieć ogólna: żaden 6-znakowy literał hex w komponencie.
    expect(bar).not.toMatch(/#[0-9a-fA-F]{6}\b/);
    // Kolory wskazują na tokeny paska.
    expect(bar).toContain("var(--launch-bar-accent)");

    // JEDNO źródło prawdy w globals.css — wartości 1:1 (parytet pikselowy).
    expect(panelCss).toContain("--launch-bar-fg: #e8f3d6");
    expect(panelCss).toContain("--launch-bar-muted: #c8d6b6");
    expect(panelCss).toContain("--launch-bar-accent: #d7ff5f");
    expect(panelCss).toContain("--launch-bar-accent-hover: #c7f542");
    expect(panelCss).toContain("--launch-bar-accent-foreground: #151a12");
    expect(panelCss).toContain("--launch-bar-bg: #15201c");
    expect(panelCss).toContain("--launch-bar-border: #26382e");
    // Wariant ciemny zachowuje dotychczasowe wartości strukturalne paska.
    expect(panelCss).toContain("--launch-bar-bg: #0c1310");
    expect(panelCss).toContain("--launch-bar-border: #16241d");
    // Dług i decyzja opisane pod numerem ADR-257.
    expect(panelCss).toContain("ADR-257");
  });
});
