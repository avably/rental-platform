/**
 * Endpoint przeglądu na storefroncie (ADR-071, po ADR-099/ADR-115 RELAY) —
 * trzy dowody:
 *
 * 1. KILL-SWITCH bez środowiska: REVIEW_MODE wyłączony → 404 zanim powstanie
 *    jakiekolwiek żądanie wychodzące (endpoint „nie istnieje").
 * 2. BRAK sekretu relaya → 503 i ZERO ruchu do panelu — dowodem jest brak
 *    wywołania `fetch`, nie sam kod odpowiedzi (storefront nie ma już
 *    ŻADNEJ własnej drogi do bazy, więc „nie wyszło żądanie" = „nie było
 *    zapisu").
 * 3. RELAY przekazuje żądanie wiernie: ścieżka ingest panelu, token w
 *    nagłówku, metoda, query, content-type multipart z boundary i bajty
 *    ciała bez zmian; odpowiedź panelu wraca ze statusem i ciałem 1:1,
 *    bez przepuszczania nagłówków sesyjnych panelu.
 * 4. ŚCIEŻKA CELU JEST ZAMKNIĘTA: identyfikator z segmentu dynamicznego nie
 *    steruje adresem w panelu. Asercje idą na ADRES, pod który poszedł
 *    podstawiony `fetch` — sam kod odpowiedzi niczego by nie dowiódł, bo
 *    przy sklejaniu napisów żądanie leciało pod cudzy adres i wracało
 *    z całkiem sensownym statusem.
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN = "sekret-relaya-a1-0123456789";
const INGEST_URL = "http://panel.test:4300";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    surface: "marketing",
    screen: "35 Landing",
    route: "/",
    kind: "point",
    pos_x: 0.4,
    pos_y: 0.2,
    scroll_y: 120,
    body: `uwaga storefrontowa ${randomUUID()}`,
    priority: 2,
    ...overrides,
  };
}

function createRequest(body: Record<string, unknown>, images: Blob[] = []): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify(body));
  for (const image of images) form.append("images", image, "obrazek.png");
  return new Request("http://localhost/api/review/comments", { method: "POST", body: form });
}

describe("kill-switch REVIEW_MODE", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each(["", "0", undefined])("REVIEW_MODE=%s → 404 na GET i POST, zero żądań", async (value) => {
    if (value === undefined) vi.stubEnv("REVIEW_MODE", "");
    else vi.stubEnv("REVIEW_MODE", value);
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);

    const { GET, POST } = await import("../app/api/review/comments/route");
    const get = await GET(new Request("http://localhost/api/review/comments"));
    expect(get.status).toBe(404);
    const post = await POST(createRequest(payload()));
    expect(post.status).toBe(404);
    expect(outbound).not.toHaveBeenCalled();
  });

  /**
   * DRUGI ZAMEK, WPROWADZONY PRZY ODSŁONIĘCIU LP (ADR-128). Do 2026-08-10
   * przegląd miał na storefroncie dwie bramki serwerowe: REVIEW_MODE oraz
   * hasło całego site'u. Po zdjęciu hasła sama flaga wystawiona przez pomyłkę
   * w produkcji otwierałaby nakładkę i zapis uwag każdemu z `?review=1`.
   * `VERCEL_ENV` (zmienna SYSTEMOWA platformy) domyka produkcję niezależnie
   * od flagi — preview i lokalne uruchomienia zostają nietknięte, bo na nich
   * ta zmienna ma inną wartość albo nie istnieje.
   */
  it("REVIEW_MODE=1, ale VERCEL_ENV=production → 404, zero żądań", async () => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("REVIEW_INGEST_TOKEN", TOKEN);
    vi.stubEnv("VERCEL_ENV", "production");
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);

    const { GET, POST } = await import("../app/api/review/comments/route");
    expect((await GET(new Request("http://localhost/api/review/comments"))).status).toBe(404);
    expect((await POST(createRequest(payload()))).status).toBe(404);
    expect(outbound, "produkcja nie może wypuścić żądania z sekretem relaya").not.toHaveBeenCalled();
  });

  it.each(["preview", "development", ""])(
    "REVIEW_MODE=1 przy VERCEL_ENV=%s zostawia przegląd otwarty (podgląd i e2e działają)",
    async (env) => {
      const { isReviewSurfaceEnabled } = await import("../lib/review-gate");

      expect(isReviewSurfaceEnabled({ REVIEW_MODE: "1", VERCEL_ENV: env })).toBe(true);
      expect(isReviewSurfaceEnabled({ REVIEW_MODE: "1" }), "brak zmiennej = lokalnie/e2e").toBe(true);
    },
  );

  it("bramka jest fail-closed na kształcie flagi, nie tylko na jej braku", async () => {
    const { isReviewSurfaceEnabled } = await import("../lib/review-gate");

    for (const flaga of [undefined, "", "0", "true", "TRUE", "1 ", " 1", "yes"]) {
      expect(
        isReviewSurfaceEnabled(flaga === undefined ? {} : { REVIEW_MODE: flaga }),
        `REVIEW_MODE=${JSON.stringify(flaga)} otworzyło bramkę`,
      ).toBe(false);
    }
    expect(isReviewSurfaceEnabled({ REVIEW_MODE: "1" })).toBe(true);
  });

  it("REVIEW_MODE off → 404 na PATCH", async () => {
    vi.stubEnv("REVIEW_MODE", "0");
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);

    const { PATCH } = await import("../app/api/review/comments/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      }),
      { params: Promise.resolve({ id: randomUUID() }) },
    );
    expect(response.status).toBe(404);
    expect(outbound).not.toHaveBeenCalled();
  });
});

describe("relay bez sekretu", () => {
  beforeEach(() => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("REVIEW_INGEST_TOKEN", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("brak REVIEW_INGEST_TOKEN → 503 i ZERO żądań wychodzących", async () => {
    const outbound = vi.fn();
    vi.stubGlobal("fetch", outbound);

    const { GET, POST } = await import("../app/api/review/comments/route");
    const get = await GET(new Request("http://localhost/api/review/comments"));
    expect(get.status).toBe(503);
    const post = await POST(createRequest(payload()));
    expect(post.status).toBe(503);

    expect(outbound).not.toHaveBeenCalled();
  });

  it("komunikat 503 nie zdradza nazw zmiennych środowiskowych", async () => {
    const { GET } = await import("../app/api/review/comments/route");
    const body = await (await GET(new Request("http://localhost/api/review/comments"))).text();

    expect(body).not.toContain("REVIEW_INGEST_TOKEN");
    expect(body).not.toContain("REVIEW_MODE");
  });
});

describe("relay do ingest panelu przy REVIEW_MODE=1", () => {
  beforeEach(() => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("REVIEW_INGEST_TOKEN", TOKEN);
    vi.stubEnv("REVIEW_INGEST_URL", INGEST_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("GET: ścieżka ingest + query bez zmian + token w nagłówku", async () => {
    const outbound = vi.fn(async () =>
      Response.json({ comments: [{ id: "abc" }] }, { headers: { "set-cookie": "panel=nie" } }),
    );
    vi.stubGlobal("fetch", outbound);

    const { GET } = await import("../app/api/review/comments/route");
    const response = await GET(
      new Request("http://localhost/api/review/comments?surface=marketing&route=%2F"),
    );

    expect(outbound).toHaveBeenCalledTimes(1);
    const [target, init] = outbound.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(target)).toBe(
      `${INGEST_URL}/api/review/ingest/comments?surface=marketing&route=%2F`,
    );
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(init.method).toBe("GET");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ comments: [{ id: "abc" }] });
    // Nagłówki panelu (np. ciasteczka) NIE przechodzą przez relay.
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("POST: multipart z boundary i bajty ciała przechodzą bez zmian", async () => {
    const outbound = vi.fn(async () => Response.json({ comment: { id: "abc" } }, { status: 201 }));
    vi.stubGlobal("fetch", outbound);

    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const body = payload();
    const request = createRequest(body, [new Blob([png], { type: "image/png" })]);
    const originalType = request.headers.get("content-type") as string;

    const { POST } = await import("../app/api/review/comments/route");
    const response = await POST(request);

    expect(outbound).toHaveBeenCalledTimes(1);
    const [target, init] = outbound.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(target)).toBe(`${INGEST_URL}/api/review/ingest/comments`);
    expect(init.method).toBe("POST");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    // Boundary multipart musi przejść co do bajtu — inaczej panel nie
    // sparsuje formularza.
    expect(headers.get("content-type")).toBe(originalType);
    const forwarded = new Request("http://x", {
      method: "POST",
      headers: { "content-type": originalType },
      body: init.body as ArrayBuffer,
    });
    const form = await forwarded.formData();
    expect(JSON.parse(form.get("payload") as string)).toEqual(body);
    const image = form.getAll("images")[0] as File;
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(png);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ comment: { id: "abc" } });
  });

  it("PATCH: identyfikator w ścieżce, JSON ciała i status odpowiedzi 1:1", async () => {
    const outbound = vi.fn(async () => Response.json({ error: "brak wiersza" }, { status: 400 }));
    vi.stubGlobal("fetch", outbound);

    const id = randomUUID();
    const { PATCH } = await import("../app/api/review/comments/[id]/route");
    const response = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done", priority: 1 }),
      }),
      { params: Promise.resolve({ id }) },
    );

    expect(outbound).toHaveBeenCalledTimes(1);
    const [target, init] = outbound.mock.calls[0] as unknown as [URL | string, RequestInit];
    expect(String(target)).toBe(`${INGEST_URL}/api/review/ingest/comments/${id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(new TextDecoder().decode(init.body as ArrayBuffer))).toEqual({
      status: "done",
      priority: 1,
    });

    expect(response.status).toBe(400);
  });

  it("panel nieosiągalny → 502, bez wycieku szczegółów", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:4300");
      }),
    );

    const { GET } = await import("../app/api/review/comments/route");
    const response = await GET(new Request("http://localhost/api/review/comments"));

    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("4300");
  });
});

/**
 * Regresja po sondzie PM na #217: identyfikator uwagi był wklejany do
 * ścieżki relaya, więc wołający sterował adresem w panelu, a token relaya
 * jechał tam razem z nim (`/comments/../../jobs/wysylka` →
 * `http://panel/api/review/jobs/wysylka`). Dowodem naprawy jest ADRES
 * wychodzącego żądania, nie status odpowiedzi.
 */
describe("ścieżka relaya nie pochodzi od wołającego", () => {
  const WROGIE = ["../../jobs/wysylka", "../../../../api/jobs/reconcile", "..%2F..%2Fjobs"];

  function patchRequest(): Request {
    return new Request("http://localhost/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
  }

  beforeEach(() => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("REVIEW_INGEST_TOKEN", TOKEN);
    vi.stubEnv("REVIEW_INGEST_URL", INGEST_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([...WROGIE, ".."])(
    "trasa odrzuca identyfikator %j → 404 i ZERO żądań wychodzących",
    async (id) => {
      const outbound = vi.fn(async () => Response.json({ ok: true }));
      vi.stubGlobal("fetch", outbound);

      const { PATCH } = await import("../app/api/review/comments/[id]/route");
      const response = await PATCH(patchRequest(), { params: Promise.resolve({ id }) });

      expect(response.status).toBe(404);
      expect(outbound).not.toHaveBeenCalled();
    },
  );

  it("trasa z UUID-em trafia dokładnie pod ingest uwagi", async () => {
    const outbound = vi.fn(async () => Response.json({ comment: { id: "abc" } }));
    vi.stubGlobal("fetch", outbound);

    const id = randomUUID();
    const { PATCH } = await import("../app/api/review/comments/[id]/route");
    await PATCH(patchRequest(), { params: Promise.resolve({ id }) });

    expect(outbound).toHaveBeenCalledTimes(1);
    const [target] = outbound.mock.calls[0] as unknown as [URL | string];
    expect(String(target)).toBe(`${INGEST_URL}/api/review/ingest/comments/${id}`);
  });

  it.each(WROGIE)(
    "sam relay (z pominięciem walidacji trasy) nie wyprowadza tokenu poza ingest — %j",
    async (id) => {
      const outbound = vi.fn(async () => Response.json({ ok: true }));
      vi.stubGlobal("fetch", outbound);

      const { relayReviewRequest } = await import("../lib/review-relay");
      await relayReviewRequest(patchRequest(), { resource: "comment", id });

      // Identyfikator zostaje JEDNYM segmentem: separatory są zakodowane,
      // więc adres nie może wyjść poza /api/review/ingest/.
      for (const [target] of outbound.mock.calls as unknown as [URL | string][]) {
        expect(String(target)).toBe(
          `${INGEST_URL}/api/review/ingest/comments/${encodeURIComponent(id)}`,
        );
        expect(new URL(String(target)).pathname.startsWith("/api/review/ingest/")).toBe(true);
      }
      expect(outbound).toHaveBeenCalledTimes(1);
    },
  );

  it("sam relay przy segmencie `..` → 400 fail-closed i ZERO żądań", async () => {
    const outbound = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", outbound);

    const { relayReviewRequest } = await import("../lib/review-relay");
    const response = await relayReviewRequest(patchRequest(), { resource: "comment", id: ".." });

    expect(response.status).toBe(400);
    expect(outbound).not.toHaveBeenCalled();
    // Odmowa nie nazywa zmiennych środowiskowych (dyscyplina U1).
    const body = await response.text();
    expect(body).not.toContain("REVIEW_INGEST");
  });
});
