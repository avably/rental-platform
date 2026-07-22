/**
 * Testy KONTRAKTU akcji waitlisty (apps/storefront/lib/waitlist/contract.ts).
 *
 * Rdzeń dostaje zależności przez parametr, więc te testy nie potrzebują ani
 * `next/headers`, ani bazy — sprawdzają wyłącznie to, co obiecuje kontrakt
 * sesji frontowej: który wariant statusu wraca i kiedy.
 *
 * Ścieżka „naprawdę zapisuje do bazy" jest sprawdzana osobno, na żywym
 * Supabase — patrz test/waitlist-integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isWaitlistEnabled, joinWaitlistCore, type WaitlistDeps } from "@/lib/waitlist/core";

const VALID_INPUT = {
  email: "ktos@example.com",
  rentalType: "event",
  inventoryRange: "r21_100",
  currentProcess: "calendar_spreadsheet",
  consent: true,
} as const;

function deps(overrides: Partial<WaitlistDeps> = {}): WaitlistDeps {
  return {
    enabled: true,
    ip: "203.0.113.7",
    checkRateLimit: vi.fn(async () => ({ success: true })),
    callRpc: vi.fn(async () => "success" as const),
    verifyCaptcha: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

describe("kill-switch (WAITLIST_ENABLED)", () => {
  it("domyślnie WYŁĄCZONY — brak zmiennej znaczy brak zapisów", () => {
    expect(isWaitlistEnabled({})).toBe(false);
  });

  it.each(["", "false", "1", "yes", "TRUE", "true "])(
    "wartość %j NIE włącza formularza (włączenie musi być świadome)",
    (value) => {
      expect(isWaitlistEnabled({ WAITLIST_ENABLED: value })).toBe(false);
    },
  );

  it("dokładnie 'true' włącza formularz", () => {
    expect(isWaitlistEnabled({ WAITLIST_ENABLED: "true" })).toBe(true);
  });

  it("wyłączony formularz zwraca disabled i NIE dotyka bazy", async () => {
    const d = deps({ enabled: false });
    const result = await joinWaitlistCore(VALID_INPUT, d);

    expect(result).toEqual({ status: "disabled" });
    // Bramka prawna: dopóki nie ma polityki prywatności, żaden realny zapis
    // nie może zostać przyjęty — także dla poprawnego wejścia.
    expect(d.callRpc, "wyłączony formularz uderzył w bazę").not.toHaveBeenCalled();
  });

  it("wyłączony formularz odpowiada disabled nawet przy błędnym wejściu", async () => {
    // Kill-switch stoi PRZED walidacją: dane osobowe nie wchodzą głębiej,
    // a odpowiedź nie zdradza, co formularz by zwalidował.
    const result = await joinWaitlistCore({ email: "nie-email" }, deps({ enabled: false }));
    expect(result).toEqual({ status: "disabled" });
  });
});

describe("rate-limit", () => {
  it("przekroczony limit zwraca rate_limited i NIE dotyka bazy", async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => ({ success: false })) });
    const result = await joinWaitlistCore(VALID_INPUT, d);

    expect(result).toEqual({ status: "rate_limited" });
    expect(d.callRpc).not.toHaveBeenCalled();
  });

  it("limit jest liczony per IP", async () => {
    const checkRateLimit = vi.fn(async () => ({ success: true }));
    await joinWaitlistCore(VALID_INPUT, deps({ ip: "198.51.100.9", checkRateLimit }));

    expect(checkRateLimit).toHaveBeenCalledWith(
      "waitlist:ip:198.51.100.9",
      expect.objectContaining({ limit: expect.any(Number), windowSeconds: expect.any(Number) }),
    );
  });

  it("limit obowiązuje także wejście niepoprawne (parser jest ZA bramką)", async () => {
    const d = deps({ checkRateLimit: vi.fn(async () => ({ success: false })) });
    const result = await joinWaitlistCore({ email: "nie-email" }, d);
    expect(result).toEqual({ status: "rate_limited" });
  });
});

describe("walidacja — mapa pole→błąd", () => {
  async function fieldsFor(input: unknown): Promise<Record<string, string>> {
    const result = await joinWaitlistCore(input, deps());
    expect(result.status, `oczekiwano validation_error, dostano ${result.status}`).toBe(
      "validation_error",
    );
    return (result as { fields: Record<string, string> }).fields;
  }

  it("zgoda jest warunkiem zapisu — consent=false nigdy nie zapisuje", async () => {
    const d = deps();
    const result = await joinWaitlistCore({ ...VALID_INPUT, consent: false }, d);

    expect(result).toEqual({ status: "validation_error", fields: { consent: "required" } });
    expect(d.callRpc, "zapis bez zgody dotarł do bazy").not.toHaveBeenCalled();
  });

  it("brak zgody (pole pominięte) też jest validation_error", async () => {
    const { consent: _consent, ...withoutConsent } = VALID_INPUT;
    expect(await fieldsFor(withoutConsent)).toEqual({ consent: "required" });
  });

  it.each([
    ["pusty", ""],
    ["bez @", "ktos.example.com"],
    ["bez domeny", "ktos@"],
  ])("e-mail %s → invalid/required", async (_label, email) => {
    const fields = await fieldsFor({ ...VALID_INPUT, email });
    expect(fields.email, "e-mail nie został odrzucony").toBeDefined();
  });

  /*
    Recenzja PM przy zod 4: mapowanie `invalid_type` rozróżnia brak pola
    (required) od złego typu (invalid), ale żaden test nie przypinał WYNIKU
    tego rozróżnienia — degradacja required→invalid przechodziła suitę na
    zielono (test wyżej sprawdza tylko OBECNOŚĆ błędu). Dokładny klucz jest
    komunikatem dla użytkownika, więc pilnujemy go wprost.
  */
  it("brak e-maila (undefined) → dokładnie required, nie invalid", async () => {
    const { email: _omitted, ...withoutEmail } = VALID_INPUT;
    const fields = await fieldsFor(withoutEmail);
    expect(fields).toEqual({ email: "required" });
  });

  it.each([
    ["rentalType", "traktory"],
    ["inventoryRange", "r9000"],
    ["currentProcess", "telepatia"],
  ])("%s spoza zbioru → invalid", async (field, value) => {
    const fields = await fieldsFor({ ...VALID_INPUT, [field]: value });
    expect(fields[field]).toBe("invalid");
  });

  it("rentalType='other' bez doprecyzowania → otherEquipment required", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, rentalType: "other" });
    expect(fields).toEqual({ otherEquipment: "required" });
  });

  it("rentalType='other' z pustym doprecyzowaniem → required (spacje to nie treść)", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, rentalType: "other", otherEquipment: "   " });
    expect(fields).toEqual({ otherEquipment: "required" });
  });

  it("doprecyzowanie przy typie innym niż 'other' → not_allowed", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, rentalType: "event", otherEquipment: "rusztowania" });
    expect(fields).toEqual({ otherEquipment: "not_allowed" });
  });

  it("za długie doprecyzowanie → too_long", async () => {
    const fields = await fieldsFor({
      ...VALID_INPUT,
      rentalType: "other",
      otherEquipment: "x".repeat(501),
    });
    expect(fields).toEqual({ otherEquipment: "too_long" });
  });

  it("telefon bez zgłoszenia do pilotażu → not_allowed", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, phone: "600100200" });
    expect(fields).toEqual({ phone: "not_allowed" });
  });

  it("telefon przy pilot_interest=false podanym jawnie → not_allowed", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, phone: "600100200", pilotInterest: false });
    expect(fields).toEqual({ phone: "not_allowed" });
  });

  it("locale spoza zbioru → invalid", async () => {
    const fields = await fieldsFor({ ...VALID_INPUT, locale: "de" });
    expect(fields.locale).toBe("invalid");
  });

  it("mapa zbiera błędy z wielu pól naraz", async () => {
    const fields = await fieldsFor({
      ...VALID_INPUT,
      email: "nie-email",
      rentalType: "traktory",
      consent: false,
    });
    expect(Object.keys(fields).sort()).toEqual(["consent", "email", "rentalType"]);
  });
});

describe("bramka captcha (Turnstile)", () => {
  it("odmowa weryfikatora → captcha_failed i dane NIE schodzą do bazy", async () => {
    const d = deps({ verifyCaptcha: vi.fn(async () => ({ ok: false })) });
    const result = await joinWaitlistCore({ ...VALID_INPUT, captchaToken: "zly" }, d);

    expect(result).toEqual({ status: "captcha_failed" });
    expect(d.callRpc, "odrzucona captcha dotarła do bazy").not.toHaveBeenCalled();
  });

  it("weryfikator dostaje token z wejścia", async () => {
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    await joinWaitlistCore({ ...VALID_INPUT, captchaToken: "tok-42" }, deps({ verifyCaptcha }));

    expect(verifyCaptcha).toHaveBeenCalledWith("tok-42");
  });

  it("captcha stoi ZA walidacją — błędne wejście nie woła weryfikatora", async () => {
    // Kolejność z punktu wpięcia w core.ts: walidacja → captcha → zapis.
    // Odwrotnie siteverify byłby wołany dla śmieciowego wejścia (koszt +
    // sygnał do Cloudflare), a mapa błędów walidacji byłaby maskowana
    // odmową captchy.
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    await joinWaitlistCore({ email: "nie-email" }, deps({ verifyCaptcha }));

    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("captcha_failed nie niesie danych osobowych", async () => {
    const result = await joinWaitlistCore(
      { ...VALID_INPUT, pilotInterest: true, phone: "600100200" },
      deps({ verifyCaptcha: vi.fn(async () => ({ ok: false })) }),
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ktos@example.com");
    expect(serialized).not.toContain("600100200");
  });
});

describe("ścieżka zapisu", () => {
  it("poprawne wejście → success", async () => {
    expect(await joinWaitlistCore(VALID_INPUT, deps())).toEqual({ status: "success" });
  });

  it("konflikt na unikalnym indeksie → duplicate", async () => {
    const d = deps({ callRpc: vi.fn(async () => "duplicate" as const) });
    expect(await joinWaitlistCore(VALID_INPUT, d)).toEqual({ status: "duplicate" });
  });

  it("błąd bazy → server_error, bez wycieku szczegółów", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      callRpc: vi.fn(async () => {
        throw new Error("null value in column \"email\" violates ... ktos@example.com");
      }),
    });

    const result = await joinWaitlistCore(VALID_INPUT, d);

    expect(result).toEqual({ status: "server_error" });
    expect(JSON.stringify(result), "treść błędu bazy wyciekła do klienta").not.toContain(
      "ktos@example.com",
    );
    consoleError.mockRestore();
  });

  it("pola opcjonalne przechodzą do RPC znormalizowane (puste → null)", async () => {
    const callRpc = vi.fn(async () => "success" as const);
    await joinWaitlistCore(
      { ...VALID_INPUT, source: "  newsletter  ", campaign: "", pilotInterest: true, phone: " 600100200 " },
      deps({ callRpc }),
    );

    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        p_source: "newsletter",
        p_campaign: null,
        p_other_equipment: null,
        p_pilot_interest: true,
        p_phone: "600100200",
        p_locale: "pl",
      }),
    );
  });

  it("e-mail NIE jest normalizowany w schemacie — deduplikacja należy do bazy", async () => {
    // Gdyby schemat robił toLowerCase(), unikalny indeks po lower(email)
    // przestałby być testowaną bramką, a deduplikacja zależałaby od warstwy,
    // którą da się ominąć (RPC wołane spoza akcji).
    const callRpc = vi.fn(async () => "success" as const);
    await joinWaitlistCore({ ...VALID_INPUT, email: "KtoS@Example.COM" }, deps({ callRpc }));

    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ p_email: "KtoS@Example.COM" }));
  });
});

describe("kontrakt: żadnych danych osobowych w odpowiedzi", () => {
  const cases: Array<[string, WaitlistDeps]> = [
    ["success", deps()],
    ["duplicate", deps({ callRpc: vi.fn(async () => "duplicate" as const) })],
    ["rate_limited", deps({ checkRateLimit: vi.fn(async () => ({ success: false })) })],
    ["disabled", deps({ enabled: false })],
  ];

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it.each(cases)("status %s nie niesie e-maila ani telefonu", async (_label, d) => {
    const result = await joinWaitlistCore(
      { ...VALID_INPUT, pilotInterest: true, phone: "600100200" },
      d,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("ktos@example.com");
    expect(serialized).not.toContain("600100200");
  });
});
