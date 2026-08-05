/**
 * RDZEŃ AKCJI KONTAKTU (E4, ADR-095) — KAŻDA WARSTWA ANTYSPAMU Z OSOBNA.
 *
 * Warstwowa obrona ma jedną wadę: kiedy działa, wygląda tak samo, jak gdyby
 * działała TYLKO JEDNA z warstw. Dlatego każdy blok niżej zdejmuje wszystkie
 * warstwy poza badaną i pokazuje, że to WŁAŚNIE ona zatrzymała zgłoszenie —
 * a przy okazji, że wysyłka NIE ZOSTAŁA WYWOŁANA.
 *
 * Wysyłkę mierzymy ATRAPĄ TORU POCZTY (`send`), a nie tym, co zostało na
 * ekranie: „nie wysłaliśmy" to zdanie o wywołaniu, nie o widoku.
 *
 * Osobne zdanie ma CICHA AKCEPTACJA pułapki: bot ma dostać odpowiedź
 * nieodróżnialną od sukcesu i ani jednego e-maila. Test, który sprawdza tylko
 * status, przeszedłby także wtedy, gdyby spam jechał do skrzynki najemcy.
 */
import { structuredPresetFor, type ContactStructuredContent, type ContactSubmitInput } from "@avably/core/site";
import { describe, expect, it, vi } from "vitest";

import {
  CONTACT_RATE_LIMIT,
  submitContactCore,
  type ContactDeps,
  type ContactOutgoingMessage,
} from "@/lib/contact/core";

const SEKCJA = "11111111-1111-4111-8111-111111111111";

function sekcja(patch: Partial<ContactStructuredContent> = {}): ContactStructuredContent {
  const preset = structuredPresetFor("contact", "pl") as ContactStructuredContent;
  return {
    ...preset,
    items: [
      { kind: "email", value: "biuro@najemca.test" },
      { kind: "phone", value: "+48 512 345 678" },
    ],
    ...patch,
  } as ContactStructuredContent;
}

function wejscie(patch: Partial<ContactSubmitInput> = {}): ContactSubmitInput {
  return {
    sectionId: SEKCJA,
    ticket: "bilet",
    trap: "",
    name: "Anna Kowalska",
    email: "anna@przyklad.test",
    message: "Czy namiot 5x8 jest wolny w pierwszy weekend czerwca?",
    ...patch,
  };
}

/** Zależności ze WSZYSTKIMI bramkami otwartymi — test zamyka po jednej. */
function deps(patch: Partial<ContactDeps> = {}) {
  const send = vi.fn(async (_message: ContactOutgoingMessage) => ({ delivered: true }));
  const full: ContactDeps = {
    ip: "203.0.113.7",
    checkRateLimit: vi.fn(async () => ({ success: true })),
    verifyTicket: vi.fn(() => "ok" as const),
    loadSection: vi.fn(async () => sekcja()),
    verifyCaptcha: vi.fn(async () => ({ ok: true })),
    send,
    ...patch,
  };
  return { deps: full, send: (patch.send ?? send) as typeof send };
}

describe("ścieżka szczęśliwa", () => {
  it("wysyła na adres z TREŚCI sekcji i oddaje status wysłania", async () => {
    const { deps: d, send } = deps();
    const result = await submitContactCore(wejscie(), d);

    expect(result).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      to: "biuro@najemca.test",
      name: "Anna Kowalska",
      email: "anna@przyklad.test",
      message: "Czy namiot 5x8 jest wolny w pierwszy weekend czerwca?",
    });
  });

  it("ADRESATA NIE DA SIĘ PODAĆ Z KLIENTA — liczy się wyłącznie treść sekcji", async () => {
    const { deps: d, send } = deps();
    // Wejście udające pole adresata: kontrakt akcji go nie zna, a rdzeń nie
    // czyta niczego poza `sectionId`. Gdyby kiedyś zaczął — ten test padnie.
    await submitContactCore(
      { ...wejscie(), to: "napastnik@obcy.test" } as unknown as ContactSubmitInput,
      d,
    );
    expect(send.mock.calls[0]![0].to).toBe("biuro@najemca.test");
  });

  it("telefon jedzie TYLKO wtedy, gdy sekcja o niego pyta", async () => {
    const bez = deps({ loadSection: async () => sekcja({ askPhone: false }) });
    await submitContactCore(wejscie({ phone: "512 345 678" }), bez.deps);
    expect(bez.send.mock.calls[0]![0]).not.toHaveProperty("phone");

    const z = deps({ loadSection: async () => sekcja({ askPhone: true }) });
    await submitContactCore(wejscie({ phone: "512 345 678" }), z.deps);
    expect(z.send.mock.calls[0]![0]).toMatchObject({ phone: "512 345 678" });
  });
});

describe("warstwa 1: limit zgłoszeń", () => {
  it("odmowa limitu zatrzymuje zgłoszenie PRZED wszystkim innym", async () => {
    const loadSection = vi.fn(async () => sekcja());
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    const { deps: d, send } = deps({
      checkRateLimit: async () => ({ success: false }),
      loadSection,
      verifyCaptcha,
    });

    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "rate_limited" });
    expect(send).not.toHaveBeenCalled();
    // Limit jest bramką NAJTAŃSZĄ: za nią nie płacimy ani odczytem strony,
    // ani przelotem do weryfikatora CAPTCHY.
    expect(loadSection).not.toHaveBeenCalled();
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("klucz limitu jest per IP i per akcja (nie zjada budżetu checkoutu)", async () => {
    const checkRateLimit = vi.fn(async () => ({ success: true }));
    const { deps: d } = deps({ checkRateLimit });
    await submitContactCore(wejscie(), d);
    expect(checkRateLimit).toHaveBeenCalledWith("contact:ip:203.0.113.7", CONTACT_RATE_LIMIT);
  });
});

describe("warstwa 2: bilet (minimalny czas od renderu)", () => {
  it.each(["invalid", "too_fast", "too_old"] as const)(
    "werdykt %s = odmowa bez wysyłki",
    async (verdict) => {
      const { deps: d, send } = deps({ verifyTicket: () => verdict });
      expect(await submitContactCore(wejscie(), d)).toEqual({ status: "expired" });
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("bilet jest sprawdzany PRZED odczytem strony", async () => {
    const loadSection = vi.fn(async () => sekcja());
    const { deps: d } = deps({ verifyTicket: () => "invalid", loadSection });
    await submitContactCore(wejscie(), d);
    expect(loadSection).not.toHaveBeenCalled();
  });
});

describe("warstwa 3: pułapka (cicha akceptacja)", () => {
  it("wypełniona pułapka daje status SUKCESU i ZERO wysyłek", async () => {
    const { deps: d, send } = deps();
    const result = await submitContactCore(wejscie({ trap: "https://spam.przyklad.test" }), d);

    expect(result, "bot dostał inną odpowiedź niż człowiek").toEqual({ status: "sent" });
    expect(send, "spam pojechał do skrzynki najemcy").not.toHaveBeenCalled();
  });

  it("cicha akceptacja wychodzi PRZED walidacją — bot nie dostaje wskazówek", async () => {
    const { deps: d, send } = deps();
    // Zgłoszenie botowe bywa bezsensowne także w treści. Gdyby pułapka stała za
    // walidacją, bot dowiedziałby się, KTÓRE pole ma poprawić.
    const result = await submitContactCore(
      wejscie({ trap: "x", name: "", email: "nie-adres", message: "" }),
      d,
    );
    expect(result).toEqual({ status: "sent" });
    expect(send).not.toHaveBeenCalled();
  });

  it("pusta i biała pułapka to CZŁOWIEK — spacja nie może blokować wysyłki", async () => {
    const { deps: d, send } = deps();
    expect(await submitContactCore(wejscie({ trap: "   " }), d)).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("warstwa 4: CAPTCHA", () => {
  it("odmowa weryfikatora zatrzymuje wysyłkę (fail-closed)", async () => {
    const { deps: d, send } = deps({ verifyCaptcha: async () => ({ ok: false }) });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "captcha_failed" });
    expect(send).not.toHaveBeenCalled();
  });

  it("weryfikacja idzie PO walidacji — za literówkę nie płacimy przelotem", async () => {
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    const { deps: d } = deps({ verifyCaptcha });
    await submitContactCore(wejscie({ email: "anna-bez-malpy" }), d);
    expect(verifyCaptcha).not.toHaveBeenCalled();
  });

  it("token jedzie do weryfikatora bez zmian", async () => {
    const verifyCaptcha = vi.fn(async () => ({ ok: true }));
    const { deps: d } = deps({ verifyCaptcha });
    await submitContactCore(wejscie({ captchaToken: "token-z-widgetu" }), d);
    expect(verifyCaptcha).toHaveBeenCalledWith("token-z-widgetu");
  });
});

describe("sekcja bez adresata to STAN, nie awaria", () => {
  it("brak sekcji (skasowana po renderze) = niedostępne, bez wysyłki", async () => {
    const { deps: d, send } = deps({ loadSection: async () => null });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sekcja bez poprawnego e-maila = niedostępne", async () => {
    const { deps: d, send } = deps({
      loadSection: async () => sekcja({ items: [{ kind: "phone", value: "+48 512 345 678" }] } as Partial<ContactStructuredContent>),
    });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("wyłączony formularz w OPUBLIKOWANEJ treści zamyka też akcję", async () => {
    const { deps: d, send } = deps({ loadSection: async () => sekcja({ showForm: false }) });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("niedostępna poczta nie udaje sukcesu", async () => {
    const { deps: d } = deps({ send: vi.fn(async () => ({ delivered: false })) });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "unavailable" });
  });
});

describe("walidacja serwera jest OSTATNIM słowem", () => {
  it("wejście, które przeszłoby przeglądarkę bez JS-u, odpada z mapą pól", async () => {
    const { deps: d, send } = deps();
    const result = await submitContactCore(wejscie({ name: "", email: "nie-adres", message: "krótko" }), d);

    expect(result).toEqual({
      status: "validation_error",
      fields: { name: "required", email: "invalid", message: "required" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("wymóg telefonu bierze się z SEKCJI, nie z wejścia (nie da się go pominąć)", async () => {
    const { deps: d, send } = deps({ loadSection: async () => sekcja({ askPhone: true }) });
    // Bot po prostu nie przysyła pola, licząc, że wymóg zniknie razem z nim.
    const result = await submitContactCore(wejscie(), d);
    expect(result).toEqual({ status: "validation_error", fields: { phone: "required" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("awaria toru poczty to błąd serwera, a nie cichy sukces", async () => {
    const { deps: d } = deps({
      send: vi.fn(async (_message: ContactOutgoingMessage) => {
        throw new Error("resend padł");
      }),
    });
    expect(await submitContactCore(wejscie(), d)).toEqual({ status: "server_error" });
  });
});
