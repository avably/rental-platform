/**
 * Powiadomienie o zmianie hasła (R14/M-01, ADR-122) — złożenie i wysyłka.
 *
 * Kontrakty pod bramką CI:
 *  - nadawca = PLATFORMA (korespondencja konta, jak w account-email-hook),
 *  - treść PL/EN z parytetem — obie wersje z katalogu typowanego Record<Locale,…>,
 *  - jedyny link prowadzi na formularz PROŚBY o reset, BEZ żadnego tokenu,
 *  - wysyłka NIGDY nie rzuca: niedostępność i błąd transportu wracają jako
 *    POWÓD (string), sukces jako undefined — cichy fałszywy sukces nie istnieje.
 */
import { describe, expect, it, vi } from "vitest";

import type { EmailTransport, OutgoingEmail } from "@avably/core";

import {
  buildPasswordChangedEmail,
  sendPasswordChangedEmail,
} from "@/lib/password-changed-email";

const BASE = "https://app.avably.io";

describe("buildPasswordChangedEmail — złożenie", () => {
  it("PL: nadawca platformowy, temat i treść po polsku, link na /reset bez tokenu", async () => {
    const email = await buildPasswordChangedEmail({
      to: "kto@test.local",
      locale: "pl",
      baseUrl: BASE,
    });

    expect(email.from).toMatch(/^Avably </);
    expect(email.to).toBe("kto@test.local");
    expect(email.subject).toBe("Twoje hasło zostało zmienione");
    expect(email.text).toContain("pozostałe sesje wylogowane");
    expect(email.html).toContain(`${BASE}/reset`);
    // Żadnego tokenu ani parametrów zapytania w linku — to tylko formularz prośby.
    expect(email.html).not.toContain("/reset?");
    expect(email.html).not.toContain("token");
  });

  it("EN: pełny parytet — temat i treść po angielsku, ten sam link", async () => {
    const email = await buildPasswordChangedEmail({
      to: "who@test.local",
      locale: "en",
      baseUrl: BASE,
    });

    expect(email.subject).toBe("Your password was changed");
    expect(email.text).toContain("other sessions were signed out");
    expect(email.html).toContain(`${BASE}/reset`);
  });
});

describe("sendPasswordChangedEmail — semantyka niedostępności i błędów", () => {
  const sent: OutgoingEmail[] = [];
  const okTransport: EmailTransport = {
    send: async (email) => {
      sent.push(email);
      return { id: "test" };
    },
  };

  it("transport jawnie niedostępny → POWÓD, zero prób wysyłki", async () => {
    sent.length = 0;
    const reason = await sendPasswordChangedEmail({
      to: "kto@test.local",
      locale: "pl",
      baseUrl: BASE,
      availability: { available: false, reason: "brak klucza transportu" },
      transport: okTransport,
    });

    expect(reason).toBe("brak klucza transportu");
    expect(sent).toHaveLength(0);
  });

  it("błąd transportu → POWÓD (nie wyjątek): zmiana hasła nie może się od poczty wywrócić", async () => {
    const failing: EmailTransport = {
      send: vi.fn(async () => {
        throw new Error("odmowa dostawcy");
      }),
    };

    const reason = await sendPasswordChangedEmail({
      to: "kto@test.local",
      locale: "pl",
      baseUrl: BASE,
      availability: { available: true },
      transport: failing,
    });

    expect(reason).toBe("odmowa dostawcy");
  });

  it("sukces → undefined, wiadomość poszła raz i do właściwego adresata", async () => {
    sent.length = 0;
    const reason = await sendPasswordChangedEmail({
      to: "kto@test.local",
      locale: "en",
      baseUrl: BASE,
      availability: { available: true },
      transport: okTransport,
    });

    expect(reason).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe("kto@test.local");
    expect(sent[0]?.subject).toBe("Your password was changed");
  });
});
