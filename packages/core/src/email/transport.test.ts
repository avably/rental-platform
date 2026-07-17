import { describe, expect, it, vi } from "vitest";

import {
  EmailTransportError,
  emailAvailability,
  platformFromAddress,
  resendTransport,
} from "./transport";

const MESSAGE = {
  from: "Demo <noreply@avably.io>",
  to: "klient@example.com",
  subject: "Rezerwacja potwierdzona",
  html: "<p>x</p>",
  text: "x",
};

describe("emailAvailability", () => {
  // KLUCZOWA RÓŻNICA WOBEC TURNSTILE: brak klucza NIE przepuszcza po cichu.
  // Dev-skip Turnstile'a zwraca ok:true, bo brak CAPTCHY w dev jest
  // nieszkodliwy. Tu odpowiednikiem byłby cichy sukces — panel mówi
  // „wysłano", klient nie dostaje nic.
  it("brak klucza → niedostępna z czytelnym powodem", () => {
    const result = emailAvailability({ apiKey: undefined });
    expect(result.available).toBe(false);
    expect(result.reason).toContain("RESEND_API_KEY");
  });

  it("pusty klucz traktujemy jak brak", () => {
    expect(emailAvailability({ apiKey: "" }).available).toBe(false);
  });

  it("klucz ustawiony → dostępna, bez powodu", () => {
    expect(emailAvailability({ apiKey: "re_test" })).toEqual({ available: true });
  });

  // `in` zamiast `??`: jawne apiKey: undefined to decyzja wołającego i nie
  // może spaść na env procesu (wzorzec verifyTurnstile).
  it("jawne undefined nie spada na env procesu", () => {
    const previous = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_z_env";
    try {
      expect(emailAvailability({ apiKey: undefined }).available).toBe(false);
      expect(emailAvailability().available).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous;
    }
  });
});

describe("platformFromAddress", () => {
  it("wstawia nazwę tenanta przed adres platformy", () => {
    expect(
      platformFromAddress("Wypożyczalnia Demo", { fromEmail: "Avably <noreply@avably.io>" }),
    ).toBe("Wypożyczalnia Demo <noreply@avably.io>");
  });

  it("działa, gdy stała platformy jest gołym adresem", () => {
    expect(platformFromAddress("Demo", { fromEmail: "noreply@avably.io" })).toBe(
      "Demo <noreply@avably.io>",
    );
  });

  it("cudzysłowy w nazwie są escapowane (nie rozbijają nagłówka)", () => {
    expect(platformFromAddress('Sprzęt "Pro"', { fromEmail: "noreply@avably.io" })).toBe(
      '"Sprzęt \\"Pro\\"" <noreply@avably.io>',
    );
  });
});

describe("resendTransport", () => {
  it("bez klucza rzuca zamiast udawać wysyłkę", async () => {
    const fetchFn = vi.fn();
    const transport = resendTransport({
      apiKey: undefined,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(transport.send(MESSAGE)).rejects.toThrow(EmailTransportError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("wysyła przez API z kluczem w nagłówku", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await transport.send({ ...MESSAGE, replyTo: "kontakt@example.com" });

    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toMatchObject({
      to: ["klient@example.com"],
      reply_to: "kontakt@example.com",
      subject: "Rezerwacja potwierdzona",
      html: "<p>x</p>",
      text: "x",
    });
  });

  it("bez reply_to nie wysyła pola reply_to", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await transport.send(MESSAGE);
    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(init.body)).not.toHaveProperty("reply_to");
  });

  it("odmowa API → EmailTransportError, nigdy cichy sukces", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => '{"message":"domain not verified"}',
    });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(transport.send(MESSAGE)).rejects.toThrow(/422/);
  });

  // Awaria sieci nie może zniknąć w środku transportu — wołający musi
  // dostać powód, żeby pokazać go operatorowi.
  it("awaria sieci propaguje się do wołającego", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(transport.send(MESSAGE)).rejects.toThrow(/ECONNREFUSED/);
  });
});
