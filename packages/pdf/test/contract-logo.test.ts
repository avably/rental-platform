/**
 * ZNAK NAJEMCY W UMOWIE (ADR-175) — dowody SKUTKU, nie obecności importu.
 *
 * Test mierzy to, co dokument NAPRAWDĘ NIESIE: obiekt obrazu w jego strukturze
 * (`/Subtype /Image`, czyli XObject typu obraz w rozumieniu formatu PDF).
 * Asercja „bajtów jest więcej" byłaby zielona także wtedy, gdyby obraz nie
 * wszedł, a przybyło metadanych — a asercja na propsach nie mówiłaby o
 * dokumencie w ogóle. Kontrola negatywna (umowa bez znaku) trzyma tę miarę
 * uczciwą: bez obrazu marker nie pada ani razu.
 *
 * Trzy pytania, po jednym na rozstrzygnięcie zadania:
 *   1. czy znak najemcy wchodzi do dokumentu,
 *   2. czy jego BRAK zostawia nazwę tekstem (a nie pustą ramkę),
 *   3. czy render umowy jest wolny od sieci — bo dokument, który przestaje
 *      powstawać, blokuje najem.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDocumentProxy } from "unpdf";

import {
  contractLogoFormat,
  contractLogoImage,
  renderContractPdf,
  type ContractPdfProps,
} from "../src/index";

/** Najmniejszy poprawny PNG (1 × 1, przezroczysty) — pełny plik, z IEND. */
const PNG_1x1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
/** Najmniejszy poprawny JPEG (1 × 1) — pełny plik, z EOI. */
const JPG_1x1 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";
/** Ten sam PNG UCIĘTY w połowie — sygnatura nienaganna, końca pliku brak. */
const PNG_UCIETY = Buffer.from(PNG_1x1, "base64").subarray(0, 40).toString("base64");
/** Poprawny WebP — format spoza możliwości renderera PDF. */
const WEBP_1x1 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

const TENANT = "Wypożyczalnia Północ";

function props(logo?: ContractPdfProps["tenant"]["logo"]): ContractPdfProps {
  return {
    locale: "pl",
    tenant: {
      name: TENANT,
      address: "ul. Portowa 4, 70-001 Szczecin",
      nip: "8522334455",
      email: "kontakt@polnoc.example",
      ...(logo ? { logo } : {}),
    },
    customer: {
      fullName: "Anna Kowalska",
      address: "ul. Morska 12/3, 70-002 Szczecin",
      email: "anna.kowalska@example.com",
    },
    order: { number: "AV-2026-08-014", startDate: "14.08.2026", endDate: "17.08.2026", days: 3 },
    items: [
      { name: "Kamera Sony FX3", serialNumber: "SN-FX3-0001", rentalGrosze: 30000, depositGrosze: 100000 },
    ],
    totals: { rentalGrosze: 30000, depositGrosze: 100000, deliveryGrosze: 1500, currency: "PLN" },
    terms: { version: "1.0", body: "Najemca zwraca sprzęt w stanie niepogorszonym." },
  };
}

/**
 * Czy dokument NIESIE obraz. Marker jest z formatu PDF, nie z naszego kodu:
 * `/Type /XObject` + `/Subtype /Image` to jedyny sposób, w jaki obraz może
 * znaleźć się w pliku. Napis `/ImageB` z listy `/ProcSet` stoi w KAŻDYM
 * dokumencie i dlatego nie szukamy samego słowa „Image".
 */
function niesieObraz(bytes: Uint8Array): boolean {
  return /\/Subtype\s*\/Image/.test(Buffer.from(bytes).toString("latin1"));
}

/**
 * Parser pdf.js PRZEJMUJE bufor wejściowy (odczepia go od naszej tablicy),
 * więc każdy odczyt dostaje własną KOPIĘ. Bez tego drugie pytanie o ten sam
 * dokument pada na „DataCloneError" — i wyglądałoby to na wadę renderu.
 */
async function tekst(bytes: Uint8Array): Promise<string> {
  const { extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return Array.isArray(text) ? text.join("\n") : text;
}

/**
 * Pionowa pozycja tytułu dokumentu — miara PUSTEJ RAMKI.
 *
 * Sama nieobecność obrazu nie odróżnia „znaku nie ma" od „znak miał być, ale
 * się nie narysował": pudełko znaku ma stałą wysokość, więc gdyby nieczytelny
 * plik wszedł do `<Image>`, renderer zarezerwowałby na niego miejsce i zsunął
 * tytuł w dół — zostawiając w nagłówku dziurę, której zabrania rozstrzygnięcie
 * o fallbacku. Tytuł stojący DOKŁADNIE tam, gdzie w umowie bez znaku, jest
 * dowodem, że dziury nie ma.
 */
async function yTytulu(bytes: Uint8Array): Promise<number> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  const items = content.items as Array<{ str: string; transform: number[] }>;
  const title = items.find((item) => item.str.includes("UMOWA"));
  if (!title) throw new Error("Nie znaleziono tytułu umowy w warstwie tekstu.");
  return title.transform[5]!;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("znak najemcy w umowie", () => {
  it("PNG najemcy wchodzi do dokumentu jako obraz", async () => {
    const bytes = await renderContractPdf(props({ data: PNG_1x1, format: "png" }));

    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(niesieObraz(bytes)).toBe(true);
    // Nazwa wynajmującego zostaje w dokumencie ZAWSZE — jest treścią umowy,
    // nie marką nadawcy, więc znak jej nie zastępuje (inaczej niż w mailu).
    expect(await tekst(bytes)).toContain(TENANT);
  });

  it("JPEG najemcy wchodzi do dokumentu jako obraz", async () => {
    const bytes = await renderContractPdf(props({ data: JPG_1x1, format: "jpg" }));

    expect(niesieObraz(bytes)).toBe(true);
  });

  // ── KONTROLA NEGATYWNA do dwóch powyższych: bez znaku obrazu NIE MA, a nazwa
  // najemcy stoi w nagłówku tekstem. Bez tej pary asercja „maluje obraz"
  // byłaby zielona także dla dokumentu, który maluje obraz zawsze.
  it("najemca bez znaku: dokument bez obrazu, nazwa tekstem", async () => {
    const bytes = await renderContractPdf(props());

    expect(niesieObraz(bytes)).toBe(false);
    expect(await tekst(bytes)).toContain(TENANT);
  });

  it("ucięty plik nie wywraca umowy i nie zostawia pustej ramki", async () => {
    // Kształt awarii po zerwanym transferze: nienaganny nagłówek, brak końca.
    const bytes = await renderContractPdf(props({ data: PNG_UCIETY, format: "png" }));
    const bezZnaku = await renderContractPdf(props());

    expect(new TextDecoder().decode(bytes.subarray(0, 5))).toBe("%PDF-");
    expect(niesieObraz(bytes)).toBe(false);
    expect(await tekst(bytes)).toContain(TENANT);
    // Nagłówek jest CO DO PUNKTU taki, jak w umowie bez znaku — zarezerwowane
    // pudełko po niezdekodowanym pliku zsunęłoby tytuł niżej.
    expect(await yTytulu(bytes)).toBe(await yTytulu(bezZnaku));
  });

  it("format spoza możliwości renderera degraduje do nazwy, a nie do dziury", async () => {
    // Ładunek jest POPRAWNYM plikiem — tyle że WebP-em, którego renderer PDF
    // nie zdekoduje. Deklaracja `png` jest tu celowym kłamstwem wołającego.
    const bytes = await renderContractPdf(props({ data: WEBP_1x1, format: "png" }));

    expect(niesieObraz(bytes)).toBe(false);
    expect(await tekst(bytes)).toContain(TENANT);
    expect(await yTytulu(bytes)).toBe(await yTytulu(await renderContractPdf(props())));
  });

  // ── KONTROLA POZYTYWNA dla miary „pustej ramki": znak, który WCHODZI,
  // przesuwa tytuł w dół. Bez tego przypadku równość pozycji byłaby zielona
  // także wtedy, gdyby pudełko znaku nie zajmowało miejsca nigdy.
  it("czytelny znak przesuwa tytuł w dół — pudełko naprawdę zajmuje miejsce", async () => {
    const zeZnakiem = await renderContractPdf(props({ data: PNG_1x1, format: "png" }));
    const bezZnaku = await renderContractPdf(props());

    expect(await yTytulu(zeZnakiem)).toBeLessThan(await yTytulu(bezZnaku));
  });

  /**
   * ============ RENDER UMOWY NIE DOTYKA SIECI (rozstrzygnięcie R4) ============
   *
   * To jest asercja o ZALEŻNOŚCI, nie o wyglądzie. `@react-pdf` przyjąłby
   * w `<Image src>` adres i pobrałby go w chwili renderu — bez limitu czasu.
   * Test przykrywa `fetch` licznikiem: gdyby szablon kiedykolwiek dostał adres
   * zamiast bajtów, licznik urośnie i ten przypadek zapłonie.
   */
  it("generowanie umowy ze znakiem nie wykonuje ani jednego żądania sieciowego", async () => {
    const zadania: string[] = [];
    vi.stubGlobal("fetch", (input: unknown) => {
      zadania.push(String(input));
      return Promise.reject(new Error("sieć niedostępna"));
    });

    const bytes = await renderContractPdf(props({ data: PNG_1x1, format: "png" }));

    expect(zadania).toEqual([]);
    expect(niesieObraz(bytes)).toBe(true);
  });
});

describe("contractLogoFormat", () => {
  it("rozpoznaje formaty, które renderer PDF potrafi zdekodować", () => {
    const tenant = "8f7a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071";
    const upload = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
    expect(contractLogoFormat(`${tenant}/logo/${upload}.png`)).toBe("png");
    expect(contractLogoFormat(`${tenant}/logo/${upload}.jpg`)).toBe("jpg");
  });

  it("odmawia formatom, których renderer nie zdekoduje — i SVG-owi", () => {
    const tenant = "8f7a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071";
    const upload = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
    expect(contractLogoFormat(`${tenant}/logo/${upload}.webp`)).toBeNull();
    expect(contractLogoFormat(`${tenant}/logo/${upload}.avif`)).toBeNull();
    expect(contractLogoFormat(`${tenant}/logo/${upload}.svg`)).toBeNull();
  });
});

describe("contractLogoImage", () => {
  it("przepuszcza kompletny plik zadeklarowanego formatu", () => {
    expect(contractLogoImage({ data: PNG_1x1, format: "png" })).not.toBeNull();
    expect(contractLogoImage({ data: JPG_1x1, format: "jpg" })).not.toBeNull();
  });

  it("odmawia, gdy deklaracja formatu rozmija się z bajtami", () => {
    expect(contractLogoImage({ data: PNG_1x1, format: "jpg" })).toBeNull();
    expect(contractLogoImage({ data: JPG_1x1, format: "png" })).toBeNull();
  });

  it("odmawia plikowi uciętemu i ładunkowi pustemu", () => {
    expect(contractLogoImage({ data: PNG_UCIETY, format: "png" })).toBeNull();
    expect(contractLogoImage({ data: "", format: "png" })).toBeNull();
  });

  it("brak znaku to brak obrazu — bez wyjątku i bez atrapy", () => {
    expect(contractLogoImage(undefined)).toBeNull();
  });
});
