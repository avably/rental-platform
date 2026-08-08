/**
 * Weryfikator Turnstile (src/turnstile.ts): brak sekretu = dev-skip (CAPTCHA
 * jawnie wyłączona — to rozbraja minę lockoutu: kod z widżetem może wejść na
 * prod PRZED ustawieniem sekretu), sekret ustawiony = token wymagany. Awaria
 * dostawcy (timeout/nie-2xx/wyjątek transportu) jest sygnalizowana JAWNIE
 * przez `providerError` — decyzję fail-open/fail-closed podejmuje wołający
 * (ADR-106). Transport jest wstrzykiwany, więc testy nie biją w sieć.
 */
import { describe, expect, it, vi } from "vitest";

import { TURNSTILE_SITEVERIFY_URL, verifyTurnstile } from "../src/turnstile";

function fetchOk(success: boolean) {
  return vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));
}

describe("brak konfiguracji (dev / prod przed ustawieniem sekretu)", () => {
  it("bez sekretu przepuszcza jako devSkip i nie dotyka sieci (anty-lockout)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn();
    const result = await verifyTurnstile(undefined, { secret: undefined, fetchFn });

    expect(result).toEqual({ ok: true, devSkip: true });
    expect(fetchFn, "dev-skip uderzył w sieć").not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("sekret ustawiony = token wymagany", () => {
  it("brak tokenu → odmowa bez wywołania sieci i BEZ providerError", async () => {
    const fetchFn = vi.fn();
    expect(await verifyTurnstile(undefined, { secret: "s3cret", fetchFn })).toEqual({ ok: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("token weryfikowany POST-em na siteverify z sekretem i tokenem", async () => {
    const fetchFn = fetchOk(true);
    expect(await verifyTurnstile("tok-123", { secret: "s3cret", fetchFn })).toEqual({ ok: true });

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
    expect(JSON.parse(init.body as string)).toEqual({ secret: "s3cret", response: "tok-123" });
  });

  it("siteverify success:false → odmowa BEZ providerError (to nie awaria)", async () => {
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn: fetchOk(false) })).toEqual({
      ok: false,
    });
  });
});

describe("awaria dostawcy → ok:false + providerError (decyzja u wołającego)", () => {
  it("HTTP != 2xx → providerError, nie wyjątek", async () => {
    const fetchFn = vi.fn(async () => new Response("upstream error", { status: 503 }));
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn })).toEqual({
      ok: false,
      providerError: true,
    });
  });

  it("wyjątek transportu (timeout/DNS) → providerError, nie wyjątek", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("network down");
    });
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn })).toEqual({
      ok: false,
      providerError: true,
    });
  });

  it("niesparsowalna odpowiedź dostawcy → providerError", async () => {
    const fetchFn = vi.fn(async () => new Response('{"weird":1}', { status: 200 }));
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn })).toEqual({
      ok: false,
      providerError: true,
    });
  });

  it("żądanie siteverify niesie sygnał timeoutu (AbortSignal)", async () => {
    const fetchFn = fetchOk(true);
    await verifyTurnstile("tok", { secret: "s", fetchFn });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal, "brak AbortSignal — wiszący dostawca wiesza logowanie").toBeInstanceOf(
      AbortSignal,
    );
  });
});

describe("brak cache'owania wyniku między żądaniami", () => {
  it("dwa wywołania z tym samym tokenem = dwa niezależne siteverify", async () => {
    // Token dostawcy jest jednorazowy — gdyby kod cache'ował pozytywny wynik,
    // zużyty (a nawet unieważniony) token otwierałby kolejne żądania.
    const fetchFn = fetchOk(true);
    await verifyTurnstile("tok-x", { secret: "s", fetchFn });
    await verifyTurnstile("tok-x", { secret: "s", fetchFn });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
