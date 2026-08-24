import { afterEach, describe, expect, it, vi } from "vitest";

import { lookupMfWhitelist, mfWhitelistBaseUrl, parseMfAddress, todayDateParam } from "./mf";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("todayDateParam", () => {
  it("formatuje datę jako YYYY-MM-DD", () => {
    expect(todayDateParam(new Date("2026-08-24T10:00:00Z"))).toBe("2026-08-24");
  });

  it("dopełnia zerami miesiąc i dzień", () => {
    expect(todayDateParam(new Date("2026-01-05T00:00:00Z"))).toBe("2026-01-05");
  });
});

describe("parseMfAddress", () => {
  it("rozbija realny adres MF (zweryfikowany na żywo, PKN ORLEN)", () => {
    expect(parseMfAddress("CHEMIKÓW 7, 09-411 PŁOCK")).toEqual({
      street: "CHEMIKÓW 7",
      zip: "09-411",
      city: "PŁOCK",
    });
  });

  it("bez przecinka — cały string jako ulica, reszta pusta", () => {
    expect(parseMfAddress("COŚ NIETYPOWEGO")).toEqual({ street: "COŚ NIETYPOWEGO", zip: "", city: "" });
  });

  it("bez rozpoznawalnego kodu pocztowego — reszta trafia w city", () => {
    expect(parseMfAddress("ULICA 1, ZAGRANICA")).toEqual({ street: "ULICA 1", zip: "", city: "ZAGRANICA" });
  });
});

describe("mfWhitelistBaseUrl", () => {
  afterEach(() => {
    delete process.env.MF_WHITELIST_BASE_URL;
  });

  it("domyślnie prod", () => {
    delete process.env.MF_WHITELIST_BASE_URL;
    expect(mfWhitelistBaseUrl()).toBe("https://wl-api.mf.gov.pl");
  });

  it("env nadpisuje na test (wl-test)", () => {
    process.env.MF_WHITELIST_BASE_URL = "https://wl-test.mf.gov.pl";
    expect(mfWhitelistBaseUrl()).toBe("https://wl-test.mf.gov.pl");
  });
});

describe("lookupMfWhitelist", () => {
  it("firma znaleziona — zwraca dane + requestId (dowód zapytania)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        result: {
          subject: {
            name: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
            nip: "7740001454",
            statusVat: "Czynny",
            regon: "610188201",
            krs: "0000028860",
            residenceAddress: null,
            workingAddress: "CHEMIKÓW 7, 09-411 PŁOCK",
          },
          requestId: "HiRCJ-98bk89g",
          requestDateTime: "24-08-2026 10:03:52",
        },
      }),
    );

    const result = await lookupMfWhitelist("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: true,
      nip: "7740001454",
      legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
      regon: "610188201",
      krs: "0000028860",
      address: { street: "CHEMIKÓW 7", zip: "09-411", city: "PŁOCK" },
      statusVat: "Czynny",
      source: "mf",
      fetchedAt: "24-08-2026 10:03:52",
      requestId: "HiRCJ-98bk89g",
    });

    const calledUrl = fetchFn.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("/api/search/nip/7740001454?date=");
  });

  it("subject:null → not_found (kandydat do fallbacku GUS)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({ result: { subject: null, requestId: "x", requestDateTime: "x" } }),
    );
    const result = await lookupMfWhitelist("1111111111", { fetchFn });
    expect(result).toEqual({
      ok: false,
      reason: "not_found",
      message: "Nie znaleźliśmy firmy o tym NIP.",
    });
  });

  it("HTTP nie-2xx → unavailable, NIE not_found (rozróżnienie SPEC A.5)", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ code: "WL-118", message: "błąd" }, 400));
    const result = await lookupMfWhitelist("7740001454", { fetchFn });
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("unavailable");
  });

  it("błąd transportu (fetch rzuca) → unavailable, nie wywala się", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await lookupMfWhitelist("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });
  });

  it("niespodziewany kształt JSON → unavailable, nie fabrykuje danych", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ foo: "bar" }));
    const result = await lookupMfWhitelist("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });
  });
});
