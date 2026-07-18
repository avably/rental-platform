/**
 * Testy wysyłki e-maili checkoutu (apps/storefront/lib/checkout/emails.ts).
 *
 * Transport i dostępność wstrzykiwane — bez sieci i bez Resend. Sprawdzamy, że:
 *   - funkcja NIGDY nie rzuca (zamówienie jest już utrwalone),
 *   - idą DWA e-maile: potwierdzenie do klienta + powiadomienie do najemcy,
 *   - adresaci/nadawca/reply-to są poprawni,
 *   - brak transportu / brak adresu powiadomień = uczciwy powód, nie cisza.
 */
import { describe, expect, it, vi } from "vitest";

import type {
  EmailLogEntry,
  EmailLogRecorder,
  EmailTransport,
  OutgoingEmail,
} from "@avably/core";

import { sendCheckoutEmails } from "@/lib/checkout/emails";
import type { CheckoutRpcResult } from "@/lib/checkout/core";

function rpcResult(overrides: Partial<CheckoutRpcResult> = {}): CheckoutRpcResult {
  return {
    order_number: "AV-2026-007",
    order_status: "pending",
    payment_status: "unpaid",
    start_date: "2026-10-01",
    end_date: "2026-10-07",
    delivery_method: "pickup",
    total_rental_grosze: 65_000,
    total_deposit_grosze: 5_000,
    delivery_grosze: 0,
    currency: "PLN",
    items: [],
    customer: { email: "klient@example.com", full_name: "Jan Kowalski", locale: "pl" },
    tenant: { name: "Wypożyczalnia", locale: "pl" },
    email_sender: { name: "Wypożyczalnia", reply_to: "biuro@najemca.example" },
    notify_email: "biuro@najemca.example",
    log_token: "9e1d4c7a-0000-4000-8000-abcdefabcdef",
    ...overrides,
  };
}

function capturingTransport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    sent,
    transport: {
      send: vi.fn(async (email: OutgoingEmail) => {
        sent.push(email);
        return { id: `resend-${sent.length}` };
      }),
    },
  };
}

/** Rejestrator historii, który zapamiętuje wpisy zamiast pisać do bazy. */
function capturingRecorder(): { recorder: EmailLogRecorder; entries: EmailLogEntry[] } {
  const entries: EmailLogEntry[] = [];
  return {
    entries,
    recorder: {
      record: vi.fn(async (entry: EmailLogEntry) => {
        entries.push(entry);
      }),
    },
  };
}

const AVAILABLE = { available: true } as const;
const DEPS_BASE = { panelBaseUrl: "https://panel.avably.io", fromEmail: "Avably <no-reply@avably.io>" };

describe("sendCheckoutEmails", () => {
  it("wysyła DWA e-maile: potwierdzenie klienta + powiadomienie najemcy", async () => {
    const { transport, sent } = capturingTransport();
    const issues = await sendCheckoutEmails(rpcResult(), { transport, availability: AVAILABLE, ...DEPS_BASE });

    expect(issues).toEqual([]);
    expect(sent).toHaveLength(2);

    const toCustomer = sent.find((e) => e.to === "klient@example.com");
    const toTenant = sent.find((e) => e.to === "biuro@najemca.example");
    expect(toCustomer, "brak potwierdzenia dla klienta").toBeDefined();
    expect(toTenant, "brak powiadomienia dla najemcy").toBeDefined();

    // From = nazwa tenanta + adres platformy (ADR-033).
    expect(toCustomer!.from).toContain("Wypożyczalnia");
    // Klient odpowiada na reply_to najemcy; najemca odpowiada wprost klientowi.
    expect(toCustomer!.replyTo).toBe("biuro@najemca.example");
    expect(toTenant!.replyTo).toBe("klient@example.com");
  });

  it("brak skonfigurowanego transportu → jeden uczciwy powód, zero prób wysyłki", async () => {
    const { transport, sent } = capturingTransport();
    const issues = await sendCheckoutEmails(rpcResult(), {
      transport,
      availability: { available: false, reason: "brak RESEND_API_KEY" },
      ...DEPS_BASE,
    });

    expect(issues).toEqual(["brak RESEND_API_KEY"]);
    expect(sent, "próbowano wysłać mimo braku transportu").toHaveLength(0);
  });

  it("brak adresu powiadomień (notify_email=null) → klient dostaje maila, powiadomienie pominięte z powodem wskazującym konfigurację", async () => {
    // notify_email=null to jedyny stan przy braku email_sender.reply_to —
    // RPC NIE robi fallbacku na e-mail ownera (ADR-042, znalezisko recenzji:
    // odpowiedź RPC czyta każdy bezpośredni wołający anon keyem, PII z
    // auth.users nie ma prawa w niej wystąpić). Warstwa e-maili nie zgaduje
    // adresu — raportuje uczciwie, co skonfigurować.
    const { transport, sent } = capturingTransport();
    const issues = await sendCheckoutEmails(rpcResult({ notify_email: null }), {
      transport,
      availability: AVAILABLE,
      ...DEPS_BASE,
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("klient@example.com");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("skonfiguruj nadawcę");
    expect(issues[0]).toContain("/ustawienia-emaili");
  });

  it("błąd wysyłki potwierdzenia NIE rzuca i NIE blokuje powiadomienia najemcy", async () => {
    const sent: OutgoingEmail[] = [];
    let firstCall = true;
    const transport: EmailTransport = {
      send: vi.fn(async (email: OutgoingEmail) => {
        if (firstCall) {
          firstCall = false;
          throw new Error("Resend 422");
        }
        sent.push(email);
        return { id: "resend-2" };
      }),
    };

    const issues = await sendCheckoutEmails(rpcResult(), { transport, availability: AVAILABLE, ...DEPS_BASE });

    // Pierwsza (klient) padła → powód; druga (najemca) wyszła mimo to.
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("potwierdzenie dla klienta nie wyszło");
    expect(sent.map((e) => e.to)).toEqual(["biuro@najemca.example"]);
  });

  it("locale klienta spada na język tenanta, gdy klient nie ma preferencji (ADR-037)", async () => {
    const { transport, sent } = capturingTransport();
    await sendCheckoutEmails(rpcResult({ customer: { email: "x@y.co", full_name: "X", locale: null } }), {
      transport,
      availability: AVAILABLE,
      ...DEPS_BASE,
    });
    // Nie rzuca i wysyła — locale null nie wywraca renderu (fallback na tenanta).
    expect(sent).toHaveLength(2);
  });
});

/**
 * Historia wysyłek (Zadanie 2.8, ADR-045) — ścieżka checkoutu.
 *
 * Kontrola pozytywna (udana wysyłka → wpis 'sent' z identyfikatorem dostawcy;
 * nieudana → 'failed' z powodem) plus dowód najważniejszy: awaria SAMEGO
 * dziennika nie może zabrać wysyłki ani zamówienia.
 */
describe("sendCheckoutEmails — historia wysyłek (ADR-045)", () => {
  it("udana wysyłka zapisuje DWA wpisy 'sent' z identyfikatorem dostawcy", async () => {
    const { transport } = capturingTransport();
    const { recorder, entries } = capturingRecorder();

    const issues = await sendCheckoutEmails(rpcResult(), {
      transport,
      availability: AVAILABLE,
      recorder,
      ...DEPS_BASE,
    });

    expect(issues).toEqual([]);
    expect(entries).toHaveLength(2);

    // Rodzaje rozróżniają ścieżkę checkoutu od cyklu najmu (0021): wspólny
    // szablon rental-confirmed NIE oznacza wspólnego rodzaju wpisu.
    expect(entries.map((e) => e.kind)).toEqual([
      "checkout_confirmation",
      "new_order_notification",
    ]);
    expect(entries.map((e) => e.recipient)).toEqual([
      "klient@example.com",
      "biuro@najemca.example",
    ]);
    for (const entry of entries) {
      expect(entry.status).toBe("sent");
      expect(entry.providerMessageId).toMatch(/^resend-/);
      expect(entry.error ?? null).toBeNull();
    }
  });

  it("nieudana wysyłka zapisuje wpis 'failed' z powodem", async () => {
    const transport: EmailTransport = {
      send: vi.fn(async () => {
        throw new Error("Resend 422");
      }),
    };
    const { recorder, entries } = capturingRecorder();

    const issues = await sendCheckoutEmails(rpcResult(), {
      transport,
      availability: AVAILABLE,
      recorder,
      ...DEPS_BASE,
    });

    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.status).toBe("failed");
      // Powód w rejestrze jest TEN SAM, który dostaje wołający — inaczej
      // operator musiałby zgadywać, czy to ten sam problem.
      expect(entry.error).toContain("Resend 422");
      expect(entry.providerMessageId ?? null).toBeNull();
    }
    expect(issues.every((i) => i.includes("Resend 422"))).toBe(true);
  });

  it("awaria dziennika NIE unieważnia wysyłki — obie wiadomości wychodzą, wraca sam powód", async () => {
    const { transport, sent } = capturingTransport();
    const recorder: EmailLogRecorder = {
      record: vi.fn(async () => {
        throw new Error("brak połączenia z bazą");
      }),
    };

    const issues = await sendCheckoutEmails(rpcResult(), {
      transport,
      availability: AVAILABLE,
      recorder,
      ...DEPS_BASE,
    });

    // Wiadomości wyszły mimo martwego dziennika.
    expect(sent).toHaveLength(2);
    // Powód jest o HISTORII, nie o wysyłce — sklejenie obu kazałoby operatorowi
    // ponawiać wysyłkę, która się udała.
    expect(issues).toHaveLength(2);
    for (const issue of issues) {
      expect(issue).toContain("historii wiadomości");
      expect(issue).toContain("brak połączenia z bazą");
      expect(issue).not.toContain("nie wyszło");
    }
  });
});
