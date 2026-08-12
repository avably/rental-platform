/**
 * Testy przypinające retry transportowy testów integracyjnych
 * (./transport-retry.ts). Czysto jednostkowe — bez Supabase.
 *
 * Kontrakt, którego pilnują (i mutanty, które mają zabijać):
 *   1. czkawka transportowa (Kong 502/503/504, ECONNRESET) → DRUGIE podejście
 *      przechodzi [mutant: retry zdjęty → czerwień],
 *   2. odmowy i sygnały testów (42501, 23505, PGRST1xx, 4xx, 500, AbortError)
 *      NIGDY nie są ponawiane — ani jako odpowiedź, ani jako rzut
 *      [mutant: retry „na wszystko" → czerwień],
 *   3. liczba podejść jest skończona i przypięta (3), backoff 250/750 ms,
 *   4. retry obowiązuje WYŁĄCZNIE URL-e bramki lokalnego Supabase,
 *   5. bramka uwierzytelniania (`/auth/…`): 500 z `unexpected_failure` JEST
 *      ponawiane, a wyczerpana odpowiedź niesie status i ciało zamiast `{}`
 *      [mutanty: zdjęta klasa 500 → czerwień; zdjęte doklejenie `msg` →
 *      czerwień na teście przez PRAWDZIWE supabase-js].
 *
 * JEDEN ZESTAW ASERCJI, DWA PAKIETY. Ten moduł nie jest plikiem testowym —
 * rejestruje suity przy imporcie, a uruchamiają go dwa cienkie pliki:
 * `packages/db/test/transport-retry.test.ts` i
 * `apps/panel/test/transport-retry.test.ts`. Każdy pakiet biegnie z własną
 * konfiguracją vitest, więc sekcja „okablowanie setupFiles" niżej sprawdza
 * okablowanie TEGO pakietu, w którym akurat leci — a reguły retry są jedne
 * i nie da się poprawić ich w jednej kopii, a zapomnieć w drugiej (PR #284).
 */
import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import {
  installTransportRetry,
  isTransportError,
  RETRYABLE_STATUSES,
  transportRetryFetchForGateway,
  withTransportRetry,
} from "./transport-retry";

const noSleep = async (): Promise<void> => {};

/** Dokładna sygnatura z CI: Kong nie dosięgnął PostgREST-a pod obciążeniem. */
function kongUpstream502(): Response {
  return new Response(
    JSON.stringify({ message: "An invalid response was received from the upstream server" }),
    { status: 502, headers: { "content-type": "application/json" } },
  );
}

function ok(): Response {
  return new Response(JSON.stringify([{ id: "row-1" }]), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Odpowiedź-odmowa w kształcie PostgREST (kod SQLSTATE w JSON-ie, status 4xx). */
function refusal(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ code, message, details: null, hint: null }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Rzut undici: TypeError("fetch failed") z kodem sieciowym w cause. */
function connReset(): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
  });
}

type Outcome = { response: () => Response } | { throw: () => unknown };

/** Atrapa fetch: kolejka wyników, potem zawsze 200. */
function fetchQueue(...outcomes: Outcome[]) {
  let call = 0;
  const impl = vi.fn(async (): Promise<Response> => {
    const outcome = outcomes[call];
    call += 1;
    if (!outcome) return ok();
    if ("throw" in outcome) throw outcome.throw();
    return outcome.response();
  });
  return impl;
}

const GATEWAY = "http://127.0.0.1:54321";

describe("withTransportRetry — czkawki transportowe SĄ ponawiane", () => {
  it("sygnatura z CI: Kong 502 raz → drugie podejście przechodzi", async () => {
    const base = fetchQueue({ response: kongUpstream502 });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`, { method: "PATCH" });

    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it.each([502, 503, 504])("status %i raz → drugie podejście przechodzi", async (status) => {
    expect(RETRYABLE_STATUSES.has(status)).toBe(true);
    const base = fetchQueue({ response: () => new Response("bramka w malinach", { status }) });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`);

    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("rzut ECONNRESET (undici cause) raz → drugie podejście przechodzi", async () => {
    const base = fetchQueue({ throw: connReset });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("rzut „socket hang up” bez kodu → ponawiany po sygnaturze tekstowej", async () => {
    const base = fetchQueue({ throw: () => new Error("socket hang up") });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/auth/v1/token`)).resolves.toMatchObject({ status: 200 });
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("trwała awaria: ostatnia odpowiedź 502 wraca po DOKŁADNIE 3 podejściach", async () => {
    const base = fetchQueue(
      { response: kongUpstream502 },
      { response: kongUpstream502 },
      { response: kongUpstream502 },
      { response: kongUpstream502 },
    );
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`);

    expect(response.status).toBe(502);
    expect(base).toHaveBeenCalledTimes(3); // literal, nie stala — patrz komentarz przy backoffie
  });

  it("trwały rzut sieciowy → po 3 podejściach leci ORYGINALNY błąd", async () => {
    const base = fetchQueue({ throw: connReset }, { throw: connReset }, { throw: connReset });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(3); // literal, nie stala — patrz komentarz przy backoffie
  });

  it("backoff: odstępy 250/750 ms w tej kolejności", async () => {
    const waits: number[] = [];
    const base = fetchQueue({ response: kongUpstream502 }, { response: kongUpstream502 });
    const fetchWithRetry = withTransportRetry(base, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await fetchWithRetry(`${GATEWAY}/rest/v1/orders`);

    // LITERAŁY, nie DEFAULT_BACKOFF_MS: asercja przez stałą mutowałaby się
    // razem z kodem i mutant backoffu przechodziłby na zielono (wakat dowodu).
    expect(waits).toEqual([250, 750]);
  });
});

describe("withTransportRetry — sygnały testów NIE SĄ ponawiane", () => {
  it.each([
    [403, "42501", "new row violates row-level security policy"],
    [409, "23505", "duplicate key value violates unique constraint"],
    [409, "23503", "violates foreign key constraint"],
    [400, "23514", "violates check constraint"],
    [406, "PGRST116", "JSON object requested, multiple (or no) rows returned"],
  ])("odmowa %i/%s wraca NIETKNIĘTA po jednym podejściu", async (status, code, message) => {
    const base = fetchQueue({ response: () => refusal(status, code, message) });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`, { method: "POST" });

    expect(base).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(status);
    // Ciało jest sygnałem testu — musi dojechać nienaruszone (kod SQLSTATE).
    await expect(response.json()).resolves.toMatchObject({ code });
  });

  it("401 od bramki (zły apikey) → jedno podejście", async () => {
    const base = fetchQueue({
      response: () => new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 }),
    });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    expect((await fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).status).toBe(401);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("500 NIE jest ponawiane — może nieść błąd funkcji SQL, czyli sygnał testu", async () => {
    const base = fetchQueue({
      response: () => new Response(JSON.stringify({ message: "internal error" }), { status: 500 }),
    });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    expect((await fetchWithRetry(`${GATEWAY}/rest/v1/rpc/create_order`)).status).toBe(500);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("rzut z kodem SQLSTATE (42501) → NATYCHMIASTOWY rethrow, zero retry", async () => {
    const rlsError = Object.assign(new Error("new row violates row-level security policy"), {
      code: "42501",
    });
    const base = fetchQueue({ throw: () => rlsError }, { response: ok });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).rejects.toBe(rlsError);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("rzut z kodem PGRST301 → zero retry", async () => {
    const base = fetchQueue({
      throw: () => Object.assign(new Error("JWT expired"), { code: "PGRST301" }),
    });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).rejects.toThrow("JWT expired");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("kod odmowy w ŁAŃCUCHU cause wygrywa z transportową treścią komunikatu", async () => {
    // Fail-safe z kontraktu: gdy w łańcuchu jest JAKIKOLWIEK kod sygnałowy,
    // wątpliwość idzie przeciwko retry — nawet przy „transportowym" tekście.
    const base = fetchQueue({
      throw: () =>
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("permission denied for table orders"), { code: "42501" }),
        }),
    });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).rejects.toThrow("fetch failed");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("AbortError → zero retry (decyzja wołającego)", async () => {
    const base = fetchQueue({
      throw: () => Object.assign(new DOMException("This operation was aborted", "AbortError")),
    });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    await expect(fetchWithRetry(`${GATEWAY}/rest/v1/orders`)).rejects.toThrow("aborted");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("ciało-strumień: nie da się odtworzyć → pojedyncze podejście nawet na 502", async () => {
    const base = fetchQueue({ response: kongUpstream502 });
    const fetchWithRetry = withTransportRetry(base, { sleep: noSleep });

    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.close();
      },
    });
    const response = await fetchWithRetry(`${GATEWAY}/rest/v1/orders`, {
      method: "POST",
      body,
      // Node wymaga duplex przy ciele-strumieniu; atrapa go nie czyta.
      duplex: "half",
    } as RequestInit);

    expect(response.status).toBe(502);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

describe("isTransportError — klasyfikator rzutów", () => {
  it.each([
    ["ECONNRESET w cause", connReset(), true],
    ["goły kod ECONNREFUSED", Object.assign(new Error("connect"), { code: "ECONNREFUSED" }), true],
    ["EPIPE (5 znaków — kolizja kształtu z SQLSTATE)", Object.assign(new Error("write"), { code: "EPIPE" }), true],
    ["komunikat Konga bez kodu", new Error("An invalid response was received from the upstream server"), true],
    ["SQLSTATE 42501", Object.assign(new Error("permission denied"), { code: "42501" }), false],
    ["SQLSTATE 23P01", Object.assign(new Error("exclusion"), { code: "23P01" }), false],
    ["PGRST116", Object.assign(new Error("rows"), { code: "PGRST116" }), false],
    ["błąd asercji bez kodu", new Error("expected 200 to be 403"), false],
    ["nie-obiekt", "ECONNRESET", false],
  ])("%s → %s", (_label, error, expected) => {
    expect(isTransportError(error)).toBe(expected);
  });
});

describe("transportRetryFetchForGateway — zasięg tylko na bramkę Supabase", () => {
  it("URL bramki: 502 raz → ponowione", async () => {
    const base = fetchQueue({ response: kongUpstream502 });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    expect((await routed(`${GATEWAY}/rest/v1/orders?select=id`)).status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("cudzy URL: 502 przechodzi bez retry (jedno podejście)", async () => {
    const base = fetchQueue({ response: kongUpstream502 });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    expect((await routed("https://api.stripe.com/v1/charges")).status).toBe(502);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("prefiks nie łapie sąsiedniego portu/hosta o wspólnym początku", async () => {
    const base = fetchQueue({ response: kongUpstream502 });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    // 54321 vs 543210 — goły startsWith bez separatora „/" by to złapał.
    expect((await routed(`${GATEWAY}0/rest/v1/orders`)).status).toBe(502);
    expect(base).toHaveBeenCalledTimes(1);
  });
});

/**
 * Odpowiedź GoTrue 500 z sondy na ŻYWYM Supabase (pula połączeń do Postgresa
 * wyczerpana). Dwa kształty tej samej awarii — supabase-js wysyła nagłówek
 * `X-Supabase-Api-Version`, więc PRODUKCYJNIE przychodzi wariant „wersjonowany"
 * (`code` jako tekst, `message`); goły fetch dostaje wariant „stary"
 * (`code` numeryczny, `error_code`, `msg`). Klasyfikator musi znać oba:
 * pierwsza wersja tej poprawki znała tylko stary i na żywym ruchu nie
 * ponowiła NICZEGO.
 */
function gotrueDbFailure(msg = "Database error creating new user"): Response {
  return new Response(JSON.stringify({ code: "unexpected_failure", message: msg }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });
}

function gotrueDbFailureStaryKsztalt(msg = "Database error creating new user"): Response {
  return new Response(
    JSON.stringify({
      code: 500,
      error_code: "unexpected_failure",
      msg,
      error_id: "3fdf80fe-6cb9-4975-ab4f-73ba14455e61",
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

describe("bramka uwierzytelniania — 500 od GoTrue pod presją", () => {
  it.each([
    ["kształt wersjonowany (supabase-js)", gotrueDbFailure],
    ["kształt stary (goły fetch)", gotrueDbFailureStaryKsztalt],
  ])("500 unexpected_failure, %s → DRUGIE podejście przechodzi", async (_label, fixture) => {
    const base = fetchQueue({ response: () => fixture() });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const response = await routed(`${GATEWAY}/auth/v1/admin/users`, { method: "POST" });

    expect(response.status).toBe(200);
    // Licznik podejść, nie „kod się wykonał": retry MUSIAŁ realnie zajść.
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("trwałe 500: dokładnie 4 podejścia, backoff 250/750/1500 ms", async () => {
    const waits: number[] = [];
    const base = fetchQueue(
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
    );
    const routed = transportRetryFetchForGateway(base, GATEWAY, {
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    const response = await routed(`${GATEWAY}/auth/v1/admin/users`, { method: "POST" });

    expect(response.status).toBe(500);
    // LITERAŁY, nie stałe — asercja przez stałą mutowałaby się razem z kodem.
    expect(base).toHaveBeenCalledTimes(4);
    expect(waits).toEqual([250, 750, 1500]);
  });

  it("wyczerpana odpowiedź niesie status i CIAŁO w polu `msg`", async () => {
    const base = fetchQueue(
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
      { response: () => gotrueDbFailure() },
    );
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const response = await routed(`${GATEWAY}/auth/v1/admin/users`, { method: "POST" });

    const message = (response as Response & { msg?: string }).msg;
    expect(message).toContain("500");
    expect(message).toContain("POST /auth/v1/admin/users");
    expect(message).toContain("Database error creating new user");
    expect(message).toContain("4 podejściach");
    // Ciało odczytaliśmy w warstwie retry — wołający MUSI móc je odczytać znów.
    await expect(response.json()).resolves.toMatchObject({ code: "unexpected_failure" });
  });

  it("500 od GoTrue z INNYM kodem błędu → zero retry (bramka jest wąska)", async () => {
    const base = fetchQueue({
      response: () =>
        new Response(JSON.stringify({ code: "hook_timeout", message: "hook padł" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const response = await routed(`${GATEWAY}/auth/v1/admin/users`, { method: "POST" });

    expect(response.status).toBe(500);
    expect(base).toHaveBeenCalledTimes(1);
    // …ale komunikat i tak przestaje być `{}` — diagnostyka nie zależy od retry.
    expect((response as Response & { msg?: string }).msg).toContain("hook padł");
  });

  it("500 z /rest/ z TĄ SAMĄ treścią → nadal zero retry i zero doklejania", async () => {
    // Rozdział idzie po URL-u: gdyby szedł po treści, sygnał testu z PostgREST
    // dałoby się przykryć, podrzucając `error_code` w ciele.
    const base = fetchQueue({ response: () => gotrueDbFailure() });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const response = await routed(`${GATEWAY}/rest/v1/rpc/create_order`, { method: "POST" });

    expect(response.status).toBe(500);
    expect(base).toHaveBeenCalledTimes(1);
    expect((response as Response & { msg?: string }).msg).toBeUndefined();
  });

  it("odmowa 4xx od GoTrue → jedno podejście, ciało nietknięte, bez doklejania", async () => {
    const base = fetchQueue({
      response: () =>
        new Response(JSON.stringify({ code: 422, error_code: "email_exists", msg: "już jest" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
    });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const response = await routed(`${GATEWAY}/auth/v1/admin/users`, { method: "POST" });

    expect(base).toHaveBeenCalledTimes(1);
    expect((response as Response & { msg?: string }).msg).toBeUndefined();
    await expect(response.json()).resolves.toMatchObject({ error_code: "email_exists" });
  });
});

describe("diagnostyka przez PRAWDZIWE supabase-js — koniec z `{}`", () => {
  // Ten opis nie zakłada, jak auth-js buduje komunikat — sprawdza to na żywym
  // kliencie. Bez tego doklejenie `msg` byłoby dowodem po pustym zbiorze:
  // asercja na samym polu odpowiedzi nie mówi, czy TEST zobaczy prawdę.
  function adminClient(fetchImpl: typeof fetch) {
    return createClient(GATEWAY, "service-role-key-atrapa", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchImpl },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    });
  }

  it("PRZESŁANKA: bez naszej warstwy auth-js gubi ciało 5xx i daje dosłownie `{}`", async () => {
    const base = fetchQueue({ response: () => gotrueDbFailure() });
    const { error } = await adminClient(base as unknown as typeof fetch).auth.admin.createUser({
      email: "seed@test.local",
    });

    expect(error?.message).toBe("{}");
  });

  it("z warstwą: komunikat niesie status HTTP i treść odpowiedzi GoTrue", async () => {
    const base = fetchQueue(
      { response: () => gotrueDbFailure("Database error checking email") },
      { response: () => gotrueDbFailure("Database error checking email") },
      { response: () => gotrueDbFailure("Database error checking email") },
      { response: () => gotrueDbFailure("Database error checking email") },
    );
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    const { error } = await adminClient(routed as unknown as typeof fetch).auth.admin.createUser({
      email: "seed@test.local",
    });

    expect(error?.message).not.toBe("{}");
    expect(error?.message).toContain("GoTrue 500");
    expect(error?.message).toContain("Database error checking email");
    expect(error?.status).toBe(500);
  });

  it("z warstwą: pojedyncza czkawka 500 nie dociera do testu w ogóle", async () => {
    const base = fetchQueue({ response: () => gotrueDbFailure() });
    const routed = transportRetryFetchForGateway(base, GATEWAY, { sleep: noSleep });

    // Drugie podejście zwraca 200 z pustym ciałem — dla admin.createUser to
    // nie jest poprawny user, ale liczy się to, że BŁĄD zniknął.
    const { error } = await adminClient(routed as unknown as typeof fetch).auth.admin.createUser({
      email: "seed@test.local",
    });

    expect(error).toBeNull();
    expect(base).toHaveBeenCalledTimes(2);
  });
});

describe("okablowanie setupFiles — retry realnie zainstalowany w tej suicie", () => {
  // Pilnuje WPISU w vitest.config.ts (test.setupFiles), nie samego helpera:
  // zdjęcie setup-transport-retry.ts z konfiguracji gasi retry w całej suicie,
  // a wszystkie pozostałe testy tego pliku dalej świecą na zielono, bo wołają
  // helper bezpośrednio.
  //
  // DWA znaczniki, bo bronią DWÓCH różnych rzeczy — i tylko jeden z nich
  // działa bez lokalnego Supabase:
  it("plik setup został ZAŁADOWANY przez konfigurację tej suity", () => {
    // Bezwarunkowo: ten znacznik stawia sam plik setup, niezależnie od env.
    // To jedyna asercja łapiąca „helper leży w pakiecie, ale nikt go nie
    // ładuje" — czyli bliźniaczą kopię wpiętą tylko z nazwy. Bez tego
    // przebieg z ALLOW_INTEGRATION_SKIP=1 nie pilnowałby okablowania wcale.
    const marker = Symbol.for("avably.testTransportRetrySetupLoaded");
    expect((globalThis as unknown as { [key: symbol]: unknown })[marker]).toBe(true);
  });

  it.skipIf(!process.env.SUPABASE_LOCAL_API_URL)(
    "globalThis.fetch niesie znacznik instalacji retry",
    () => {
      // Gated po env: bez lokalnego Supabase instalacja jest świadomym
      // no-opem i nie ma czego pilnować.
      const marker = Symbol.for("avably.testTransportRetryInstalled");
      expect((globalThis.fetch as unknown as { [key: symbol]: unknown })[marker]).toBe(true);
    },
  );
});

describe("installTransportRetry — instalacja na globalThis.fetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("bez SUPABASE_LOCAL_API_URL → świadomy no-op", () => {
    vi.stubEnv("SUPABASE_LOCAL_API_URL", "");
    const before = globalThis.fetch;

    expect(installTransportRetry()).toBe(false);
    expect(globalThis.fetch).toBe(before);
  });

  it("z env: opakowuje fetch, a drugi install jest no-opem (idempotencja)", async () => {
    vi.stubEnv("SUPABASE_LOCAL_API_URL", GATEWAY);
    const base = fetchQueue({ response: kongUpstream502 });
    globalThis.fetch = base as unknown as typeof globalThis.fetch;

    expect(installTransportRetry({ sleep: noSleep })).toBe(true);
    expect(installTransportRetry({ sleep: noSleep })).toBe(false);

    const response = await globalThis.fetch(`${GATEWAY}/rest/v1/orders`);
    expect(response.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
  });
});
