/**
 * Testy KONTRAKTOWE portu domen — nagrany kontrakt (fixtures) zamiast żywego
 * API dostawcy: kształty odpowiedzi wg jego dokumentacji, dane WYŁĄCZNIE
 * fikcyjne. CI nie dotyka sieci ani konta hostingowego, w repo nie ma
 * credentiali (wzorzec ADR-031, courier/api.test.ts).
 *
 * DOWÓD MUTACYJNY (b) tego pliku (2.6c): spraw, by
 * `belongsToConfiguredProject` zwracało zawsze `true`, a zapłonie
 * „201 z CUDZEGO projektu to porażka, nie sukces" tutaj i jego odpowiednik na
 * akcji panelu (asercja na `last_error` i wierszu w bazie) w
 * apps/panel/test/domains-retry.test.ts. Restore przywraca zieleń.
 */
import { describe, expect, it, vi } from "vitest";

import { CUSTOM_DOMAIN_CNAME_TARGET, VercelDomainsClient, VercelDomainsError, redactToken } from "./api";
import { VercelConfigError } from "./config";

const CONFIG = { token: "tok-tajny-123", projectId: "prj_abc", teamId: "team_xyz" } as const;

/** Nagrany kontrakt: kształty odpowiedzi wg dokumentacji dostawcy, dane fikcyjne. */
const FIX = {
  addedUnverified: {
    name: "sklep.example.com",
    apexName: "example.com",
    projectId: "prj_abc",
    verified: false,
    verification: [
      {
        type: "TXT",
        domain: "_vercel.example.com",
        value: "vc-domain-verify=sklep.example.com,abc123",
        reason: "pending_domain_verification",
      },
    ],
  },
  addedVerified: {
    name: "acme.avably.io",
    apexName: "avably.io",
    projectId: "prj_abc",
    verified: true,
  },
  /**
   * Ten sam kształt, ale host siedzi w INNYM projekcie. To jest dowód rzeczowy
   * długu z ADR-046: dla kodu ufającego statusowi 2xx ta odpowiedź jest
   * nieodróżnialna od sukcesu.
   */
  inOtherProject: {
    name: "acme.avably.io",
    apexName: "avably.io",
    projectId: "prj_PANELU",
    verified: true,
  },
  /** Starszy kształt/dryf pola: `projectId` nie przyszedł wcale. */
  withoutProjectId: {
    name: "acme.avably.io",
    apexName: "avably.io",
    verified: true,
  },
  conflict: {
    error: { code: "domain_already_in_use", message: "Domain is already in use by another project" },
  },
  forbidden: {
    error: { code: "forbidden", message: "Not authorized" },
  },
} as const;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Call {
  url: string;
  method: string;
  authorization: string | null;
  body: string | null;
}

/** Stub fetcha: kolejka odpowiedzi + rejestr wywołań do asercji kontraktu. */
function stubFetch(responses: Response[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: headers.get("authorization"),
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = queue.shift();
    if (!next) throw new Error("Stub fetcha: brak nagranej odpowiedzi na kolejne wywołanie");
    return next;
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function client(responses: Response[]) {
  const { fetchFn, calls } = stubFetch(responses);
  return { api: new VercelDomainsClient({ config: CONFIG, fetchFn }), calls };
}

describe("VercelDomainsClient — kontrakt na fixtures", () => {
  it("addDomain wysyła nazwę hosta do projektu z tokenem w nagłówku i teamId w query", async () => {
    const { api, calls } = client([json(FIX.addedUnverified, 200), json(FIX.addedUnverified, 200)]);

    const status = await api.addDomain("sklep.example.com");

    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/v10/projects/prj_abc/domains");
    expect(calls[0]?.url).toContain("teamId=team_xyz");
    expect(calls[0]?.authorization).toBe("Bearer tok-tajny-123");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "sklep.example.com" });

    expect(status.providerDomainId).toBe("sklep.example.com");
    expect(status.verified).toBe(false);
  });

  it("wyzwania własności od dostawcy stają się rekordami DNS do pokazania najemcy", async () => {
    const { api } = client([json(FIX.addedUnverified, 200), json(FIX.addedUnverified, 200)]);

    const status = await api.addDomain("sklep.example.com");

    expect(status.requiredRecords).toEqual([
      {
        type: "TXT",
        name: "_vercel.example.com",
        value: "vc-domain-verify=sklep.example.com,abc123",
        reason: "pending_domain_verification",
      },
    ]);
  });

  it("host zweryfikowany przez dostawcę wraca z verified=true", async () => {
    const { api } = client([json(FIX.addedVerified, 200), json(FIX.addedVerified, 200)]);
    await expect(api.addDomain("acme.avably.io")).resolves.toMatchObject({ verified: true });
  });

  // IDEMPOTENCJA — warunek tego, żeby ponowienie („dodaj" drugi raz, retry po
  // zerwanym połączeniu) nie wywalało akcji.
  it("409 dla hosta JUŻ w NASZYM projekcie to sukces, nie błąd (idempotencja)", async () => {
    const { api, calls } = client([json(FIX.conflict, 409), json(FIX.addedVerified, 200)]);

    const status = await api.addDomain("acme.avably.io");

    expect(status.verified).toBe(true);
    expect(calls[1]?.method, "po 409 klient MUSI sprawdzić, czyj to host").toBe("GET");
  });

  // Druga strona tej samej monety: „już zajęte" NIE MOŻE być zamiatane pod
  // dywan, gdy host należy do kogoś innego — inaczej udawalibyśmy, że
  // serwujemy sklep pod hostem, którego nie mamy.
  it("409 dla hosta w CUDZYM projekcie (GET → 404) to prawdziwy błąd", async () => {
    const { api } = client([json(FIX.conflict, 409), json({}, 404)]);

    await expect(api.addDomain("zajete.example.com")).rejects.toBeInstanceOf(VercelDomainsError);
  });

  it("getDomainStatus zwraca null dla hosta spoza projektu (404 to nie awaria)", async () => {
    const { api } = client([json({}, 404)]);
    await expect(api.getDomainStatus("nieznany.example.com")).resolves.toBeNull();
  });

  it("removeDomain jest idempotentne: 404 (host już usunięty) nie rzuca", async () => {
    const { api } = client([json({}, 404)]);
    await expect(api.removeDomain("nieznany.example.com")).resolves.toBeUndefined();
  });

  it("odmowa dostawcy niesie status i kod błędu", async () => {
    const { api } = client([json(FIX.forbidden, 403)]);

    await expect(api.addDomain("sklep.example.com")).rejects.toMatchObject({
      name: "VercelDomainsError",
      statusCode: 403,
      code: "forbidden",
    });
  });

  it("awaria transportu staje się VercelDomainsError, nie surowym wyjątkiem fetcha", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const api = new VercelDomainsClient({ config: CONFIG, fetchFn });

    await expect(api.addDomain("sklep.example.com")).rejects.toBeInstanceOf(VercelDomainsError);
  });

  it("nie-JSON (strona serwisowa dostawcy) nie udaje poprawnej odpowiedzi", async () => {
    const html = new Response("<html>503 Service Unavailable</html>", {
      status: 503,
      headers: { "content-type": "text/html" },
    });
    const api = new VercelDomainsClient({ config: CONFIG, fetchFn: stubFetch([html]).fetchFn });

    await expect(api.addDomain("sklep.example.com")).rejects.toMatchObject({ statusCode: 503 });
  });

  // BRAMKA SEKRETU: komunikat błędu idzie do domains.last_error i na ekran
  // najemcy. Gdyby dostawca odbił nasz nagłówek w treści błędu, token
  // wyciekłby do bazy i do UI.
  it("token NIE przecieka do komunikatu błędu, nawet gdy dostawca go odbije", async () => {
    const echo = { error: { code: "bad_request", message: `Bad token: ${CONFIG.token}` } };
    const { api } = client([json(echo, 400)]);

    const error = await api.addDomain("sklep.example.com").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VercelDomainsError);
    expect((error as Error).message).not.toContain(CONFIG.token);
    expect((error as Error).message).toContain("[usunięto]");
  });

  it("redactToken usuwa każde wystąpienie sekretu", () => {
    expect(redactToken("a tok-1 b tok-1", "tok-1")).toBe("a [usunięto] b [usunięto]");
  });

  it("brak konfiguracji to twardy błąd przy konstrukcji, nigdy cicha atrapa", () => {
    expect(() => new VercelDomainsClient({ config: {} })).toThrow(VercelConfigError);
  });

  it("cel CNAME dla własnych domen jest stałą portu (nie przychodzi z API)", () => {
    expect(CUSTOM_DOMAIN_CNAME_TARGET).toBe("cname.vercel-dns.com");
  });
});

/**
 * DŁUG Z ADR-046, DOMKNIĘTY W 2.6c: „201 Created" to DEKLARACJA dostawcy, że
 * coś zrobił — nie dowód, że host trafił tam, gdzie chcieliśmy. Poprzednia
 * wersja budowała `DomainStatus` wprost z odpowiedzi na POST, więc panel
 * ogłaszał „Działa" na podstawie sygnału, który tego nie dowodził.
 */
describe("sukces rejestracji jest SPRAWDZANY, nie deklarowany", () => {
  it("po 2xx klient DOPYTUJE o stan hosta, zamiast ufać odpowiedzi na POST", async () => {
    const { api, calls } = client([json(FIX.addedVerified, 201), json(FIX.addedVerified, 200)]);

    await api.addDomain("acme.avably.io");

    expect(calls).toHaveLength(2);
    expect(calls[1]?.method, "brak drugiego zapytania = sukces wzięty z deklaracji").toBe("GET");
    expect(calls[1]?.url).toContain("/v9/projects/prj_abc/domains/acme.avably.io");
  });

  // SEDNO dowodu mutacyjnego (b).
  it("201 z CUDZEGO projektu to porażka, nie sukces", async () => {
    const { api } = client([json(FIX.addedVerified, 201), json(FIX.inOtherProject, 200)]);

    const error = await api.addDomain("acme.avably.io").catch((e: unknown) => e);

    expect(error, "host w cudzym projekcie przeszedł jako sukces").toBeInstanceOf(
      VercelDomainsError,
    );
    expect((error as Error).message).toContain("INNEGO projektu");
  });

  it("201, po którym hosta NIE MA w projekcie, to też porażka", async () => {
    const { api } = client([json(FIX.addedVerified, 201), json({}, 404)]);

    const error = await api.addDomain("acme.avably.io").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(VercelDomainsError);
    expect((error as Error).message).toContain("nie ma go w skonfigurowanym projekcie");
  });

  // Kontrola projektu jest DRUGĄ warstwą (pierwsza to zawężenie ścieżki
  // zapytania). Twarde wymaganie pola zamieniłoby dryf API dostawcy w awarię
  // rejestracji dla wszystkich najemców.
  it("brak `projectId` w odpowiedzi nie jest niezgodnością", async () => {
    const { api } = client([json(FIX.withoutProjectId, 201), json(FIX.withoutProjectId, 200)]);

    await expect(api.addDomain("acme.avably.io")).resolves.toMatchObject({ projectId: null });
  });

  // Ta sama kontrola obowiązuje „sprawdź weryfikację" i rozstrzygnięcie 409 —
  // dlatego siedzi w getDomainStatus, przez które przechodzą wszystkie ścieżki.
  it("odczyt stanu hosta z CUDZEGO projektu też jest porażką", async () => {
    const { api } = client([json(FIX.inOtherProject, 200)]);

    await expect(api.getDomainStatus("acme.avably.io")).rejects.toBeInstanceOf(VercelDomainsError);
  });

  it("komunikat niezgodności nie zdradza id projektów", async () => {
    const { api } = client([json(FIX.inOtherProject, 200)]);

    const error = await api.getDomainStatus("acme.avably.io").catch((e: unknown) => e);

    expect((error as Error).message).not.toContain("prj_abc");
    expect((error as Error).message).not.toContain("prj_PANELU");
  });
});
