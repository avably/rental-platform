/**
 * LOGO AVABLY W MAILACH PLATFORMOWYCH (ADR-210).
 *
 * Dwie prawdy u odbiorcy:
 *   1. mail PLATFORMOWY otwiera sie ZNAKIEM Avably - obrazem z publicznego
 *      adresu marketingowego, z jawnymi wymiarami i tekstem zastepczym
 *      "Avably" na wypadek zablokowanych obrazow (stan sprzed zmiany),
 *   2. mail NAJEMCY do jego klienta (RentalEmailLayout) NIE niesie ani tego
 *      obrazu, ani jego adresu - korespondencja wypozyczalni nosi marke
 *      najemcy, nie platformy (decyzja PM nr 1 przy ADR-210).
 */
import { describe, expect, it } from "vitest";

import {
  renderEmailConfirmation,
  renderNewOrderNotification,
  renderPaymentConfirmed,
  renderRentalConfirmed,
} from "../src/index";

const LOGO_URL = "https://www.avably.io/marketing/avably-logo-email.png";

/** Adresy z atrybutow `src` - dokladnie to, co widzi odbiorca w zrodle. */
function adresyObrazow(html: string): string[] {
  return Array.from(html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)).map(
    (m) => m[1] ?? "",
  );
}

/** Czy fragment stoi W MIEJSCU ZNAKU, czyli nad naglowkiem wiadomosci. */
function nadNaglowkiem(html: string, fragment: string): boolean {
  const naglowek = html.indexOf("<h1");
  const szukane = html.indexOf(fragment);
  return szukane >= 0 && naglowek >= 0 && szukane < naglowek;
}

const PROPS_NAJEMCY = {
  customerName: "Anna Kowalska",
  endDate: "17.08.2026",
  locale: "pl" as const,
  orderNumber: "AV-2026-08-014",
  startDate: "14.08.2026",
  tenantName: "Wypożyczalnia Północ",
  totalRentalFormatted: "550,00 zł",
};

describe("logo Avably w mailach platformowych", () => {
  it("potwierdzenie adresu otwiera sie obrazem znaku, nie napisem", async () => {
    const { html } = await renderEmailConfirmation({
      confirmationUrl: "https://app.example.test/auth/confirm?token=t-123",
      locale: "pl",
      recipientName: "Anna",
    });

    expect(adresyObrazow(html)).toContain(LOGO_URL);
    // Znak stoi tam, gdzie stal napis marki - NAD naglowkiem wiadomosci.
    expect(nadNaglowkiem(html, LOGO_URL)).toBe(true);

    // Jeden znacznik obrazu niesie KOMPLET: adres, fallback i jawne wymiary
    // (klienci poczty bez wymiarow rozjezdzaja uklad).
    const znacznik = html.match(/<img[^>]*avably-logo-email\.png[^>]*>/)?.[0];
    expect(znacznik).toBeDefined();
    expect(znacznik).toContain('alt="Avably"');
    expect(znacznik).toContain('width="150"');
    expect(znacznik).toContain('height="40"');

    // Goly wezel tekstowy marki znikl z naglowka. Stopka dalej niesie nazwe
    // produktu, ale w zdaniu z tagline - nigdy jako samotny akapit.
    expect(html).not.toMatch(/>Avably<\/p>/);
  });

  it("drugi mail platformowy (nowe zamowienie) niesie ten sam znak", async () => {
    const { html } = await renderNewOrderNotification({
      customerName: "Alicja Nowak",
      locale: "pl",
      orderNumber: "ZAM-2026-001",
      orderUrl: "https://app.example.test/orders/order-123",
      rentalEndDate: "23.07.2026",
      rentalStartDate: "20.07.2026",
      totalAmount: "1 299,00 zł",
    });

    expect(adresyObrazow(html)).toContain(LOGO_URL);
    expect(nadNaglowkiem(html, LOGO_URL)).toBe(true);
    expect(html).toContain('alt="Avably"');
  });

  // ── IZOLACJA (decyzja PM nr 1): korespondencja najemcy z jego klientem
  // nosi marke NAJEMCY - znak Avably nie ma prawa sie w niej pojawic,
  // niezaleznie od tego, czy najemca ma wlasny znak.
  it("mail najemcy nie niesie znaku Avably - z wlasnym znakiem i bez", async () => {
    const znakNajemcy = {
      src: "https://przyklad.supabase.co/storage/v1/object/public/site-images/8f7a1b2c-3d4e-4f50-9a1b-2c3d4e5f6071/logo/1a2b3c4d.png",
      alt: PROPS_NAJEMCY.tenantName,
    };
    const [zeZnakiem, bezZnaku, platnosc, platformowy] = await Promise.all([
      renderRentalConfirmed({ ...PROPS_NAJEMCY, logo: znakNajemcy }),
      renderRentalConfirmed(PROPS_NAJEMCY),
      renderPaymentConfirmed({
        amountPaidFormatted: "550,00 zł",
        customerName: PROPS_NAJEMCY.customerName,
        locale: "pl",
        orderNumber: PROPS_NAJEMCY.orderNumber,
        tenantName: PROPS_NAJEMCY.tenantName,
      }),
      renderEmailConfirmation({
        confirmationUrl: "https://app.example.test/auth/confirm?token=t-123",
        locale: "pl",
        recipientName: "Anna",
      }),
    ]);

    for (const { html } of [zeZnakiem, bezZnaku, platnosc]) {
      expect(html).not.toContain("avably-logo-email.png");
      expect(html).not.toContain("www.avably.io/marketing");
    }
    // Miejsce znaku w mailu najemcy zachowuje sie jak dotad: jego wlasny
    // obraz albo jego nazwa tekstem - nigdy nasz znak.
    expect(adresyObrazow(zeZnakiem.html)).toEqual([znakNajemcy.src]);
    expect(adresyObrazow(bezZnaku.html)).toEqual([]);
    expect(nadNaglowkiem(bezZnaku.html, PROPS_NAJEMCY.tenantName)).toBe(true);

    // Kontrola pozytywna w TYM SAMYM przebiegu: igla i render dzialaja,
    // wiec "nie zawiera" powyzej nie jest zielone przez pusty skan.
    expect(platformowy.html).toContain("avably-logo-email.png");
  });
});
