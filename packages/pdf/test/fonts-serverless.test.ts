import { Font } from "@react-pdf/renderer";
import { describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { registerFonts } from "../src/fonts";
import { renderContractPdf, type ContractPdfProps } from "../src/index";

/**
 * DOWÓD ŚRODOWISKO-NIEZALEŻNY (ADR-220): render umowy nie zależy od odczytu
 * `.ttf` z dysku, więc nie może zregresować na serverless (Vercel), gdzie
 * pliki czcionek nie trafiały do bundla funkcji (`ENOENT Roboto-Regular.ttf`).
 *
 * Ten plik biegnie w izolowanym module vitest, więc `registered` w `fonts.ts`
 * startuje jako `false`: spy na `Font.register` łapie PIERWSZE (jedyne)
 * wywołanie rejestracji rodziny.
 */

async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// „Wypożyczalnia Północ" niesie glify ż/ó spoza WinAnsi — ich obecność w
// wyekstrahowanym tekście dowodzi, że render użył osadzonego fontu Roboto,
// a nie wbudowanej Helvetiki.
const plProps: ContractPdfProps = {
  tenant: {
    name: "Wypożyczalnia Północ",
    address: "ul. Portowa 4, 70-001 Szczecin",
    nip: "8522334455",
    email: "kontakt@polnoc.example",
  },
  customer: {
    fullName: "Anna Kowalska",
    address: "ul. Morska 12/3, 70-002 Szczecin",
    email: "anna.kowalska@example.com",
  },
  order: { number: "AV-2026-08-777", startDate: "20.08.2026", endDate: "23.08.2026", days: 3 },
  items: [{ name: "Kamera Sony FX3", serialNumber: "SN-FX3-0001", rentalGrosze: 30000, depositGrosze: 100000 }],
  totals: { rentalGrosze: 30000, depositGrosze: 100000, deliveryGrosze: 1500, currency: "PLN" },
  locale: "pl",
  terms: { version: "1.0", body: "<p>§1. Najemca zwraca sprzęt w stanie niepogorszonym.</p>" },
};

describe("registerFonts — czcionki jako data-URI (ADR-220)", () => {
  it("rejestruje rodzinę Roboto WYŁĄCZNIE przez data-URI — żaden src nie jest ścieżką pliku", () => {
    const registerSpy = vi.spyOn(Font, "register");

    registerFonts();

    expect(registerSpy).toHaveBeenCalledTimes(1);
    const [firstCall] = registerSpy.mock.calls;
    if (!firstCall) throw new Error("Font.register nie zostało wywołane");
    const arg = firstCall[0] as { family: string; fonts: Array<{ src: unknown }> };
    expect(arg.family).toBe("Roboto");
    expect(arg.fonts).toHaveLength(3);

    for (const font of arg.fonts) {
      expect(typeof font.src).toBe("string");
      const src = font.src as string;
      // Sedno naprawy: `@react-pdf/font` dla takiego `src` idzie gałęzią
      // `isDataUrl` → `fontkit.create` (base64), a NIE `fontkit.open` (fs).
      expect(src).toMatch(/^data:font\/ttf;base64,[A-Za-z0-9+/]+=*$/);
      // Kontrola negatywna: żadnej ścieżki do pliku na dysku.
      expect(src).not.toContain(".ttf");
      expect(src).not.toContain("assets");
      expect(src.startsWith("/")).toBe(false);
    }

    registerSpy.mockRestore();
  });

  it("renderuje umowę do poprawnego, parsowalnego PDF-a z polskimi glifami (bez fs)", async () => {
    const bytes = await renderContractPdf(plProps);

    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const text = await pdfToText(bytes);
    // Parsowalność + obecność glifów ż/ó dowodzi zdekodowania fontu z data-URI.
    expect(text).toContain("Wypożyczalnia Północ");
    expect(text).toContain(plProps.order.number);
  });
});
