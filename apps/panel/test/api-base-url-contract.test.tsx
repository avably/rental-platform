// @vitest-environment jsdom
/**
 * Kontrakt adresu bazowego publicznego API na ekranie /ustawienia-api
 * (M2, ADR-110 — dług z recenzji PM #212).
 *
 * Karta „Publiczne API rezerwacji" pokazywała adres bazowy Z sufiksem
 * `/api/v1/`, a pole wtyczki oczekuje bazy BEZ niego — operator kopiujący
 * adres z karty dostawał `/api/v1/api/v1/catalog` → 404 → mylącą diagnozę
 * klucza. Rozstrzygnięcie PM: karta pokazuje adres bazowy BEZ ścieżki
 * kontraktu i nazywa ją OSOBNO, a krok 3 instrukcji mówi o dokładnie tym
 * samym adresie z karty. Ten plik przypina obie strony umowy (EN+PL) oraz
 * spójność z sanitizerem wtyczki, który sufiks zdejmuje.
 */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { render, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { API_CONTRACT_PATH, apiBaseUrlForSlug } from "@/lib/wordpress/api-base-url";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

// Akcje serwerowe nie mają czego robić w jsdom — panel renderujemy dla treści.
vi.mock("@/app/[locale]/(panel)/ustawienia-api/api-keys-actions", () => ({
  generateApiKeyAction: async () => ({}),
  revokeApiKeyAction: async () => ({}),
}));

import { ApiKeysPanel } from "@/app/[locale]/(panel)/ustawienia-api/api-keys-panel";

const repositoryRoot = resolve(process.cwd(), "../..");

afterEach(cleanup);

function renderPanel(locale: "pl" | "en", apiBaseUrl: string) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "pl" ? pl : en}>
      <ApiKeysPanel
        apiKeys={[]}
        isOwner
        apiBaseUrl={apiBaseUrl}
        pluginDownloadHref={`/${locale}/ustawienia-api/wtyczka`}
        pluginFilename="avably-booking-0.1.0.zip"
        embedSnippet={null}
      embedPreviewUrl={null}
      pluginVersion="0.1.0"
      />
    </NextIntlClientProvider>,
  );
}

describe("adres bazowy publicznego API (/ustawienia-api)", () => {
  it("adres bazowy NIE niesie ścieżki kontraktu, a ścieżka odpowiada realnym trasom", () => {
    const base = apiBaseUrlForSlug("demo");
    expect(base.startsWith("https://")).toBe(true);
    expect(new URL(base).pathname).toBe("/");
    expect(base.endsWith("/")).toBe(false);

    // Ścieżka kontraktu nazywana osobno — i zgodna z katalogiem tras
    // publicznego API w storefroncie (nie jest literacką ozdobą).
    expect(API_CONTRACT_PATH).toBe("/api/v1/");
    expect(
      statSync(resolve(repositoryRoot, "apps/storefront/app/api/v1")).isDirectory(),
    ).toBe(true);
  });

  it("strona /ustawienia-api składa adres z helpera — bez doklejania ścieżki", () => {
    // Render panelu dostaje adres PROPEM, więc regresja w page.tsx (powrót
    // szablonu z `/api/v1/` doklejonym do hosta) nie zapaliłaby testów
    // renderu — pin idzie na źródło definicji.
    const source = readFileSync(
      resolve(process.cwd(), "app/[locale]/(panel)/ustawienia-api/page.tsx"),
      "utf8",
    );
    const definitions = source.split("\n").filter((line) => line.includes("apiBaseUrl ="));
    expect(definitions.length).toBeGreaterThan(0);
    for (const line of definitions) {
      expect(line).toContain("apiBaseUrlForSlug(");
      expect(line).not.toContain("api/v1");
    }
  });

  it("karta pokazuje adres bazowy BEZ sufiksu i osobno nazywa ścieżkę kontraktu (PL+EN)", () => {
    const base = apiBaseUrlForSlug("demo");
    for (const locale of ["pl", "en"] as const) {
      const { container } = renderPanel(locale, base);
      const intro = container.querySelector("[data-api-keys-intro]");
      expect(intro, `brak karty dla ${locale}`).not.toBeNull();

      // Adres w <code> to DOKŁADNIE baza — bez /api/v1/ na końcu.
      const codes = Array.from(intro!.querySelectorAll("code")).map((node) => node.textContent);
      expect(codes, `adres na karcie dla ${locale}`).toContain(base);
      for (const code of codes) {
        expect(code, `sufiks kontraktu w adresie dla ${locale}`).not.toMatch(/\/api\/v1\/?$/);
      }

      // Ścieżka kontraktu jest nazwana obok, jawnie.
      expect(intro!.textContent, `ścieżka kontraktu dla ${locale}`).toContain(API_CONTRACT_PATH);
      cleanup();
    }
  });

  it("krok 3 instrukcji mówi o adresie z karty — po nazwie karty (PL+EN)", () => {
    // Spójność treści: operator ma usłyszeć o TEJ SAMEJ karcie, którą widzi
    // wyżej — a nie o „jakimś adresie API". Rozjazd nazw = powrót ślepej
    // uliczki z 404.
    expect(pl.apiSettings.wordpress.step3Body).toContain(pl.apiSettings.introTitle);
    expect(en.apiSettings.wordpress.step3Body).toContain(en.apiSettings.introTitle);
  });

  it("sanitizer wtyczki zdejmuje dokładnie tę ścieżkę kontraktu (spójność obu stron)", () => {
    // Druga połowa umowy żyje w PHP: nawet gdy operator wklei adres z
    // sufiksem (stara instrukcja, cudzy tutorial), wtyczka go znormalizuje.
    // Pin na źródło — zniknięcie normalizacji pali ten test, nie klienta.
    const source = readFileSync(
      resolve(
        repositoryRoot,
        "integrations/wordpress/avably-booking/includes/class-avably-booking-settings.php",
      ),
      "utf8",
    );
    expect(source).toMatch(/function strip_contract_suffix\(/);
    expect(source).toMatch(/strip_contract_suffix\(\s*\$api_url\s*\)/);
    // Zdejmowany sufiks to ta sama ścieżka, którą nazywa karta.
    const suffix = API_CONTRACT_PATH.replace(/\/$/, "");
    expect(source).toContain(`${suffix}/?$`);
  });
});
