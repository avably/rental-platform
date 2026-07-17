import { describe, expect, it } from "vitest";

import { EmailConfigError, emailSenderFromSettings } from "./tenant-config";

describe("emailSenderFromSettings", () => {
  it("czyta nazwę i reply_to (snake_case → camelCase)", () => {
    const sender = emailSenderFromSettings([
      {
        key: "email_sender",
        value: { name: "Wypożyczalnia Demo", reply_to: "kontakt@example.com" },
      },
    ]);
    expect(sender).toEqual({ name: "Wypożyczalnia Demo", replyTo: "kontakt@example.com" });
  });

  it("reply_to jest opcjonalne", () => {
    const sender = emailSenderFromSettings([{ key: "email_sender", value: { name: "Demo" } }]);
    expect(sender).toEqual({ name: "Demo" });
  });

  it("pomija nieswoje klucze tenant_settings", () => {
    const sender = emailSenderFromSettings([
      { key: "currency", value: "PLN" },
      { key: "email_sender", value: { name: "Demo" } },
    ]);
    expect(sender).toEqual({ name: "Demo" });
  });

  // ZERO CICHYCH FALLBACKÓW: brak ustawienia to błąd konfiguracji, nie
  // podstawienie nazwy platformy — klient dostałby wiadomość od obcej marki.
  it("brak klucza → EmailConfigError z czytelnym brakiem", () => {
    expect(() => emailSenderFromSettings([])).toThrow(EmailConfigError);
    try {
      emailSenderFromSettings([]);
      expect.unreachable("powinno rzucić");
    } catch (err) {
      expect((err as EmailConfigError).problems.join(" ")).toContain("nazwy nadawcy");
    }
  });

  it("pusta nazwa → EmailConfigError", () => {
    expect(() => emailSenderFromSettings([{ key: "email_sender", value: { name: "  " } }])).toThrow(
      EmailConfigError,
    );
  });

  it("nazwa złego typu → EmailConfigError", () => {
    expect(() => emailSenderFromSettings([{ key: "email_sender", value: { name: 42 } }])).toThrow(
      EmailConfigError,
    );
  });

  it("reply_to złego typu → EmailConfigError z osobnym brakiem", () => {
    try {
      emailSenderFromSettings([{ key: "email_sender", value: { name: "Demo", reply_to: 42 } }]);
      expect.unreachable("powinno rzucić");
    } catch (err) {
      expect((err as EmailConfigError).problems.join(" ")).toContain("adres odpowiedzi");
    }
  });

  it("przycina białe znaki w nazwie i reply_to", () => {
    const sender = emailSenderFromSettings([
      { key: "email_sender", value: { name: "  Demo  ", reply_to: "  a@b.pl  " } },
    ]);
    expect(sender).toEqual({ name: "Demo", replyTo: "a@b.pl" });
  });
});
