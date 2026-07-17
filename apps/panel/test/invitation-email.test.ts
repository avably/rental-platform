import { describe, expect, it } from "vitest";
import type { EmailTransport, OutgoingEmail, TenantSettingRow } from "@avably/core";

import { buildInvitationEmail, sendInvitationEmail } from "@/lib/email";

const base = {
  to: "nowy@example.com",
  acceptUrl: "https://www.avably.io/zaproszenie/abc123",
  locale: "pl" as const,
  organizationName: "Wypożyczalnia Demo",
  role: "staff" as const,
};

function captureTransport(): { transport: EmailTransport; sent: OutgoingEmail[] } {
  const sent: OutgoingEmail[] = [];
  return { transport: { send: async (e) => void sent.push(e) }, sent };
}

describe("buildInvitationEmail", () => {
  it("składa From z nazwy tenanta i adresu platformy oraz temat z 8a", async () => {
    const email = await buildInvitationEmail({ ...base, fromEmail: "noreply@send.avably.io" });
    expect(email.from).toBe("Wypożyczalnia Demo <noreply@send.avably.io>");
    expect(email.to).toBe("nowy@example.com");
    // emailMessages("pl").organizationInvitation.heading
    expect(email.subject).toBe("Zaproszenie do organizacji");
    expect(email.html).toContain("abc123");
    expect(email.text).toContain("abc123");
  });

  it("dokłada reply_to tylko gdy podany", async () => {
    const withReply = await buildInvitationEmail({ ...base, replyTo: "biuro@demo.pl" });
    expect(withReply.replyTo).toBe("biuro@demo.pl");
    const without = await buildInvitationEmail(base);
    expect(without.replyTo).toBeUndefined();
  });
});

describe("sendInvitationEmail", () => {
  const noSettings: TenantSettingRow[] = [];

  it("bez dostępności zwraca powód i NIE woła transportu", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base,
      settings: noSettings,
      transport,
      availability: {
        available: false,
        reason: "Wysyłka e-maili nie jest skonfigurowana (brak RESEND_API_KEY).",
      },
    });
    expect(reason).toMatch(/nie jest skonfigurowana/);
    expect(sent).toHaveLength(0);
  });

  it("przy dostępności wysyła i zwraca undefined; From ma nazwę tenanta", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base,
      settings: noSettings,
      transport,
      availability: { available: true },
      fromEmail: "noreply@send.avably.io",
    });
    expect(reason).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.from).toBe("Wypożyczalnia Demo <noreply@send.avably.io>");
  });

  it("czyta reply_to z email_sender, gdy ustawiony", async () => {
    const { transport, sent } = captureTransport();
    await sendInvitationEmail({
      ...base,
      transport,
      availability: { available: true },
      settings: [
        { key: "email_sender", value: { name: "X", reply_to: "biuro@demo.pl" } } as TenantSettingRow,
      ],
    });
    expect(sent[0]!.replyTo).toBe("biuro@demo.pl");
  });

  it("email_sender obecny, ale wadliwy → uczciwy powód, brak wysyłki", async () => {
    const { transport, sent } = captureTransport();
    const reason = await sendInvitationEmail({
      ...base,
      transport,
      availability: { available: true },
      settings: [
        { key: "email_sender", value: { name: "X", reply_to: 42 } } as unknown as TenantSettingRow,
      ],
    });
    expect(reason).toBeTruthy();
    expect(sent).toHaveLength(0);
  });

  it("błąd transportu → powód, nie wyjątek", async () => {
    const reason = await sendInvitationEmail({
      ...base,
      settings: noSettings,
      availability: { available: true },
      transport: {
        send: async () => {
          throw new Error("Dostawca odrzucił (HTTP 422).");
        },
      },
    });
    expect(reason).toMatch(/422/);
  });
});
