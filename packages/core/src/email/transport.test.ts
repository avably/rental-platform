import { afterEach, describe, expect, it, vi } from "vitest";

import { ROOT_DOMAIN, SENDING_DOMAIN } from "../brand";
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
    // U1 (audyt UX W3): powód czyta NAJEMCA — neutralne zdanie o stronie
    // platformy, bez nazwy zmiennej środowiskowej.
    expect(result.reason).toContain("niedostępna po stronie platformy");
    expect(result.reason).not.toContain("RESEND_API_KEY");
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

  // Kolejność źródeł adresu platformy (ADR-047). Bez jawnej konfiguracji ma
  // wyjść adres na ZWERYFIKOWANEJ domenie wysyłkowej — domyślna wartość nie
  // może gwarantować odmowy dostawcy. Jawny env nadal wygrywa, bo tylko on
  // pozwala zmienić adres bez wydawania nowej wersji kodu.
  describe("źródło adresu platformy", () => {
    const originalFrom = process.env.RESEND_FROM_EMAIL;
    afterEach(() => {
      if (originalFrom === undefined) delete process.env.RESEND_FROM_EMAIL;
      else process.env.RESEND_FROM_EMAIL = originalFrom;
    });

    it("bez RESEND_FROM_EMAIL bierze domyślną z domeny wysyłkowej", () => {
      delete process.env.RESEND_FROM_EMAIL;
      expect(platformFromAddress("Demo")).toBe(`Demo <noreply@${SENDING_DOMAIN}>`);
      expect(platformFromAddress("Demo").endsWith(`@${ROOT_DOMAIN}>`)).toBe(false);
    });

    it("jawny RESEND_FROM_EMAIL wygrywa nad domyślną", () => {
      process.env.RESEND_FROM_EMAIL = "Avably <onboarding@resend.dev>";
      expect(platformFromAddress("Demo")).toBe("Demo <onboarding@resend.dev>");
    });
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

  it("przenosi idempotency key do nagłówka, nie do JSON-u", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await transport.send({
      ...MESSAGE,
      idempotencyKey: "rental-contract/doc-1/attempt-1",
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers["Idempotency-Key"]).toBe("rental-contract/doc-1/attempt-1");
    expect(JSON.parse(init.body)).not.toHaveProperty("idempotencyKey");
  });

  it("dotychczasowa wiadomość nie dostaje nagłówka idempotencji", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await transport.send(MESSAGE);
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).not.toHaveProperty("Idempotency-Key");
  });

  it("załącznik bajtowy trafia do payloadu jako base64 z nazwą pliku", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    // Nagłówek PDF (%PDF) — realny kształt bajtów etykiety z API kurierskiego.
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    await transport.send({
      ...MESSAGE,
      attachments: [{ filename: "etykieta-GK1.pdf", content: bytes }],
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(init.body).attachments).toEqual([
      { filename: "etykieta-GK1.pdf", content: Buffer.from(bytes).toString("base64") },
    ]);
  });

  it("załącznik podany jako base64 przechodzi bez ponownego kodowania", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await transport.send({
      ...MESSAGE,
      attachments: [{ filename: "umowa.pdf", content: "JVBERg==" }],
    });

    const [, init] = fetchFn.mock.calls[0]!;
    expect(JSON.parse(init.body).attachments).toEqual([
      { filename: "umowa.pdf", content: "JVBERg==" },
    ]);
  });

  // REGRESJA dotychczasowych wołających: wiadomość bez załączników musi dawać
  // payload identyczny jak przed wprowadzeniem pola (Resend nie może dostać
  // attachments: undefined/[]).
  it("bez załączników payload nie ma pola attachments", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "1" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await transport.send(MESSAGE);
    await transport.send({ ...MESSAGE, attachments: [] });

    for (const call of fetchFn.mock.calls) {
      expect(JSON.parse(call[1].body)).not.toHaveProperty("attachments");
    }
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

  // Zadanie 2.8 / ADR-045: identyfikator wiadomości wraca do wołającego,
  // żeby trafił do historii wysyłek — to jedyny uchwyt do korelacji wpisu
  // z panelem dostawcy przy sporze „wysłaliśmy, a nie doszło".
  it("zwraca identyfikator wiadomości od dostawcy", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "b1c2d3e4" }) });
    const transport = resendTransport({
      apiKey: "re_test",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await expect(transport.send(MESSAGE)).resolves.toEqual({ id: "b1c2d3e4" });
  });

  // Odczyt identyfikatora jest NAJLEPSZYM STARANIEM: wysyłka JUŻ się udała
  // (HTTP 2xx), więc niesparsowalne albo nieoczekiwane ciało odpowiedzi nie
  // może jej przebrać w błąd — dałoby to operatorowi „nie wysłano" przy
  // wiadomości, która wyszła (ADR-033 zabrania kłamstwa w obie strony).
  it("odpowiedź bez id albo niesparsowalna → sukces z id null, nie wyjątek", async () => {
    const bodies = [
      async () => ({}),
      async () => {
        throw new Error("Unexpected token < in JSON");
      },
    ];
    for (const json of bodies) {
      const transport = resendTransport({
        apiKey: "re_test",
        fetchFn: vi.fn().mockResolvedValue({ ok: true, json }) as unknown as typeof fetch,
      });
      await expect(transport.send(MESSAGE)).resolves.toEqual({ id: null });
    }
  });
});
