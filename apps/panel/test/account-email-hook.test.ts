/**
 * Send Email Hook — e-maile kont na szablonach 8a (ADR-048).
 *
 * WSZYSTKO NA FIXTURACH: żadnej sieci, żadnego żywego Supabase, transport
 * wstrzykiwany. Fixture payloadu jest przepisany z przykładu w dokumentacji
 * hooka (supabase.com/docs/guides/auth/auth-hooks/send-email-hook), żeby test
 * pilnował KONTRAKTU, a nie naszego wyobrażenia o nim.
 *
 * ASERCJE PATRZĄ NA LICZBĘ WYWOŁAŃ TRANSPORTU, NIE TYLKO NA STATUS. Sam kod
 * odpowiedzi przepuściłby wariant najgorszy z możliwych: 401 zwrócone PO tym,
 * jak wiadomość już poszła.
 */
import { describe, expect, it } from "vitest";
import type { EmailTransport, OutgoingEmail } from "@avably/core";

import { handleSendEmailHook } from "@/lib/account-email-hook";
import { signStandardWebhook } from "@/lib/standard-webhook";

const SECRET = "v1,whsec_c3VwZXItdGFqbnktc2VrcmV0LWhvb2th";
const NOW = new Date("2026-07-20T10:00:00.000Z");

/** Fixture z dokumentacji hooka, przycięty do pól, na których stoi wysyłka. */
function payloadFixture(overrides: {
  action?: string;
  locale?: unknown;
  email?: string;
  siteUrl?: string;
} = {}) {
  return {
    user: {
      id: "8484b834-f29e-4af2-bf42-80644d154f76",
      aud: "authenticated",
      role: "authenticated",
      email: overrides.email ?? "nowy@example.com",
      phone: "",
      app_metadata: { provider: "email", providers: ["email"] },
      user_metadata: {
        email: overrides.email ?? "nowy@example.com",
        email_verified: false,
        sub: "8484b834-f29e-4af2-bf42-80644d154f76",
        ...(overrides.locale === undefined ? {} : { locale: overrides.locale }),
      },
      created_at: "2026-07-20T09:59:00.000Z",
      updated_at: "2026-07-20T09:59:00.000Z",
      is_anonymous: false,
    },
    email_data: {
      token: "305805",
      token_hash: "7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0",
      redirect_to: "http://127.0.0.1:3000/",
      email_action_type: overrides.action ?? "signup",
      site_url: overrides.siteUrl ?? "http://127.0.0.1:3000",
      token_new: "",
      token_hash_new: "",
      old_email: "",
      old_phone: "",
      provider: "",
      factor_type: "",
    },
  };
}

function captureTransport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return {
    transport: {
      send: async (email) => {
        sent.push(email);
        return { id: `resend-${sent.length}` };
      },
    },
    sent,
  };
}

/** Transport, który zawsze odmawia — lustro braku RESEND_API_KEY. */
const failingTransport: EmailTransport = {
  send: async () => {
    throw new Error("Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).");
  },
};

function hookRequest(
  body: unknown,
  options: { secret?: string; signature?: string; headers?: Record<string, string> } = {},
): Request {
  const payload = JSON.stringify(body);
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature =
    options.signature ??
    `v1,${signStandardWebhook({
      secret: options.secret ?? SECRET,
      id: "msg_1",
      timestamp,
      payload,
    })}`;

  return new Request("https://app.avably.io/api/webhooks/supabase-email", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "webhook-id": "msg_1",
      "webhook-timestamp": timestamp,
      "webhook-signature": signature,
      ...options.headers,
    },
    body: payload,
  });
}

describe("handleSendEmailHook — ścieżka szczęśliwa", () => {
  it("potwierdzenie rejestracji: szablon confirmation, link na nasz callback", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport,
      now: NOW,
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    const email = sent[0]!;
    expect(email.to).toBe("nowy@example.com");
    // Nadawca = tożsamość PLATFORMY (nie tenanta — ten jeszcze nie istnieje).
    expect(email.from).toContain("Avably <");
    // emailMessages("en").emailConfirmation.heading — locale z user_metadata brak → domyślne EN.
    expect(email.subject).toBe("Confirm your email address");
    // Link idzie na NASZ callback z token_hash, nie na /auth/v1/verify GoTrue.
    expect(email.html).toContain(
      "/auth/confirm?token_hash=7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0&amp;type=email",
    );
    // Żadnego śladu dostawcy infrastruktury — po to jest całe zadanie.
    expect(email.html.toLowerCase()).not.toContain("supabase");
  });

  it("reset hasła: szablon password-reset i typ OTP recovery", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ action: "recovery", locale: "pl" })),
      { secret: SECRET, transport, now: NOW },
    );

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    // emailMessages("pl").passwordReset.heading
    expect(sent[0]!.subject).toBe("Ustaw nowe hasło");
    expect(sent[0]!.html).toContain("type=recovery");
  });

  it("język bierze się z user_metadata.locale, a obca wartość spada na domyślne", async () => {
    const { transport, sent } = captureTransport();
    await handleSendEmailHook(hookRequest(payloadFixture({ locale: "pl" })), {
      secret: SECRET,
      transport,
      now: NOW,
    });
    await handleSendEmailHook(hookRequest(payloadFixture({ locale: "klingon" })), {
      secret: SECRET,
      transport,
      now: NOW,
    });

    expect(sent[0]!.subject).toBe("Potwierdź adres e-mail");
    expect(sent[1]!.subject).toBe("Confirm your email address");
  });

  it("baza linku pochodzi z site_url payloadu, nie z zaszytej stałej", async () => {
    const { transport, sent } = captureTransport();
    await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: "https://app.avably.io" })),
      { secret: SECRET, transport, now: NOW },
    );
    expect(sent[0]!.html).toContain("https://app.avably.io/auth/confirm");
  });
});

describe("handleSendEmailHook — fail-closed", () => {
  it("żądanie BEZ podpisu jest odrzucone i NIE wysyła wiadomości", async () => {
    const { transport, sent } = captureTransport();
    const request = hookRequest(payloadFixture(), {
      headers: { "webhook-signature": "" },
    });
    request.headers.delete("webhook-signature");

    const response = await handleSendEmailHook(request, { secret: SECRET, transport, now: NOW });

    expect(response.status).toBe(401);
    // KLUCZOWA ASERCJA: zero prób wysyłki. Sam status przepuściłby wariant,
    // w którym wiadomość poszła, a odmowa wróciła dopiero potem.
    expect(sent).toHaveLength(0);
  });

  it("żądanie z PODROBIONYM podpisem jest odrzucone i NIE wysyła wiadomości", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(
      hookRequest(payloadFixture(), { secret: "v1,whsec_aW5ueS1zZWtyZXQtbmFwYXN0bmlrYQ==" }),
      { secret: SECRET, transport, now: NOW },
    );

    expect(response.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it("BRAK skonfigurowanego sekretu = odmowa, nigdy „przepuść w dev”", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: undefined,
      transport,
      now: NOW,
    });

    // 500, bo to brak konfiguracji po NASZEJ stronie — ale przede wszystkim:
    // nie 200 i zero wysyłki.
    expect(response.status).toBe(500);
    expect(response.status).not.toBe(200);
    expect(sent).toHaveLength(0);
  });

  it("nieudana wysyłka NIE udaje sukcesu (brak RESEND_API_KEY)", async () => {
    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport: failingTransport,
      now: NOW,
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { message: string } };
    // Powód musi dojechać do logów Auth — inaczej właściciel nie wie, DLACZEGO.
    expect(body.error.message).toContain("RESEND_API_KEY");
  });

  it("nieobsługiwany typ akcji: odmowa z jawnym powodem, zero wysyłki", async () => {
    const { transport, sent } = captureTransport();
    for (const action of ["magiclink", "email_change", "invite", "reauthentication"]) {
      const response = await handleSendEmailHook(
        hookRequest(payloadFixture({ action })),
        { secret: SECRET, transport, now: NOW },
      );
      expect(response.status).toBe(422);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toContain(action);
    }
    expect(sent).toHaveLength(0);
  });

  it("ciało niepasujące do kontraktu jest odrzucone bez wysyłki", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(hookRequest({ user: {}, email_data: {} }), {
      secret: SECRET,
      transport,
      now: NOW,
    });

    expect(response.status).toBe(400);
    expect(sent).toHaveLength(0);
  });
});
