/**
 * ZNAK NAJEMCY W KORESPONDENCJI Z JEGO KLIENTEM (ADR-175).
 *
 * Testy pytają o SKUTEK w wyrenderowanej wiadomości — nigdy o to, czy szablon
 * coś importuje. Trzy rzeczy, które muszą być prawdą u odbiorcy:
 *   1. w mailu najemcy stoi ZNAK TEGO najemcy,
 *   2. bez znaku stoi jego NAZWA tekstem (nie pusta ramka, nie nasz znak),
 *   3. adres obrazu w źródle wiadomości nie niesie niczego poza plikiem.
 */
import { describe, expect, it } from "vitest";

import {
  renderPaymentConfirmed,
  renderPickupReturnReminder,
  renderRentalConfirmed,
  renderRentalContractEmail,
  renderReturnLabel,
  type EmailTenantLogo,
  type RentalLifecycleEmailProps,
} from "../src/index";

const BAZA = "https://przyklad.supabase.co/storage/v1/object/public/site-images";
const NAJEMCA_A = {
  nazwa: "Wypożyczalnia Północ",
  sciezka:
    "8f7a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071/logo/1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9.png",
};
const NAJEMCA_B = {
  nazwa: "Sprzęt Południe",
  sciezka:
    "b1c2d3e4-f506-4718-9a2b-3c4d5e6f7081/logo/2b3c4d5e-6f70-4819-a2b3-c4d5e6f70819.png",
};

const znak = (najemca: typeof NAJEMCA_A): EmailTenantLogo => ({
  src: `${BAZA}/${najemca.sciezka}`,
  alt: najemca.nazwa,
});

function props(najemca: typeof NAJEMCA_A, logo?: EmailTenantLogo): RentalLifecycleEmailProps {
  return {
    customerName: "Anna Kowalska",
    endDate: "17.08.2026",
    locale: "pl",
    orderNumber: "AV-2026-08-014",
    startDate: "14.08.2026",
    tenantName: najemca.nazwa,
    totalRentalFormatted: "550,00 zł",
    ...(logo ? { logo } : {}),
  };
}

/** Adresy z atrybutów `src` — czyli dokładnie to, co widzi odbiorca w źródle. */
function adresyObrazow(html: string): string[] {
  return Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)).map((m) => m[1] ?? "");
}

describe("znak najemcy w potwierdzeniu rezerwacji", () => {
  it("wchodzi do wiadomości jako obraz z tekstem zastępczym", async () => {
    const { html } = await renderRentalConfirmed(props(NAJEMCA_A, znak(NAJEMCA_A)));

    expect(adresyObrazow(html)).toContain(`${BAZA}/${NAJEMCA_A.sciezka}`);
    expect(html).toContain(`alt="${NAJEMCA_A.nazwa}"`);
  });

  // ── KONTROLA NEGATYWNA: bez znaku nie ma ani obrazu, ani pustej ramki —
  // jest nazwa najemcy tekstem, dokładnie jak przed tą zmianą.
  it("bez znaku wiadomość pokazuje nazwę najemcy tekstem", async () => {
    const { html, text } = await renderRentalConfirmed(props(NAJEMCA_A));

    expect(adresyObrazow(html)).toEqual([]);
    expect(html).toContain(NAJEMCA_A.nazwa);
    expect(text).toContain(NAJEMCA_A.nazwa);
  });

  /**
   * ============ IZOLACJA DWÓCH NAJEMCÓW ============
   *
   * Znak najemcy A nie ma prawa pojawić się w wiadomości najemcy B. Render
   * dostaje znak WYŁĄCZNIE propsem, więc test sprawdza to, co sprawdzić można
   * na tym poziomie: dwa równoległe renderowania nie przeciekają wzajemnie —
   * ani ścieżką pliku, ani nazwą. Drugą połowę tej samej gwarancji (że props
   * pochodzi z wiersza WŁAŚCIWEGO najemcy) trzyma test w panelu.
   */
  it("wiadomość najemcy B nie niesie ani ścieżki, ani nazwy najemcy A", async () => {
    const [a, b] = await Promise.all([
      renderRentalConfirmed(props(NAJEMCA_A, znak(NAJEMCA_A))),
      renderRentalConfirmed(props(NAJEMCA_B, znak(NAJEMCA_B))),
    ]);

    expect(adresyObrazow(b.html)).toEqual([`${BAZA}/${NAJEMCA_B.sciezka}`]);
    expect(b.html).not.toContain(NAJEMCA_A.sciezka);
    expect(b.html).not.toContain(NAJEMCA_A.nazwa);
    // Kontrola pozytywna w TYM SAMYM przebiegu: rozdział działa w obie strony,
    // więc asercja „nie zawiera" nie jest zielona z powodu pustego renderu.
    expect(adresyObrazow(a.html)).toEqual([`${BAZA}/${NAJEMCA_A.sciezka}`]);
    expect(a.html).not.toContain(NAJEMCA_B.sciezka);
  });

  /**
   * ============ ADRES OBRAZU NIE JEST KANAŁEM WYCIEKU ============
   *
   * Odbiorca widzi w źródle wiadomości dokładnie ten adres, który każdy
   * odwiedzający widzi w nagłówku sklepu — publiczny plik z bucketa. Żadnego
   * tokenu, żadnego parametru zapytania (tam wylądowałby identyfikator
   * zamówienia albo adres klienta), żadnego adresu podpisanego.
   */
  it("adres obrazu jest gołym adresem pliku — bez tokenu i bez parametrów", async () => {
    const { html } = await renderRentalConfirmed(props(NAJEMCA_A, znak(NAJEMCA_A)));

    const adresy = adresyObrazow(html);
    expect(adresy).toHaveLength(1);
    const adres = adresy[0]!;
    expect(adres).toBe(`${BAZA}/${NAJEMCA_A.sciezka}`);
    expect(adres).not.toContain("?");
    expect(adres).not.toContain("#");
    expect(adres.toLowerCase()).not.toContain("token");
  });
});

describe("znak najemcy w pozostałej korespondencji z klientem", () => {
  const wspolne = { customerName: "Anna Kowalska", locale: "pl" as const, orderNumber: "AV-2026-08-014" };

  it("umowa, płatność, etykieta zwrotna i przypomnienie niosą ten sam znak", async () => {
    const logo = znak(NAJEMCA_A);
    const rendery = await Promise.all([
      renderRentalContractEmail({ ...wspolne, tenantName: NAJEMCA_A.nazwa, logo }),
      renderPaymentConfirmed({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        amountPaidFormatted: "550,00 zł",
        logo,
      }),
      renderReturnLabel({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        endDate: "17.08.2026",
        shipmentNumber: "PL-0001",
        logo,
      }),
      renderPickupReturnReminder({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        endDate: "17.08.2026",
        locationName: "Magazyn Główny",
        locationAddress: "ul. Portowa 4, 70-001 Szczecin",
        logo,
      }),
    ]);

    for (const { html } of rendery) {
      expect(adresyObrazow(html)).toEqual([`${BAZA}/${NAJEMCA_A.sciezka}`]);
    }
  });

  it("bez znaku każda z nich pokazuje nazwę najemcy tekstem", async () => {
    const rendery = await Promise.all([
      renderRentalContractEmail({ ...wspolne, tenantName: NAJEMCA_A.nazwa }),
      renderPaymentConfirmed({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        amountPaidFormatted: "550,00 zł",
      }),
      renderReturnLabel({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        endDate: "17.08.2026",
        shipmentNumber: "PL-0001",
      }),
      renderPickupReturnReminder({
        ...wspolne,
        tenantName: NAJEMCA_A.nazwa,
        endDate: "17.08.2026",
        locationName: "Magazyn Główny",
        locationAddress: "ul. Portowa 4, 70-001 Szczecin",
      }),
    ]);

    for (const { html, text } of rendery) {
      expect(adresyObrazow(html)).toEqual([]);
      expect(html).toContain(NAJEMCA_A.nazwa);
      expect(text).toContain(NAJEMCA_A.nazwa);
    }
  });
});
