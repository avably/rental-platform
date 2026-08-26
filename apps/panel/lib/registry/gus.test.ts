import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GUS_TEST_USER_KEY, __resetGusSidCacheForTests, gusBaseUrl, gusUserKey, lookupGus } from "./gus";

/** Owija fragment SOAP body w kopertę MTOM/multipart — kształt zweryfikowany na żywo. */
function mtomEnvelope(bodyInner: string): string {
  return (
    `\n--b\nContent-ID: <http://tempuri.org/0>\nContent-Transfer-Encoding: 8bit\n` +
    `Content-Type: application/xop+xml;charset=utf-8;type="application/soap+xml"\n\n` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body>${bodyInner}</s:Body></s:Envelope>\n--b--`
  );
}

function xmlResp(body: string): Response {
  return new Response(body, { status: 200, headers: { "Content-Type": "multipart/related" } });
}

/** Escapuje `<`/`>`/`&` — GUS wysyła wynik operacji jako encje XML w XML-u. */
function xmlEscape(inner: string): string {
  return inner.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// FUNKCJE, nie stałe: `Response.text()` czyta ciało JEDNORAZOWO — współdzielony
// obiekt Response pomiędzy wywołaniami mocka rzuca "Body has already been read".
function loginResponse(): Response {
  return xmlResp(
    mtomEnvelope(`<ZalogujResponse xmlns="http://CIS/BIR/PUBL/2014/07"><ZalogujResult>sid-abc-123</ZalogujResult></ZalogujResponse>`),
  );
}

function invalidSidSearchResponse(): Response {
  return xmlResp(
    mtomEnvelope(
      `<DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DaneSzukajPodmiotyResult/></DaneSzukajPodmiotyResponse>`,
    ),
  );
}

function searchFoundResponse(opts: { regon: string; typ: "P" | "F"; silosId: string; nazwa: string }): Response {
  const inner = `<root><dane><Regon>${opts.regon}</Regon><Typ>${opts.typ}</Typ><SilosID>${opts.silosId}</SilosID><Nazwa>${opts.nazwa}</Nazwa></dane></root>`;
  return xmlResp(
    mtomEnvelope(
      `<DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DaneSzukajPodmiotyResult>${xmlEscape(inner)}</DaneSzukajPodmiotyResult></DaneSzukajPodmiotyResponse>`,
    ),
  );
}

function searchNotFoundResponse(): Response {
  const inner = `<root><dane><ErrorCode>4</ErrorCode><ErrorMessagePl>Nie znaleziono podmiotu.</ErrorMessagePl></dane></root>`;
  return xmlResp(
    mtomEnvelope(
      `<DaneSzukajPodmiotyResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DaneSzukajPodmiotyResult>${xmlEscape(inner)}</DaneSzukajPodmiotyResult></DaneSzukajPodmiotyResponse>`,
    ),
  );
}

function fullReportResponse(fields: Record<string, string>): Response {
  const inner = `<root><dane>${Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join("")}</dane></root>`;
  return xmlResp(
    mtomEnvelope(
      `<DanePobierzPelnyRaportResponse xmlns="http://CIS/BIR/PUBL/2014/07"><DanePobierzPelnyRaportResult>${xmlEscape(inner)}</DanePobierzPelnyRaportResult></DanePobierzPelnyRaportResponse>`,
    ),
  );
}

/** Wyciąga nazwę operacji z nagłówka SOAPAction, żeby mock odpowiedział właściwym fixture'em. */
function actionOf(init: RequestInit | undefined): string {
  const headers = init?.headers as Record<string, string> | undefined;
  const contentType = headers?.["Content-Type"] ?? "";
  const match = /action="([^"]+)"/.exec(contentType);
  return match ? match[1]!.split("/").pop()! : "";
}

describe("gusUserKey / gusBaseUrl", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("brak GUS_BIR_USER_KEY i brak trybu testowego → null (degradacja do samego MF)", () => {
    delete process.env.GUS_BIR_USER_KEY;
    delete process.env.GUS_BIR_ENV;
    expect(gusUserKey()).toBeNull();
  });

  it("GUS_BIR_ENV=test bez własnego klucza → publiczny klucz testowy", () => {
    delete process.env.GUS_BIR_USER_KEY;
    process.env.GUS_BIR_ENV = "test";
    expect(gusUserKey()).toBe(GUS_TEST_USER_KEY);
    expect(gusBaseUrl()).toContain("wyszukiwarkaregontest");
  });

  it("własny klucz env ma pierwszeństwo nad trybem testowym", () => {
    process.env.GUS_BIR_USER_KEY = "wlasny-klucz";
    expect(gusUserKey()).toBe("wlasny-klucz");
  });

  it("bez GUS_BIR_ENV=test → baza produkcyjna", () => {
    delete process.env.GUS_BIR_ENV;
    expect(gusBaseUrl()).toContain("wyszukiwarkaregon.stat.gov.pl");
    expect(gusBaseUrl()).not.toContain("test");
  });
});

describe("lookupGus", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    __resetGusSidCacheForTests();
    process.env.GUS_BIR_ENV = "test";
    delete process.env.GUS_BIR_USER_KEY;
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("brak klucza skonfigurowanego i brak trybu testowego → unconfigured (NIE unavailable), bez próby sieciowej", async () => {
    delete process.env.GUS_BIR_ENV;
    const fetchFn = vi.fn();
    const result = await lookupGus("7740001454", { fetchFn });
    expect(result.ok).toBe(false);
    // ADR-276: powód ROZRÓŻNIONY od awarii przejściowej. Brak klucza nie
    // minie sam, więc komunikat „spróbuj ponownie" był radą bez pokrycia —
    // i to właśnie on blokował podatników zwolnionych z VAT (MF ich nie zna,
    // GUS bez klucza nie odpowie).
    expect((result as { reason: string }).reason).toBe("unconfigured");
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("osoba prawna (Typ=P, SilosID=6) — login → search → pełny raport praw_*", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const action = actionOf(init);
      if (action === "Zaloguj") return loginResponse();
      if (action === "DaneSzukajPodmioty")
        return searchFoundResponse({ regon: "610188201", typ: "P", silosId: "6", nazwa: "ORLEN SA" });
      if (action === "DanePobierzPelnyRaport")
        return fullReportResponse({
          praw_nazwa: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
          praw_adSiedzUlica_Nazwa: "ul. Test-Wilcza",
          praw_adSiedzNumerNieruchomosci: "7",
          praw_adSiedzKodPocztowy: "09411",
          praw_adSiedzMiejscowosc_Nazwa: "Płock",
        });
      throw new Error(`unexpected action ${action}`);
    });

    const result = await lookupGus("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: true,
      nip: "7740001454",
      legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
      regon: "610188201",
      krs: null,
      address: { street: "ul. Test-Wilcza 7", zip: "09-411", city: "Płock" },
      statusVat: null,
      source: "gus",
      fetchedAt: expect.any(String),
      requestId: null,
    });
  });

  it("osoba fizyczna CEIDG (Typ=F, SilosID=1) — pełny raport fiz_*, z lokalem", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const action = actionOf(init);
      if (action === "Zaloguj") return loginResponse();
      if (action === "DaneSzukajPodmioty")
        return searchFoundResponse({ regon: "360083330", typ: "F", silosId: "1", nazwa: "Jan Kowalski" });
      if (action === "DanePobierzPelnyRaport")
        return fullReportResponse({
          fiz_nazwa: "Jan Kowalski Usługi",
          fiz_adSiedzUlica_Nazwa: "ul. Testowa",
          fiz_adSiedzNumerNieruchomosci: "13",
          fiz_adSiedzNumerLokalu: "2",
          fiz_adSiedzKodPocztowy: "26900",
          fiz_adSiedzMiejscowosc_Nazwa: "Kozienice",
        });
      throw new Error(`unexpected action ${action}`);
    });

    const result = await lookupGus("8121913614", { fetchFn });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.legalName).toBe("Jan Kowalski Usługi");
      expect(result.address).toEqual({ street: "ul. Testowa 13/2", zip: "26-900", city: "Kozienice" });
    }
  });

  it("firma nieznaleziona (ErrorCode=4) → not_found", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const action = actionOf(init);
      if (action === "Zaloguj") return loginResponse();
      if (action === "DaneSzukajPodmioty") return searchNotFoundResponse();
      throw new Error(`unexpected action ${action}`);
    });

    const result = await lookupGus("1043321817", { fetchFn });
    expect(result).toEqual({ ok: false, reason: "not_found", message: "Nie znaleźliśmy firmy o tym NIP." });
  });

  it("sid wygasły (XxxResult pusty) → jeden re-login + retry, potem sukces", async () => {
    let searchCalls = 0;
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const action = actionOf(init);
      if (action === "Zaloguj") return loginResponse();
      if (action === "DaneSzukajPodmioty") {
        searchCalls += 1;
        if (searchCalls === 1) return invalidSidSearchResponse();
        return searchFoundResponse({ regon: "610188201", typ: "P", silosId: "6", nazwa: "ORLEN SA" });
      }
      if (action === "DanePobierzPelnyRaport")
        return fullReportResponse({
          praw_nazwa: "ORLEN SA",
          praw_adSiedzUlica_Nazwa: "ul. Test",
          praw_adSiedzNumerNieruchomosci: "1",
          praw_adSiedzKodPocztowy: "00001",
          praw_adSiedzMiejscowosc_Nazwa: "Warszawa",
        });
      throw new Error(`unexpected action ${action}`);
    });

    // Zasiej "stary" sid w cache, żeby pierwsza próba faktycznie go użyła i dostała odmowę.
    await lookupGus("0000000000-warmup", { fetchFn: vi.fn().mockImplementation(() => Promise.resolve(loginResponse())) }).catch(() => {});

    const result = await lookupGus("7740001454", { fetchFn });
    expect(result.ok).toBe(true);
    expect(searchCalls).toBe(2);
  });

  it("typ raportu niezweryfikowany na żywo (np. F/SilosID=2) → unavailable, nie zgaduje kształtu pól", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const action = actionOf(init);
      if (action === "Zaloguj") return loginResponse();
      if (action === "DaneSzukajPodmioty")
        return searchFoundResponse({ regon: "123456789", typ: "F", silosId: "2", nazwa: "Rolnik" });
      throw new Error(`unexpected action ${action}`);
    });

    const result = await lookupGus("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });
  });

  it("błąd transportu przy logowaniu → unavailable, bez wyjątku", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("network down"));
    const result = await lookupGus("7740001454", { fetchFn });
    expect(result).toEqual({
      ok: false,
      reason: "unavailable",
      message: "Rejestr chwilowo niedostępny, spróbuj ponownie.",
    });
  });
});
