import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

const storefrontRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(storefrontRoot, "../..");
const publicImages = path.join(storefrontRoot, "public/forerunner/images");

function read(relative: string): Buffer {
  return readFileSync(path.join(repoRoot, relative));
}

function pngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function icoSizes(buffer: Buffer): Array<[number, number]> {
  expect(buffer.readUInt16LE(0)).toBe(0);
  expect(buffer.readUInt16LE(2)).toBe(1);
  const count = buffer.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return [buffer[offset] || 256, buffer[offset + 1] || 256];
  });
}

describe("platformowe zasoby marki Avably", () => {
  it("generator marketingu eksportuje kanoniczną kapsułę i favicon dot-only", async () => {
    const modulePath = path.join(storefrontRoot, "scripts/brand-assets.mjs");
    expect(existsSync(modulePath), "brak jednego źródła znaków dla generatora LP").toBe(true);
    if (!existsSync(modulePath)) return;

    const brandModule = await import(pathToFileURL(modulePath).href) as {
      BRAND_FILES: Record<string, string>;
      FULL_LOGO_SVG: string;
      FAVICON_SVG: string;
    };
    const { BRAND_FILES, FULL_LOGO_SVG, FAVICON_SVG } = brandModule;

    expect(BRAND_FILES["avably-logo-dark.svg"]).toBe(FULL_LOGO_SVG);
    expect(BRAND_FILES["avably-logo-light.svg"]).toBe(FULL_LOGO_SVG);
    expect(BRAND_FILES["avably-favicon.svg"]).toBe(FAVICON_SVG);
    expect(FULL_LOGO_SVG).toContain('<rect width="348" height="93" rx="44" fill="#EAFFA4"/>');
    expect(FULL_LOGO_SVG.match(/<path\b/g)).toHaveLength(6);
    expect(FAVICON_SVG).toContain('<rect width="32" height="32" rx="7" fill="#0B1017"/>');
    expect(FAVICON_SVG).toContain('<circle cx="16" cy="16" r="8" fill="#A8C743"/>');
    expect(FAVICON_SVG).not.toContain("<path");
  });

  it("stabilne publiczne adresy LP zawierają dokładnie pliki generatora", async () => {
    const modulePath = path.join(storefrontRoot, "scripts/brand-assets.mjs");
    expect(existsSync(modulePath), "brak jednego źródła znaków dla generatora LP").toBe(true);
    if (!existsSync(modulePath)) return;
    const { BRAND_FILES } = await import(pathToFileURL(modulePath).href) as {
      BRAND_FILES: Record<string, string>;
    };

    for (const [name, expected] of Object.entries(BRAND_FILES)) {
      expect(readFileSync(path.join(publicImages, name), "utf8"), name).toBe(expected);
    }
  });

  it("pełne logo LP zachowuje proporcje kapsuły i minimalną szerokość", () => {
    const css = readFileSync(
      path.join(storefrontRoot, "public/forerunner/css/avably-marketing.css"),
      "utf8",
    );
    const marker = css.indexOf("AVABLY BRAND: proporcje pełnego logo");
    expect(marker, "brak trwałej delty rozmiaru pełnego logo").toBeGreaterThanOrEqual(0);
    const brandSizing = css.slice(marker);

    expect(brandSizing.replace(/\s+/g, " ")).toMatch(
      /\.nav-brand\s*\{[^}]*width:\s*120px/,
    );
    expect(brandSizing.replace(/\s+/g, " ")).toMatch(
      /\.footer-icon\s*\{[^}]*width:\s*120px[^}]*height:\s*auto/,
    );
  });

  it("panel i storefront mają identyczne wielorozmiarowe favicony", () => {
    const panel = read("apps/panel/app/favicon.ico");
    const storefront = read("apps/storefront/app/favicon.ico");

    expect(panel.equals(storefront)).toBe(true);
    expect(icoSizes(panel)).toEqual([
      [16, 16],
      [24, 24],
      [32, 32],
      [48, 48],
    ]);
  });

  it("obie aplikacje mają identyczne ikony Next i Apple z właściwymi wymiarami", () => {
    const paths = [
      "apps/panel/app/icon.png",
      "apps/panel/app/apple-icon.png",
      "apps/storefront/app/icon.png",
      "apps/storefront/app/apple-icon.png",
    ];
    for (const relative of paths) {
      expect(existsSync(path.join(repoRoot, relative)), `brak ${relative}`).toBe(true);
    }
    if (paths.some((relative) => !existsSync(path.join(repoRoot, relative)))) return;

    const panelIcon = read(paths[0]!);
    const panelApple = read(paths[1]!);
    const storefrontIcon = read(paths[2]!);
    const storefrontApple = read(paths[3]!);
    expect(pngSize(panelIcon)).toEqual({ width: 512, height: 512 });
    expect(pngSize(panelApple)).toEqual({ width: 180, height: 180 });
    expect(panelIcon.equals(storefrontIcon)).toBe(true);
    expect(panelApple.equals(storefrontApple)).toBe(true);
  });
});
