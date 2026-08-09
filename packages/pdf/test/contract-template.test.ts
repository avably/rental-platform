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

/**
 * Sekcja pól własnych (C6-A2, ADR-119).
 *
 * Ekstrakcja tekstu z PDF-a rozbija wiersze i wstawia spacje między fragmenty
 * układu, więc asercje na dłuższych ciągach idą po tekście ZNORMALIZOWANYM
 * (ciąg białych znaków → jedna spacja). Bez tego test przechodziłby albo padał
 * zależnie od tego, gdzie akurat złamał się wiersz — czyli mierzyłby układ,
 * a nie treść.
 */
function normalize(text: string): string {
  return text.replace(/\s+/g, " ");
}

describe("pola własne na umowie", () => {
  const withFields: ContractPdfProps = {
    ...plProps,
    customFields: {
      customer: [
        { label: "Numer uprawnień", value: "UP/2026/8841" },
        { label: "Zgoda marketingowa", value: "Nie" },
      ],
      order: [{ label: "Stan licznika", value: "12 480,5" }],
    },
  };

  it("drukuje pary etykieta→wartość w sekcji dodatkowej", async () => {
    const text = normalize(await pdfToText(await renderContractPdf(withFields)));
    expect(text).toContain("DANE DODATKOWE");
    expect(text).toContain("Numer uprawnień");
    expect(text).toContain("UP/2026/8841");
    expect(text).toContain("Stan licznika");
    expect(text).toContain("12 480,5");
  });

  it("„Nie” jest ODPOWIEDZIĄ i musi być widoczne, nie pominięte jako pustka", async () => {
    const text = normalize(await pdfToText(await renderContractPdf(withFields)));
    expect(text).toContain("Zgoda marketingowa");
  });

  it("EN: nagłówki sekcji po angielsku", async () => {
    const text = normalize(
      await pdfToText(
        await renderContractPdf({
          ...enProps,
          customFields: { order: [{ label: "Odometer", value: "12,480.5" }] },
        }),
      ),
    );
    expect(text).toContain("ADDITIONAL DETAILS");
    expect(text).toContain("ORDER");
    expect(text).not.toContain("DANE DODATKOWE");
  });

  // ── DRUGA STRONA KONTRAKTU WIDOCZNOŚCI, przypięta tu, a nie tylko w panelu:
  // brak pól = brak sekcji, i numeracja paragrafów tego nie zauważa.
  it("bez pól nie ma ani sekcji, ani przesunięcia numeracji", async () => {
    const text = normalize(await pdfToText(await renderContractPdf(plProps)));
    expect(text).not.toContain("DANE DODATKOWE");
    expect(text).toContain("§5 REGULAMIN NAJMU");
    expect(text).not.toContain("§6");
  });

  it("puste listy są tym samym co brak pól (zero pustych sekcji)", async () => {
    const text = normalize(
      await pdfToText(await renderContractPdf({ ...plProps, customFields: { customer: [], order: [] } })),
    );
    expect(text).not.toContain("DANE DODATKOWE");
    expect(text).toContain("§5 REGULAMIN NAJMU");
  });

  it("z polami regulamin przesuwa się na §6, a §5 to dane dodatkowe", async () => {
    const text = normalize(await pdfToText(await renderContractPdf(withFields)));
    expect(text).toContain("§5 DANE DODATKOWE");
    expect(text).toContain("§6 REGULAMIN NAJMU");
  });

  it("pola produktu drukują się pod pozycją, której dotyczą", async () => {
    const text = normalize(
      await pdfToText(
        await renderContractPdf({
          ...plProps,
          items: [
            { ...plProps.items[0]!, customFields: [{ label: "Stan licznika", value: "988" }] },
            plProps.items[1]!,
          ],
        }),
      ),
    );
    expect(text).toContain("Kamera Sony FX3");
    expect(text).toContain("Stan licznika");
    expect(text).toContain("988");
    // Pozycja bez pól własnych nie dostaje pustego wiersza z etykietą.
    expect(text.match(/Stan licznika/g)).toHaveLength(1);
  });

  // ── WEKTOR WROGI. Wartość pola własnego wpisuje operator (a przy polach
  // checkoutowych — klient końcowy) i ląduje w dokumencie najemcy. Test pyta
  // o jedno: czy treść zostaje TREŚCIĄ.
  it("treść wyglądająca na znaczniki HTML zostaje tekstem, nie jest parsowana", async () => {
    const hostile = "<b>WYTŁUSZCZONE</b><script>alert(1)</script>";
    const text = normalize(
      await pdfToText(
        await renderContractPdf({
          ...plProps,
          customFields: { order: [{ label: "Uwagi", value: hostile }] },
        }),
      ),
    );
    // Znaczniki są WIDOCZNE — czyli nie zostały zinterpretowane. Gdyby
    // wartość poszła przez `HtmlContent` (drogę regulaminu), zobaczylibyśmy
    // samo „WYTŁUSZCZONE", a `<script>` zniknąłby bez śladu.
    expect(text).toContain("<b>WYTŁUSZCZONE</b>");
    expect(text).toContain("<script>alert(1)</script>");
  });

  it("treść wyglądająca na składnię PDF nie rozbija dokumentu", async () => {
    // Klasyczna próba wyjścia ze stringa strumienia treści PDF-a: domknięcie
    // nawiasu, własny operator tekstu, zmiana fontu. Jeżeli generator nie
    // escape'uje nawiasów, plik przestaje być parsowalnym PDF-em — i wtedy
    // `pdfToText` rzuci, zamiast oddać tekst.
    const hostile = ") Tj ET Q q BT /F1 40 Tf (WSTRZYKNIETE) Tj (";
    const bytes = await renderContractPdf({
      ...plProps,
      customFields: { customer: [{ label: "Uwaga \\(nawias\\)", value: hostile }] },
    });
    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");

    const text = normalize(await pdfToText(bytes));
    // Wartość jest w dokumencie DOSŁOWNIE, a reszta umowy nietknięta.
    expect(text).toContain(") Tj ET Q q BT /F1 40 Tf (WSTRZYKNIETE) Tj (");
    expect(text).toContain("UMOWA NAJMU");
    expect(text).toContain("§6 REGULAMIN NAJMU");
  });

  it("etykieta pola też jest treścią — bierze się od najemcy, nie z kodu", async () => {
    const text = normalize(
      await pdfToText(
        await renderContractPdf({
          ...plProps,
          customFields: { order: [{ label: "<i>Etykieta</i>", value: "wartość" }] },
        }),
      ),
    );
    expect(text).toContain("<i>Etykieta</i>");
  });
});
