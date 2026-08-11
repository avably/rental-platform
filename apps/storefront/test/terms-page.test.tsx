/**
 * Strona regulaminu platformy na osi marketingowej (0070, ADR-141) —
 * treść z BAZY (app.get_platform_terms), nie z messages (D6).
 *
 * Trzy kontrakty:
 *   1. RENDER: wersja/etykieta, data wejścia w życie, skrót sha256 i stały
 *      adres wersji są CZĘŚCIĄ dokumentu; EN niesie notę o wiążącej wersji
 *      polskiej (§15 ust. 3), PL nie dubluje jej bez potrzeby.
 *   2. TEKST ZOSTAJE TEKSTEM: treść przychodzi z bazy, ale do HTML wchodzi
 *      wyłącznie przez Reacta — znaczniki w body są ESCAPOWANE, zero
 *      `dangerouslySetInnerHTML` (wzorzec legal-document-view).
 *   3. WARSTWA ODCZYTU jest fail-closed: błąd, brak wiersza i zły kształt
 *      dają null (strona odpowiada 404, nie połową dokumentu); numer wersji
 *      poza zakresem liczb naturalnych nie dotyka bazy.
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TermsContent } from "@/components/marketing/terms-content";
import {
  getPlatformTerms,
  getPlatformTermsVersion,
  type PlatformTermsVersionDocument,
} from "@/lib/legal/platform-terms";
import en from "@/messages/en.json";
import pl from "@/messages/pl.json";

const DOCUMENT: PlatformTermsVersionDocument = {
  version_id: "11111111-1111-4111-8111-111111111111",
  version_no: 1,
  version_label: "v1",
  title_pl: "Regulamin świadczenia usługi Avably",
  body_pl: "Pierwszy akapit PL.\n\nDrugi akapit <script>alert(1)</script> PL.",
  title_en: "Avably Terms of Service",
  body_en: "First paragraph EN.\n\nSecond paragraph EN.",
  sha256_pl: "0123456789abcdef".repeat(4),
  sha256_en: "fedcba9876543210".repeat(4),
  published_at: "2026-08-11T10:00:00.000Z",
  effective_from: "2026-09-01T00:00:00.000Z",
  current: true,
};

function render(document: PlatformTermsVersionDocument, locale: "pl" | "en"): string {
  const messages = locale === "pl" ? pl : en;
  return renderToStaticMarkup(
    <TermsContent document={document} copy={messages.terms} locale={locale} />,
  );
}

describe("TermsContent — render dokumentu z bazy", () => {
  it("PL: tytuł, akapity, etykieta wersji, data, skrót sha256 i stały adres wersji", () => {
    const html = render(DOCUMENT, "pl");

    expect(html).toContain("Regulamin świadczenia usługi Avably");
    expect(html).toContain("Pierwszy akapit PL.");
    expect(html).toContain('data-platform-terms="v1"');
    expect(html).toContain("Wersja:");
    expect(html).toContain("1 września 2026");
    expect(html).toContain(DOCUMENT.sha256_pl.slice(0, 16));
    expect(html).toContain("/pl/terms/w/1");
  });

  it("EN: treść angielska + nota o wiążącej wersji polskiej; PL bez tej noty", () => {
    const htmlEn = render(DOCUMENT, "en");
    expect(htmlEn).toContain("Avably Terms of Service");
    expect(htmlEn).toContain("First paragraph EN.");
    expect(htmlEn).toContain(en.terms.bindingNote);
    expect(htmlEn).toContain(DOCUMENT.sha256_en.slice(0, 16));

    const htmlPl = render(DOCUMENT, "pl");
    expect(htmlPl).not.toContain(en.terms.bindingNote);
  });

  it("wersja archiwalna niesie notę i link do wersji obowiązującej; żywa nie", () => {
    const archived = render({ ...DOCUMENT, current: false }, "pl");
    expect(archived).toContain(pl.terms.archivedNote);
    expect(archived).toContain('href="/pl/terms"');

    const current = render(DOCUMENT, "pl");
    expect(current).not.toContain(pl.terms.archivedNote);
  });

  it("treść z bazy zostaje TEKSTEM: znaczniki są escapowane, komponent nie zna dangerouslySetInnerHTML", () => {
    const html = render(DOCUMENT, "pl");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");

    // UŻYCIE atrybutu, nie samo słowo — nagłówek komponentu wymienia je
    // w zdaniu „zero dangerouslySetInnerHTML" i to jest legalne; bramka ma
    // łapać powrót mechanizmu, a dowodem behawioralnym jest escaping wyżej.
    const source = readFileSync(
      new URL("../components/marketing/terms-content.tsx", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("dangerouslySetInnerHTML=");
  });
});

describe("warstwa odczytu platform-terms — fail-closed", () => {
  const errorClient = {
    schema: () => ({ rpc: async () => ({ data: null, error: { message: "boom" } }) }),
  } as never;
  const malformedClient = {
    schema: () => ({ rpc: async () => ({ data: { version_id: "nie-uuid" }, error: null }) }),
  } as never;
  const throwingClient = {
    schema: () => ({
      rpc: async () => {
        throw new Error("nie wolno dotykać bazy");
      },
    }),
  } as never;

  it("błąd transportu i zły kształt dają null (404, nie pół dokumentu)", async () => {
    expect(await getPlatformTerms(errorClient)).toBeNull();
    expect(await getPlatformTerms(malformedClient)).toBeNull();
    expect(await getPlatformTermsVersion(1, errorClient)).toBeNull();
    expect(await getPlatformTermsVersion(1, malformedClient)).toBeNull();
  });

  it("numer wersji poza zakresem liczb naturalnych ≥ 1 nie dotyka bazy (v0-szkic odcięty także tutaj)", async () => {
    expect(await getPlatformTermsVersion(0, throwingClient)).toBeNull();
    expect(await getPlatformTermsVersion(-3, throwingClient)).toBeNull();
    expect(await getPlatformTermsVersion(1.5, throwingClient)).toBeNull();
    expect(await getPlatformTermsVersion(Number.NaN, throwingClient)).toBeNull();
  });
});
