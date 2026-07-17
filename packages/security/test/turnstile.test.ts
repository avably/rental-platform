/**
 * Weryfikator Turnstile (src/turnstile.ts) — lustro semantyki
 * apps/panel/lib/turnstile.ts: brak sekretu = dev-skip (CAPTCHA jawnie
 * wyłączona), sekret ustawiony = fail-closed. Transport jest wstrzykiwany,
 * więc testy nie biją w sieć.
 */
import { describe, expect, it, vi } from "vitest";

import { TURNSTILE_SITEVERIFY_URL, verifyTurnstile } from "../src/turnstile";

function fetchOk(success: boolean) {
  return vi.fn(async () => new Response(JSON.stringify({ success }), { status: 200 }));
}

describe("brak konfiguracji (dev)", () => {
  it("bez sekretu przepuszcza jako devSkip i nie dotyka sieci", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchFn = vi.fn();
    const result = await verifyTurnstile(undefined, { secret: undefined, fetchFn });

    expect(result).toEqual({ ok: true, devSkip: true });
    expect(fetchFn, "dev-skip uderzył w sieć").not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("sekret ustawiony = fail-closed", () => {
  it("brak tokenu → odmowa bez wywołania sieci", async () => {
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

  it("siteverify success:false → odmowa", async () => {
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn: fetchOk(false) })).toEqual({
      ok: false,
    });
  });

  it("HTTP != 2xx → odmowa (fail-closed, nie wyjątek)", async () => {
    const fetchFn = vi.fn(async () => new Response("upstream error", { status: 503 }));
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn })).toEqual({ ok: false });
  });
});
