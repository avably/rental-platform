import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandLoader } from "@/components/shell/brand-loader";
import { BrandLogo } from "@/components/shell/brand-mark";

function pathsOf(html: string): string[] {
  return [...html.matchAll(/<path[^>]*d="([^"]+)"[^>]*>/g)].map((match) => match[1]!);
}

describe("BrandLoader", () => {
  it("pełny wariant współdzieli zamrożone krzywe logo i ma jeden status", () => {
    const loader = renderToStaticMarkup(
      <BrandLoader label="Ładowanie zamówień…" variant="full" showLabel />,
    );
    const logo = renderToStaticMarkup(<BrandLogo />);

    expect(loader).toContain('data-brand-loader-variant="full"');
    expect(loader).toContain('viewBox="0 0 348 93"');
    expect(loader).toContain("data-brand-loader-capsule");
    expect(loader).toContain("data-brand-loader-dot-position");
    expect(loader).toContain("data-brand-loader-wordmark");
    expect(loader.match(/data-brand-loader-letter=/g)).toHaveLength(6);
    expect(pathsOf(loader)).toEqual(pathsOf(logo));
    expect(loader.match(/role="status"/g)).toHaveLength(1);
    expect(loader.match(/Ładowanie zamówień…/g)).toHaveLength(1);
  });

  it("kompaktowy wariant zostaje kołem z kropką bez wordmarku", () => {
    const loader = renderToStaticMarkup(
      <BrandLoader label="Przekierowanie…" variant="compact" />,
    );

    expect(loader).toContain('data-brand-loader-variant="compact"');
    expect(loader).toContain('viewBox="0 0 93 93"');
    expect(loader).toContain("data-brand-loader-compact-circle");
    expect(loader).toContain("data-brand-loader-dot");
    expect(loader).not.toContain("data-brand-loader-wordmark");
    expect(loader).not.toContain("<path");
    expect(loader.match(/role="status"/g)).toHaveLength(1);
    expect(loader).toContain("sr-only");
  });

  it("CSS ma próg 200 ms, jednorazowe intro i jedną markową pętlę kropki", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");

    expect(css).toMatch(/\[data-brand-loader\][^{]*\{[^}]*brand-loader-reveal[^;]*200ms[^;]*both/s);
    expect(css).toMatch(/brand-loader-capsule-intro 2200ms[^;]*200ms[^;]*both/);
    expect(css).toMatch(/brand-loader-dot-breathe 3600ms[^;]*2400ms[^;]*infinite/);
    expect(css).toContain("@media (prefers-reduced-motion: no-preference)");

    const brandLoops = [...css.matchAll(/animation:[^;]*brand-loader[^;]*infinite/g)];
    expect(brandLoops).toHaveLength(1);
  });
});
