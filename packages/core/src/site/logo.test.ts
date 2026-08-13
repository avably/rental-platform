import { describe, expect, it } from "vitest";

import { parsePublishedSite } from "./index";
import {
  MAX_SITE_LOGO_BYTES,
  parseSiteLogo,
  siteLogoAlt,
  siteLogoSchema,
  type SiteLogo,
} from "./logo";

/**
 * KSZTAŁT ZNAKU FIRMY (ADR-160) — jedyne źródło prawdy o tym, co wolno zapisać
 * w `tenants.logo_draft/logo_published`, i o tym, jak koperta sklepu znosi jego
 * brak.
 */
const TENANT = "11111111-1111-4111-8111-111111111111";
const UPLOAD = "22222222-2222-4222-8222-222222222222";
const PATH = `${TENANT}/logo/${UPLOAD}.png`;

function envelope(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    template: "classic",
    published_at: "2026-08-13T10:00:00Z",
    sections: [],
    ...extra,
  };
}

describe("siteLogoSchema", () => {
  it("przyjmuje ścieżkę {tenant}/logo/{upload}.{ext} i domyślnie stawia znak w stopce", () => {
    const parsed = siteLogoSchema.parse({ path: PATH });
    expect(parsed).toEqual({ path: PATH, inFooter: true });
  });

  it("odrzuca ścieżkę spoza katalogu `logo`, wyjście w górę i goły URL", () => {
    for (const path of [
      `${TENANT}/${UPLOAD}/${UPLOAD}.png`,
      `${TENANT}/logo/../${UPLOAD}.png`,
      `https://example.test/${UPLOAD}.png`,
      `${TENANT}/logo/${UPLOAD}.svg`,
      `${TENANT}/logo/${UPLOAD}`,
    ]) {
      expect(siteLogoSchema.safeParse({ path }).success, `przyjęta ścieżka: ${path}`).toBe(false);
    }
  });

  it("odrzuca nieznany klucz — literówka w nazwie pola nie ma ginąć do renderu", () => {
    expect(siteLogoSchema.safeParse({ path: PATH, footer: true }).success).toBe(false);
  });

  it("tnie tekst zastępczy na 120 znakach", () => {
    expect(siteLogoSchema.safeParse({ path: PATH, alt: "x".repeat(120) }).success).toBe(true);
    expect(siteLogoSchema.safeParse({ path: PATH, alt: "x".repeat(121) }).success).toBe(false);
    expect(siteLogoSchema.safeParse({ path: PATH, alt: "   " }).success).toBe(false);
  });

  it("sufit rozmiaru jest lustrem bazy: 512 KiB", () => {
    expect(MAX_SITE_LOGO_BYTES).toBe(524_288);
  });
});

describe("parseSiteLogo", () => {
  it("brak znaku to `null` — pusty obiekt, null i undefined znaczą to samo", () => {
    expect(parseSiteLogo({})).toBeNull();
    expect(parseSiteLogo(null)).toBeNull();
    expect(parseSiteLogo(undefined)).toBeNull();
  });

  it("kształt nierozpoznany degraduje się do braku znaku, a nie do wyjątku", () => {
    expect(parseSiteLogo({ path: 42 })).toBeNull();
    expect(parseSiteLogo("logo.png")).toBeNull();
  });
});

describe("siteLogoAlt", () => {
  it("bierze tekst najemcy, a bez niego nazwę sklepu — nigdy pustego napisu", () => {
    const withAlt = { path: PATH, alt: "Wypożyczalnia Nadmorska", inFooter: true } as SiteLogo;
    const without = { path: PATH, inFooter: true } as SiteLogo;
    expect(siteLogoAlt(withAlt, "Sklep")).toBe("Wypożyczalnia Nadmorska");
    expect(siteLogoAlt(without, "Sklep")).toBe("Sklep");
    expect(siteLogoAlt(without, "   ")).not.toBe("");
  });
});

describe("koperta opublikowanej strony", () => {
  it("OKNO WDROŻENIOWE: koperta bez klucza `logo` parsuje się i daje brak znaku", () => {
    const parsed = parsePublishedSite(envelope());
    expect(parsed).not.toBeNull();
    expect(parsed!.logo).toBeNull();
  });

  it("koperta ze znakiem oddaje go w kształcie po walidacji", () => {
    const parsed = parsePublishedSite(envelope({ logo: { path: PATH, alt: "Znak" } }));
    expect(parsed!.logo).toEqual({ path: PATH, alt: "Znak", inFooter: true });
  });

  it("znak w kształcie sprzed zmiany schematu NIE kładzie całej strony", () => {
    // Fail-SOFT, inaczej niż koperta (fail-closed): „sklep bez znaku" jest
    // stanem normalnym, więc degradacja jest tu właściwą odpowiedzią.
    const parsed = parsePublishedSite(envelope({ logo: { imagePath: PATH } }));
    expect(parsed).not.toBeNull();
    expect(parsed!.logo).toBeNull();
  });

  it("nieznany klucz koperty dalej wywraca ją w całości (kontrola pozytywna)", () => {
    // Bez tego przypadku „koperta jest .strict()" byłoby przekonaniem, a nie
    // faktem — a to na nim stoi warunek okna wdrożeniowego dla klucza `logo`.
    expect(parsePublishedSite(envelope({ znak: { path: PATH } }))).toBeNull();
  });
});
