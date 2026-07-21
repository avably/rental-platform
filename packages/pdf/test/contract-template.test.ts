import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

import { renderContractPdf, type ContractPdfProps } from "../src/index";

/**
 * Ekstrahuje tekst z wyrenderowanego PDF-a. To jest istota dowodu, że render
 * jest POPRAWNYM PDF-em: `getDocumentProxy` parsuje bajty i rzuca na
 * niepoprawnym wejściu (np. pustym buforze), a `extractText` czyta warstwę
 * tekstu — nigdzie nie polegamy na długości bufora.
 */
async function pdfToText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

// Wartości kwot są ROZŁĄCZNE, żeby asercja na jednej pozycji podsumowania nie
// przechodziła przypadkiem przez kolizję z inną kwotą w dokumencie.
const baseProps = {
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
  order: { number: "AV-2026-07-001", startDate: "20.07.2026", endDate: "23.07.2026", days: 3 },
  items: [
    { name: "Kamera Sony FX3", serialNumber: "SN-FX3-0001", rentalGrosze: 30000, depositGrosze: 100000 },
    { name: "Statyw Manfrotto 190", serialNumber: null, rentalGrosze: 15000, depositGrosze: 20000 },
  ],
  totals: { rentalGrosze: 45000, depositGrosze: 120000, deliveryGrosze: 1500, currency: "PLN" },
} satisfies Omit<ContractPdfProps, "locale" | "terms">;

const plProps: ContractPdfProps = {
  ...baseProps,
  locale: "pl",
  terms: {
    version: "1.0",
    body:
      "<p><b>§1.</b> Najemca zobowiązuje się zwrócić sprzęt w stanie niepogorszonym.</p>" +
      "<ul><li>Zakaz podnajmu sprzętu osobom trzecim.</li><li>Kaucja zwracana po weryfikacji zestawu.</li></ul>",
  },
};

const enProps: ContractPdfProps = {
  ...baseProps,
  locale: "en",
  order: { number: "AV-2026-07-001", startDate: "20 July 2026", endDate: "23 July 2026", days: 3 },
  terms: {
    version: "1.0",
    body:
      "<p><b>§1.</b> The Lessee shall return the equipment in undamaged condition.</p>" +
      "<ul><li>No subletting to third parties.</li><li>Deposit refunded after inspection.</li></ul>",
  },
};

describe("renderContractPdf", () => {
  // ── Dowód (c): wynik jest POPRAWNYM PDF-em, a test czyta jego ZAWARTOŚĆ.
  // Pusty bufor zwrócony przez render sprawi, że `pdfToText` rzuci przy
  // parsowaniu — ten test zapłonie, bo nie sprawdza długości, tylko treść.
  it("PL: zwraca poprawny, parsowalny PDF z treścią umowy", async () => {
    const bytes = await renderContractPdf(plProps);

    expect(bytes).toBeInstanceOf(Uint8Array);
    // Sygnatura pliku PDF — pierwsza linia obrony przed „to nie jest PDF".
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const text = await pdfToText(bytes);
    expect(text).toContain(plProps.order.number);
    expect(text).toContain(plProps.tenant.name);
    expect(text).toContain(plProps.customer.fullName);
    expect(text).toContain("Kamera Sony FX3");
    expect(text).toContain("UMOWA NAJMU");
  });

  it("EN: zwraca poprawny, parsowalny PDF z treścią umowy", async () => {
    const bytes = await renderContractPdf(enProps);

    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const text = await pdfToText(bytes);
    expect(text).toContain(enProps.order.number);
    expect(text).toContain(enProps.tenant.name);
    expect(text).toContain("RENTAL AGREEMENT");
    expect(text).not.toContain("UMOWA NAJMU");
  });

  // ── Dowód (a): snapshoty OBU locale. Zawierają pełną wyekstrahowaną treść,
  // w tym pozycje zamówienia — usunięcie pozycji z szablonu zmienia treść
  // i wywala oba snapshoty (umowa bez przedmiotu najmu nie jest umową).
  it("PL: snapshot wyrenderowanej treści", async () => {
    const text = await pdfToText(await renderContractPdf(plProps));
    expect(text).toMatchSnapshot();
  });

  it("EN: snapshot wyrenderowanej treści", async () => {
    const text = await pdfToText(await renderContractPdf(enProps));
    expect(text).toMatchSnapshot();
  });

  // ── Dowód (b): KONKRETNE asercje na trzech odrębnych kwotach podsumowania.
  // Podmiana `depositGrosze` → `rentalGrosze` w §4 sprawia, że kwota kaucji
  // (1200,00) znika z tekstu — ta asercja zapłonie, choć rental i delivery
  // wciąż się zgadzają.
  it("PL: kwoty podsumowania są odrębne i poprawnie sformatowane", async () => {
    const text = await pdfToText(await renderContractPdf(plProps));
    expect(text).toContain("450,00"); // opłata za najem (totals.rentalGrosze)
    expect(text).toContain("1200,00"); // kaucja zwrotna (totals.depositGrosze)
    expect(text).toContain("15,00"); // dostawa (totals.deliveryGrosze)
  });

  it("EN: kwoty formatowane kropką dziesiętną", async () => {
    const text = await pdfToText(await renderContractPdf(enProps));
    expect(text).toContain("450.00");
    expect(text).toContain("1200.00");
    expect(text).toContain("15.00");
    expect(text).not.toContain("1200,00");
  });

  // ── Determinizm: dwa przebiegi dają identyczną warstwę tekstu (brak
  // `new Date()`/`Math.random()` w renderze). Bajty mogą różnić się metadanymi.
  it("render jest deterministyczny w warstwie treści", async () => {
    const first = await pdfToText(await renderContractPdf(plProps));
    const second = await pdfToText(await renderContractPdf(plProps));
    expect(first).toBe(second);
  });
});
