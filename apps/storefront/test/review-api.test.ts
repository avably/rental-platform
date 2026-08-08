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
