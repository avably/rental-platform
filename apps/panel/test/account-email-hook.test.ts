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
import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailTransport, OutgoingEmail } from "@avably/core";

import {
  handleSendEmailHook,
  hashRecipient,
  redactReason,
  type AccountEmailLogEntry,
  type AccountEmailLogSink,
} from "@/lib/account-email-hook";
import { signStandardWebhook } from "@/lib/standard-webhook";

const SECRET = "v1,whsec_c3VwZXItdGFqbnktc2VrcmV0LWhvb2th";
const NOW = new Date("2026-07-20T10:00:00.000Z");

/** Fixture z dokumentacji hooka, przycięty do pól, na których stoi wysyłka. */
function payloadFixture(overrides: {
  action?: string;
  locale?: unknown;
  email?: string;
  siteUrl?: string;
  /** Payload BEZ pola `site_url` — schemat ma je jako opcjonalne. */
  omitSiteUrl?: boolean;
  redirectTo?: string;
  /** Payload BEZ pola `redirect_to` — nie ma czego porównywać. */
  omitRedirectTo?: boolean;
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
      ...(overrides.omitRedirectTo
        ? {}
        : { redirect_to: overrides.redirectTo ?? "http://127.0.0.1:3000/" }),
      email_action_type: overrides.action ?? "signup",
      ...(overrides.omitSiteUrl
        ? {}
        : { site_url: overrides.siteUrl ?? "http://127.0.0.1:3000" }),
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

/**
 * Przechwytuje WSZYSTKIE kanały konsoli, nie tylko `warn`. Test „nic nie
 * loguje tokena" musi patrzeć na całe wyjście — inaczej przeciek przez
 * `console.log` w innym miejscu modułu przeszedłby niezauważony.
 */
function captureConsole(): { lines: string[]; warnings: string[]; restore: () => void } {
  const lines: string[] = [];
  const warnings: string[] = [];
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const spies = methods.map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      const line = args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" ");
      lines.push(line);
      if (method === "warn") warnings.push(line);
    }),
  );
  return { lines, warnings, restore: () => spies.forEach((spy) => spy.mockRestore()) };
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

});

/**
 * Baza linku (ADR-050). ODTWORZENIE AWARII Z PRODUKCJI: hook działał, mail
 * dochodził na naszym szablonie, a link prowadził na host projektu Supabase
 * (`https://<ref>.supabase.co/auth/confirm?...`) i oddawał „No API key found
 * in request". Kod ufał `email_data.site_url` jako źródłu prawdy o WŁASNYM
 * adresie — a to pole nie niesie Site URL z dashboardu.
 *
 * Wszystkie asercje na hoście czytają TREŚĆ WYSŁANEJ WIADOMOŚCI, nie wartość
 * zwracaną przez helper: mutant poprawiający bazę tylko w `callbackBaseUrl`,
 * a składający link do szablonu gdzie indziej, przeszedłby po cichu.
 */
describe("handleSendEmailHook — host linku pochodzi z naszej konfiguracji", () => {
  /** Dokładny kształt, który wyszedł na produkcji. */
  const SUPABASE_HOST = "https://abcdefghijklmnopqrst.supabase.co";
  /**
   * Faktyczna zawartość `email_data.site_url` zaobserwowana na produkcji: adres
   * API GoTrue, NIE nasz Site URL. Ta wartość nigdy nie będzie równa
   * `PANEL_URL` — bramka wycelowana w to pole ostrzegałaby zawsze.
   */
  const GOTRUE_API = `${SUPABASE_HOST}/auth/v1`;
  const PANEL_HOST = "https://app.avably.io";

  let consoleCapture: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    consoleCapture = captureConsole();
  });

  afterEach(() => {
    consoleCapture.restore();
    vi.unstubAllEnvs();
  });

  it("PRODUKCJA, rejestracja: obcy site_url NIE trafia do linku w wysłanej wiadomości", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();

    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: SUPABASE_HOST })),
      { secret: SECRET, transport, now: NOW },
    );

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain(`${PANEL_HOST}/auth/confirm`);
    expect(sent[0]!.html).not.toContain("supabase.co");
    expect(sent[0]!.text).toContain(`${PANEL_HOST}/auth/confirm`);
    expect(sent[0]!.text).not.toContain("supabase.co");
  });

  it("PRODUKCJA, reset hasła: ta sama gwarancja (obie ścieżki składają link tym samym helperem)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();

    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ action: "recovery", siteUrl: SUPABASE_HOST })),
      { secret: SECRET, transport, now: NOW },
    );

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.html).toContain(`${PANEL_HOST}/auth/confirm`);
    expect(sent[0]!.html).toContain("type=recovery");
    expect(sent[0]!.html).not.toContain("supabase.co");
    expect(sent[0]!.text).not.toContain("supabase.co");
  });

  it("poza produkcją baza zostaje na localhoście — dev i testy muszą trafiać we własny serwer", async () => {
    const { transport, sent } = captureTransport();

    await handleSendEmailHook(hookRequest(payloadFixture({ siteUrl: PANEL_HOST })), {
      secret: SECRET,
      transport,
      now: NOW,
    });

    expect(sent[0]!.html).toContain("http://127.0.0.1:3000/auth/confirm");
    // Kontrola negatywna: gdyby produkcyjna gałąź przeciekła do devu, lokalny
    // link potwierdzający prowadziłby na produkcję.
    expect(sent[0]!.html).not.toContain("app.avably.io/auth/confirm");
  });

  /**
   * NAJWAŻNIEJSZY TEST TEGO BLOKU. Odtwarza REALNY kształt produkcyjny: oba
   * pola naraz, każde z faktyczną zawartością. Bramka wycelowana w `site_url`
   * (stan sprzed poprawki) zapala tu ostrzeżenie o złej konfiguracji, mimo że
   * Site URL jest ustawiony POPRAWNIE — a ostrzeżenie, które zawsze kłamie,
   * uczy ignorować ostrzeżenia.
   *
   * Fixture MUSI nieść oba pola. Payload z samym `redirect_to` przechodziłby
   * dla obu wersji bramki (brak `site_url` = milczenie), więc nie odróżniałby
   * poprawki od stanu sprzed niej.
   */
  it("kształt produkcyjny (site_url = API GoTrue, redirect_to = nasz host) → CISZA", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();

    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: GOTRUE_API, redirectTo: PANEL_HOST })),
      { secret: SECRET, transport, now: NOW },
    );

    // Konfiguracja jest poprawna → zero ostrzeżeń. Zero, nie „mało".
    expect(consoleCapture.warnings).toHaveLength(0);
    expect(response.status).toBe(200);
    expect(sent[0]!.html).toContain(`${PANEL_HOST}/auth/confirm`);
  });

  it("KONTROLA NEGATYWNA: redirect_to na obcym hoście → ostrzeżenie IDZIE", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();
    const OBCY = "https://panel.przykladowa-literowka.pl";

    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: GOTRUE_API, redirectTo: `${OBCY}/pl` })),
      { secret: SECRET, transport, now: NOW },
    );

    // Bramka nadal łapie realną złą konfigurację — nie zamilkła na amen.
    expect(consoleCapture.warnings).toHaveLength(1);
    const warning = consoleCapture.warnings[0]!;
    // Nazwa pola — żeby nie zgadywać, KTÓRE ustawienie jest złe.
    expect(warning).toContain("email_data.redirect_to");
    // Komunikat kieruje do Site URL, bo to ono siedzi w tym polu.
    expect(warning).toContain("Site URL");
    // Host oczekiwany i host otrzymany.
    expect(warning).toContain(PANEL_HOST);
    expect(warning).toContain(OBCY);
    // Literówka w dashboardzie nie może kosztować rejestracji.
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it("kontrola pozytywna: redirect_to zgodny z PANEL_URL → zero logu, link identyczny", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const zgodny = captureTransport();
    const obcy = captureTransport();

    await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: GOTRUE_API, redirectTo: PANEL_HOST })),
      { secret: SECRET, transport: zgodny.transport, now: NOW },
    );

    expect(consoleCapture.warnings).toHaveLength(0);

    await handleSendEmailHook(
      hookRequest(payloadFixture({ siteUrl: SUPABASE_HOST, redirectTo: SUPABASE_HOST })),
      { secret: SECRET, transport: obcy.transport, now: NOW },
    );

    // Ten sam link mimo skrajnie różnych payloadów — host nie jest funkcją
    // wejścia. Gdyby był, te dwie wiadomości różniłyby się treścią.
    expect(zgodny.sent[0]!.html).toBe(obcy.sent[0]!.html);
    expect(zgodny.sent[0]!.text).toBe(obcy.sent[0]!.text);
  });

  it("ukośnik i ścieżka w redirect_to to NIE rozjazd (porównujemy originy)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport } = captureTransport();

    // GoTrue potrafi tu wstawić sam host, host z ukośnikiem albo ze ścieżką.
    for (const redirectTo of [PANEL_HOST, `${PANEL_HOST}/`, `${PANEL_HOST}/pl/rejestracja?x=1`]) {
      await handleSendEmailHook(hookRequest(payloadFixture({ redirectTo })), {
        secret: SECRET,
        transport,
        now: NOW,
      });
    }

    expect(consoleCapture.warnings).toHaveLength(0);
  });

  it("payload BEZ redirect_to: nie ma czego porównywać → zero logu, host poprawny", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();

    const response = await handleSendEmailHook(
      hookRequest(payloadFixture({ omitRedirectTo: true, siteUrl: GOTRUE_API })),
      { secret: SECRET, transport, now: NOW },
    );

    expect(response.status).toBe(200);
    expect(consoleCapture.warnings).toHaveLength(0);
    expect(sent[0]!.html).toContain(`${PANEL_HOST}/auth/confirm`);
  });

  it("nieparsowalny redirect_to: ślad idzie, ale bez podrobienia kolejnego wpisu w logu", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport, sent } = captureTransport();

    await handleSendEmailHook(
      hookRequest(payloadFixture({ redirectTo: "nie-adres\nWARN podrobiony wpis" })),
      { secret: SECRET, transport, now: NOW },
    );

    expect(consoleCapture.warnings).toHaveLength(1);
    // Znak nowej linii wychodzi ZACYTOWANY, więc nie rozbija wpisu na dwa.
    expect(consoleCapture.warnings[0]!).toContain("\\n");
    expect(consoleCapture.warnings[0]!).not.toContain("\n");
    expect(sent[0]!.html).toContain(`${PANEL_HOST}/auth/confirm`);
  });

  it("NIC nie loguje tokena ani token_hash", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { transport } = captureTransport();

    // Przez wszystkie ścieżki, które w ogóle logują: rozjazd, wartość
    // nieparsowalna, zgodność, brak pola, reset hasła.
    for (const overrides of [
      { siteUrl: GOTRUE_API, redirectTo: SUPABASE_HOST },
      { redirectTo: "nie-adres" },
      { siteUrl: GOTRUE_API, redirectTo: PANEL_HOST },
      { omitRedirectTo: true },
      { action: "recovery", redirectTo: SUPABASE_HOST },
    ]) {
      await handleSendEmailHook(hookRequest(payloadFixture(overrides)), {
        secret: SECRET,
        transport,
        now: NOW,
      });
    }

    expect(consoleCapture.lines.length).toBeGreaterThan(0);
    for (const line of consoleCapture.lines) {
      expect(line).not.toContain("7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0");
      expect(line).not.toContain("305805");
      expect(line.toLowerCase()).not.toContain("token_hash=");
    }
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

/**
 * Platformowy dziennik kont (ADR-054). Warstwa JEDNOSTKOWA: sink jest atrapą,
 * asercje patrzą na WPIS przekazany do sinka. Dowód, że wiersz LĄDUJE W BAZIE
 * (i z jakim statusem/powodem), niesie test integracyjny na żywym Supabase
 * (account-email-log-integration.test.ts) — brief wymaga tam odczytu z bazy.
 *
 * Adres w postaci jawnej i token NIE MAJĄ prawa znaleźć się w żadnym polu
 * wpisu: adresata pseudonimizuje recipient_hash (HMAC), a powód porażki jest
 * sanityzowany. Testy niżej pilnują obu granic — z kontrolą na FAŁSZYWY ZIELONY
 * (dekodujemy hash, nie ufamy samemu not.toContain — lekcja PR #75).
 */
function captureLogSink(): { sink: AccountEmailLogSink; entries: AccountEmailLogEntry[] } {
  const entries: AccountEmailLogEntry[] = [];
  return {
    sink: {
      record: async (entry) => {
        entries.push(entry);
      },
    },
    entries,
  };
}

const DEFAULT_EMAIL = "nowy@example.com";
const TOKEN_HASH = "7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0";

/** Rozłożenie hasha na możliwe reprezentacje tekstowe — do skanu prywatności. */
function decodedForms(hex: string): string[] {
  const bytes = Buffer.from(hex, "hex");
  return [hex, bytes.toString("latin1"), bytes.toString("utf8"), bytes.toString("base64")];
}

describe("dziennik kont — hashRecipient (pseudonim adresata, ADR-054 D2)", () => {
  it("jest HMAC-SHA256 kluczowanym sekretem, 64-hex, deterministycznym", () => {
    const hash = hashRecipient(DEFAULT_EMAIL, SECRET);
    const expected = createHmac("sha256", SECRET)
      .update(`account-email-log:v1:${DEFAULT_EMAIL}`)
      .digest("hex");
    expect(hash).toBe(expected);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecipient(DEFAULT_EMAIL, SECRET)).toBe(hash); // deterministyczny
  });

  it("normalizuje adres (lower+trim) — ten sam wiersz mimo różnic zapisu", () => {
    expect(hashRecipient("  NOWY@Example.com ", SECRET)).toBe(hashRecipient(DEFAULT_EMAIL, SECRET));
  });

  it("jest kluczowany — inny sekret daje inny hash (goły SHA-256 by nie zależał od klucza)", () => {
    expect(hashRecipient(DEFAULT_EMAIL, "v1,whsec_aW5ueQ==")).not.toBe(
      hashRecipient(DEFAULT_EMAIL, SECRET),
    );
  });

  it("NIE jest odwracalny przez dekodowanie: żadna postać hasha nie zawiera adresu", () => {
    const hash = hashRecipient(DEFAULT_EMAIL, SECRET);
    for (const form of decodedForms(hash)) {
      expect(form).not.toContain(DEFAULT_EMAIL);
      expect(form).not.toContain("nowy"); // nawet część lokalna
    }
  });
});

describe("dziennik kont — redactReason (sanityzacja powodu, ADR-054 D2)", () => {
  it("usuwa adres i token_hash, zostawia diagnozę", () => {
    const raw = `Resend odrzucił adres ${DEFAULT_EMAIL} z linkiem token_hash=${TOKEN_HASH} (422)`;
    const out = redactReason(raw, [DEFAULT_EMAIL, DEFAULT_EMAIL.toLowerCase(), TOKEN_HASH]);
    expect(out).not.toContain(DEFAULT_EMAIL);
    expect(out).not.toContain(TOKEN_HASH);
    expect(out).toContain("Resend odrzucił"); // powód diagnostyczny przetrwał
    expect(out).toContain("422");
  });

  it("tnie zbyt długi powód do limitu kolumny (2000)", () => {
    const out = redactReason("x".repeat(5000), []);
    expect(out.length).toBeLessThanOrEqual(2000);
    expect(out.endsWith("...")).toBe(true);
  });

  it("pusty komunikat nie daje pustego powodu (CHECK failed→reason wymaga treści)", () => {
    expect(redactReason("", []).length).toBeGreaterThan(0);
  });
});

describe("handleSendEmailHook — zapis do dziennika kont (ADR-054)", () => {
  it("KONTROLA POZYTYWNA (c): udana rejestracja → wpis sent, bez powodu, hash zamiast adresu", async () => {
    const { transport } = captureTransport();
    const { sink, entries } = captureLogSink();

    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport,
      logSink: sink,
      now: NOW,
    });

    expect(response.status).toBe(200);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.action).toBe("signup");
    expect(entry.status).toBe("sent");
    expect(entry.reason).toBeNull();
    expect(entry.recipientHash).toBe(hashRecipient(DEFAULT_EMAIL, SECRET));
    // Adres NIE występuje w żadnej postaci wpisu — także po zdekodowaniu hasha.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(DEFAULT_EMAIL);
    for (const form of decodedForms(entry.recipientHash)) expect(form).not.toContain(DEFAULT_EMAIL);
  });

  it("udany reset hasła → wpis recovery/sent", async () => {
    const { transport } = captureTransport();
    const { sink, entries } = captureLogSink();

    await handleSendEmailHook(hookRequest(payloadFixture({ action: "recovery" })), {
      secret: SECRET,
      transport,
      logSink: sink,
      now: NOW,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe("recovery");
    expect(entries[0]!.status).toBe("sent");
  });

  it("PORAŻKA (a, warstwa jednostkowa): nieudana wysyłka → wpis failed z powodem", async () => {
    const { sink, entries } = captureLogSink();

    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport: failingTransport,
      logSink: sink,
      now: NOW,
    });

    expect(response.status).toBe(500);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("failed");
    expect((entries[0]!.reason ?? "").length).toBeGreaterThan(0);
    expect(entries[0]!.reason).toContain("RESEND_API_KEY");
  });

  it("PRYWATNOŚĆ (b): powód porażki niosący adres jest SANITYZOWANY, token nigdzie", async () => {
    // Transport, którego komunikat CELOWO niesie adres odbiorcy — realny wektor
    // wycieku (dostawcy wplatają adres w treść błędu). Wpis nie może go nieść.
    const leakyTransport: EmailTransport = {
      send: async (email) => {
        throw new Error(`Provider 422: odbiorca ${email.to} odrzucony przy token_hash=${TOKEN_HASH}`);
      },
    };
    const { sink, entries } = captureLogSink();

    await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport: leakyTransport,
      logSink: sink,
      now: NOW,
    });

    expect(entries).toHaveLength(1);
    const serialized = JSON.stringify(entries[0]!);
    // Ani adres, ani token/token_hash — także w zdekodowanym hashu.
    expect(serialized).not.toContain(DEFAULT_EMAIL);
    expect(serialized).not.toContain(TOKEN_HASH);
    expect(serialized).not.toContain("305805"); // token OTP z fixture
    for (const form of decodedForms(entries[0]!.recipientHash)) {
      expect(form).not.toContain(DEFAULT_EMAIL);
    }
    // Diagnoza mimo redakcji przetrwała.
    expect(entries[0]!.reason).toContain("Provider 422");
  });

  it("ADR-033/D4: awaria dziennika NIE wywraca wysyłki (sukces nadal 200)", async () => {
    const { transport, sent } = captureTransport();
    const throwingSink: AccountEmailLogSink = {
      record: async () => {
        throw new Error("baza dziennika niedostępna");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport,
      logSink: throwingSink,
      now: NOW,
    });

    // Mail poszedł, hook zwrócił sukces mimo padniętego dziennika.
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    warn.mockRestore();
  });

  it("ADR-033/D4: awaria dziennika przy PORAŻCE wysyłki nie zmienia kodu (nadal 500)", async () => {
    const throwingSink: AccountEmailLogSink = {
      record: async () => {
        throw new Error("baza dziennika niedostępna");
      },
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport: failingTransport,
      logSink: throwingSink,
      now: NOW,
    });

    expect(response.status).toBe(500);
    warn.mockRestore();
  });

  it("brak sinka = wysyłka bez logu (ścieżka dev), status niezmieniony", async () => {
    const { transport, sent } = captureTransport();
    const response = await handleSendEmailHook(hookRequest(payloadFixture()), {
      secret: SECRET,
      transport,
      now: NOW,
    });
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});
