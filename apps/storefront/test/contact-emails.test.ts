/**
 * WYSYŁKA WIADOMOŚCI Z FORMULARZA KONTAKTU (E4, ADR-095).
 *
 * Transport wstrzykiwany — bez sieci i bez konta u dostawcy. Sprawdzamy trzy
 * rzeczy, które decydują o tym, czy najemca w ogóle odpisze:
 *
 *   1. ADRESAT — dokładnie ten z treści sekcji, przekazany przez rdzeń;
 *   2. REPLY-TO — adres PISZĄCEGO. Bez tego nagłówka „Odpowiedz" w skrzynce
 *      najemcy prowadzi na adres platformy, czyli donikąd. To jest cała
 *      mechanika odpowiadania i jedyne miejsce, w którym ona istnieje;
 *   3. NADAWCA — adres PLATFORMY z nazwą wypożyczalni (ADR-033). Adres najemcy
 *      w polu `From` byłby podszyciem się pod jego domenę, której nie mamy
 *      zweryfikowanej — poczta odbiorcy odrzuciłaby taką wiadomość.
 *
 * Treść wiadomości sprawdzamy w obu wariantach (HTML i tekst): klient pocztowy
 * bez HTML-a ma dostać to samo, a nie pustą kopertę.
 */
import type { EmailTransport, OutgoingEmail } from "@avably/core";
import { describe, expect, it, vi } from "vitest";

import { sendContactMessage } from "@/lib/contact/emails";

function transport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: { send: vi.fn(async (email: OutgoingEmail) => (sent.push(email), { id: "res-1" })) },
  };
}

const WIADOMOSC = {
  to: "biuro@najemca.test",
  name: "Anna Kowalska",
  email: "anna@przyklad.test",
  message: "Czy namiot 5x8 jest wolny w czerwcu?",
};

function deps(patch: Partial<Parameters<typeof sendContactMessage>[1]> = {}) {
  const t = transport();
  return {
    sent: t.sent,
    deps: {
      transport: t.transport,
      availability: { available: true },
      tenantName: "Wypożyczalnia Nadwiślańska",
      locale: "pl",
      fromEmail: "Avably <noreply@platforma.test>",
      ...patch,
    },
  };
}

describe("wiadomość do najemcy", () => {
  it("idzie na adres z sekcji, z odpowiedzią WPROST do piszącego", async () => {
    const { deps: d, sent } = deps();
    expect(await sendContactMessage(WIADOMOSC, d)).toEqual({ delivered: true });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("biuro@najemca.test");
    expect(sent[0]!.replyTo, "„Odpowiedz” prowadziłoby donikąd").toBe("anna@przyklad.test");
    expect(sent[0]!.from).toBe("Wypożyczalnia Nadwiślańska <noreply@platforma.test>");
  });

  it("temat niesie nadawcę, a treść — komplet danych kontaktowych", async () => {
    const { deps: d, sent } = deps();
    await sendContactMessage({ ...WIADOMOSC, phone: "512 345 678" }, d);

    expect(sent[0]!.subject).toContain("Anna Kowalska");
    for (const wariant of [sent[0]!.html, sent[0]!.text]) {
      expect(wariant).toContain("Anna Kowalska");
      expect(wariant).toContain("anna@przyklad.test");
      expect(wariant).toContain("512 345 678");
      expect(wariant).toContain("Czy namiot 5x8 jest wolny w czerwcu?");
    }
  });

  it("bez telefonu nie ma pustej rubryki telefonu", async () => {
    const { deps: d, sent } = deps();
    await sendContactMessage(WIADOMOSC, d);
    expect(sent[0]!.text).not.toContain("Telefon");
  });

  it("język wiadomości to język NAJEMCY — to on ją czyta", async () => {
    const { deps: d, sent } = deps({ locale: "en" });
    await sendContactMessage(WIADOMOSC, d);
    expect(sent[0]!.subject).toContain("Website message");
    expect(sent[0]!.html).toContain("Message from your website");
  });

  it("treść wchodzi jako TEKST — znaczniki z pola nie stają się HTML-em", async () => {
    const { deps: d, sent } = deps();
    await sendContactMessage(
      { ...WIADOMOSC, message: "<script>alert(1)</script> pozdrawiam" },
      d,
    );
    expect(sent[0]!.html).not.toContain("<script>");
    expect(sent[0]!.html).toContain("&lt;script&gt;");
  });
});

describe("niedostępna poczta", () => {
  it("nie próbuje wysyłać i mówi wprost, że nie dostarczyła", async () => {
    const { deps: d, sent } = deps({
      availability: { available: false, reason: "brak RESEND_API_KEY" },
    });
    expect(await sendContactMessage(WIADOMOSC, d)).toEqual({ delivered: false });
    expect(sent).toHaveLength(0);
  });
});
