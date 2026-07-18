/**
 * Uczciwa CZĘŚCIOWA PORAŻKA rejestracji hosta (ADR-046, wzorzec ADR-033/036).
 *
 * DOWÓD MUTACYJNY tego zadania: jeżeli ktoś sprawi, że błąd `addDomain`
 * PRZESTANIE być pochłaniany (np. zwęzi `catch` w registerDomainSafely albo
 * usunie go), testy „…nie rzuca…" w tym pliku zapłoną — a wraz z nimi test
 * akcji panelu „organizacja powstaje mimo awarii API domen". To jest bramka
 * pilnująca, że awaria cudzej usługi nie wywraca onboardingu.
 */
import { describe, expect, it } from "vitest";

import { VercelDomainsError } from "./api";
import { checkDomainSafely, registerDomainSafely } from "./registration";
import type { DomainStatus } from "./types";

const OK: DomainStatus = {
  host: "acme.avably.io",
  providerDomainId: "acme.avably.io",
  verified: true,
  requiredRecords: [],
};

function clientReturning(status: DomainStatus | null) {
  return {
    addDomain: async () => status as DomainStatus,
    getDomainStatus: async () => status,
  };
}

function clientThrowing(error: unknown) {
  return {
    addDomain: async (): Promise<DomainStatus> => {
      throw error;
    },
    getDomainStatus: async (): Promise<DomainStatus | null> => {
      throw error;
    },
  };
}

describe("registerDomainSafely", () => {
  it("sukces oddaje dane do zapisu w domains i CZYŚCI last_error", async () => {
    const result = await registerDomainSafely("acme.avably.io", { client: clientReturning(OK) });

    expect(result).toEqual({
      ok: true,
      providerDomainId: "acme.avably.io",
      verified: true,
      requiredRecords: [],
      error: null,
    });
  });

  it("odmowa dostawcy NIE RZUCA — wraca jako powód do zapisania i pokazania", async () => {
    const client = clientThrowing(new VercelDomainsError("Not authorized", 403, "forbidden"));

    const result = await registerDomainSafely("acme.avably.io", { client });

    expect(result.ok).toBe(false);
    expect(result.error, "porażka bez powodu byłaby ciszą, nie uczciwością").toBe("Not authorized");
    expect(result.providerDomainId).toBeNull();
  });

  // catch jest CELOWO szeroki: brak konfiguracji i błąd programistyczny w porcie
  // mają dać ten sam skutek co odmowa dostawcy — inaczej nieprzewidziany wyjątek
  // wracałby do wywracania onboardingu.
  it("dowolny wyjątek (nie tylko VercelDomainsError) też nie rzuca", async () => {
    const result = await registerDomainSafely("acme.avably.io", {
      client: clientThrowing(new TypeError("nieoczekiwany kształt odpowiedzi")),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("nieoczekiwany kształt");
  });

  it("brak konfiguracji (bez wstrzykniętego klienta) też jest opisaną porażką, nie wyjątkiem", async () => {
    const result = await registerDomainSafely("acme.avably.io", { config: {} });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("VERCEL_API_TOKEN");
  });

  it("bardzo długi komunikat dostawcy jest przycięty przed zapisem do bazy", async () => {
    const client = clientThrowing(new Error("x".repeat(5000)));
    const result = await registerDomainSafely("acme.avably.io", { client });

    expect(result.error?.length).toBe(500);
  });
});

describe("checkDomainSafely", () => {
  it("odzwierciedla werdykt dostawcy, nie własne domysły", async () => {
    const pending: DomainStatus = { ...OK, verified: false, host: "sklep.example.com" };
    const result = await checkDomainSafely("sklep.example.com", {
      client: clientReturning(pending),
    });

    expect(result.ok).toBe(true);
    expect(result.verified).toBe(false);
  });

  it("host spoza projektu to opisana porażka z poleceniem ponowienia, nie milczące czekanie na DNS", async () => {
    const result = await checkDomainSafely("sklep.example.com", { client: clientReturning(null) });

    expect(result.ok).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.error).toContain("ponów");
  });

  it("awaria dostawcy nie rzuca", async () => {
    const result = await checkDomainSafely("sklep.example.com", {
      client: clientThrowing(new VercelDomainsError("timeout")),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("timeout");
  });
});
