import { beforeEach, describe, expect, it, vi } from "vitest";

import { lookupGus } from "./gus";
import { lookupMfWhitelist } from "./mf";

vi.mock("./mf", () => ({ lookupMfWhitelist: vi.fn() }));
vi.mock("./gus", () => ({ lookupGus: vi.fn() }));

// Import PO mockach — moduł czyta referencje na czas wywołania, nie na czas importu.
const { lookupCompanyByNip } = await import("./lookup");

const mfMock = vi.mocked(lookupMfWhitelist);
const gusMock = vi.mocked(lookupGus);

describe("lookupCompanyByNip — hybryda MF→GUS (SPEC A)", () => {
  beforeEach(() => {
    mfMock.mockReset();
    gusMock.mockReset();
  });

  it("checksum zły → invalid_checksum, ZERO strzałów do MF/GUS (SPEC A.1)", async () => {
    const result = await lookupCompanyByNip("1234567890");
    expect(result).toEqual({ ok: false, reason: "invalid_checksum", message: "Nieprawidłowy NIP." });
    expect(mfMock).not.toHaveBeenCalled();
    expect(gusMock).not.toHaveBeenCalled();
  });

  it("MF znajduje firmę → wynik MF, GUS w ogóle nie wołany", async () => {
    mfMock.mockResolvedValue({
      ok: true,
      nip: "7740001454",
      legalName: "ORLEN SA",
      regon: "610188201",
      krs: "0000028860",
      address: { street: "Chemików 7", zip: "09-411", city: "Płock" },
      statusVat: "Czynny",
      source: "mf",
      fetchedAt: "2026-08-24",
      requestId: "abc",
    });

    const result = await lookupCompanyByNip("774-000-14-54");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("mf");
    expect(gusMock).not.toHaveBeenCalled();
  });

  it("MF subject:null (not_found) → GUS jako fallback, GUS znajduje", async () => {
    mfMock.mockResolvedValue({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
    gusMock.mockResolvedValue({
      ok: true,
      nip: "8121913614",
      legalName: "Jan Kowalski",
      regon: "360083330",
      krs: null,
      address: { street: "ul. Testowa 13", zip: "26-900", city: "Kozienice" },
      statusVat: null,
      source: "gus",
      fetchedAt: "2026-08-24",
      requestId: null,
    });

    const result = await lookupCompanyByNip("8121913614");
    expect(mfMock).toHaveBeenCalledTimes(1);
    expect(gusMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.source).toBe("gus");
  });

  it("MF i GUS oba mówią 'nie znaleziono' → not_found (żadna z prób nie fabrykuje danych)", async () => {
    mfMock.mockResolvedValue({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
    gusMock.mockResolvedValue({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });

    const result = await lookupCompanyByNip("1111111111");
    expect(result).toEqual({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
  });

  it("MF niedostępny (5xx/sieć) → unavailable NATYCHMIAST, GUS w ogóle NIE wołany", async () => {
    mfMock.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });

    const result = await lookupCompanyByNip("7740001454");
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });
    expect(gusMock).not.toHaveBeenCalled();
  });

  it("MF not_found, GUS niedostępny (np. brak klucza) → unavailable, nie udaje not_found", async () => {
    mfMock.mockResolvedValue({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
    gusMock.mockResolvedValue({
      ok: false,
      reason: "unavailable",
      message: "Rejestr GUS niedostępny (brak konfiguracji).",
    });

    const result = await lookupCompanyByNip("7740001454");
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr GUS niedostępny (brak konfiguracji).",
    });
  });
});
