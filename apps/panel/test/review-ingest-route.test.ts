/**
 * Trasy ingest uwag przeglądu — bramki wejścia (ADR-099/ADR-115).
 *
 * DOWODZIMY NIE KODU ODPOWIEDZI, TYLKO BRAKU PRACY (wzorzec
 * payment-reconciliation-route.test.ts): każdy przypadek negatywny sprawdza
 * odmowę ORAZ to, że warstwa zapisu NIE RUSZYŁA — ani fabryka klienta
 * service_role, ani handlery rdzenia @avably/review nie zostały wywołane.
 *
 * Kluczowa bramka, której przed ADR-115 nie było: REVIEW_MODE po stronie
 * PANELU. Relay storefrontu „i tak nie zawoła" poza trybem przeglądu — ale
 * endpoint z kluczem omijającym RLS nie może polegać na grzeczności
 * wołającego. Wyłączony tryb przeglądu = 404 nawet z poprawnym tokenem.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const work = vi.hoisted(() => ({ clients: 0, handlers: 0 }));

vi.mock("@/app/api/review/ingest/client", () => ({
  reviewIngestClient: () => {
    work.clients += 1;
    return {};
  },
}));

vi.mock("@avably/review", () => ({
  handleListRequest: async () => {
    work.handlers += 1;
    return Response.json({ comments: [] });
  },
  handleCreateRequest: async () => {
    work.handlers += 1;
    return Response.json({ comment: {} }, { status: 201 });
  },
  handlePatchRequest: async () => {
    work.handlers += 1;
    return Response.json({ comment: {} });
  },
}));

const { GET, POST } = await import("@/app/api/review/ingest/comments/route");
const { PATCH } = await import("@/app/api/review/ingest/comments/[id]/route");

const TOKEN = "sekret-ingest-a1-0123456789";

function listRequest(authorization?: string): Request {
  return new Request("https://panel.test/api/review/ingest/comments?surface=marketing", {
    headers: authorization ? { authorization } : {},
  });
}

function patchRequest(authorization?: string): Request {
  return new Request("https://panel.test/x", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify({ status: "done" }),
  });
}

const PATCH_PARAMS = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };

describe("trasy ingest przeglądu — bramki wejścia", () => {
  const previousMode = process.env.REVIEW_MODE;
  const previousToken = process.env.REVIEW_INGEST_TOKEN;

  beforeEach(() => {
    work.clients = 0;
    work.handlers = 0;
    process.env.REVIEW_MODE = "1";
    process.env.REVIEW_INGEST_TOKEN = TOKEN;
  });

  afterEach(() => {
    if (previousMode === undefined) delete process.env.REVIEW_MODE;
    else process.env.REVIEW_MODE = previousMode;
    if (previousToken === undefined) delete process.env.REVIEW_INGEST_TOKEN;
    else process.env.REVIEW_INGEST_TOKEN = previousToken;
  });

  it("REVIEW_MODE wyłączony → 404 NAWET z poprawnym tokenem, zero pracy", async () => {
    process.env.REVIEW_MODE = "0";

    for (const response of [
      await GET(listRequest(`Bearer ${TOKEN}`)),
      await POST(listRequest(`Bearer ${TOKEN}`)),
      await PATCH(patchRequest(`Bearer ${TOKEN}`), PATCH_PARAMS),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("BRAK skonfigurowanego sekretu → 503 i zero pracy (nigdy przepustka)", async () => {
    delete process.env.REVIEW_INGEST_TOKEN;

    const response = await GET(listRequest(`Bearer ${TOKEN}`));

    expect(response.status).toBe(503);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("komunikat 503 nie zdradza nazwy zmiennej środowiskowej", async () => {
    delete process.env.REVIEW_INGEST_TOKEN;

    const body = await (await GET(listRequest())).text();

    expect(body).not.toContain("REVIEW_INGEST_TOKEN");
    expect(body).not.toContain("REVIEW_MODE");
  });

  it("BEZ nagłówka → 401 i zero pracy", async () => {
    const response = await POST(listRequest());

    expect(response.status).toBe(401);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("ZŁY token → 401 i zero pracy", async () => {
    const response = await POST(listRequest("Bearer zupelnie-inny-token"));

    expect(response.status).toBe(401);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("token różniący się JEDNYM bajtem → 401 i zero pracy", async () => {
    const almost = `${TOKEN.slice(0, -1)}X`;
    expect(almost).toHaveLength(TOKEN.length);
    expect(almost).not.toBe(TOKEN);

    const response = await PATCH(patchRequest(`Bearer ${almost}`), PATCH_PARAMS);

    expect(response.status).toBe(401);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("token będący PREFIKSEM poprawnego → 401 i zero pracy", async () => {
    const response = await GET(listRequest(`Bearer ${TOKEN.slice(0, -3)}`));

    expect(response.status).toBe(401);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("sam token bez schematu `Bearer` → 401 i zero pracy", async () => {
    const response = await GET(listRequest(TOKEN));

    expect(response.status).toBe(401);
    expect(work.clients).toBe(0);
  });

  it("POPRAWNY token przy REVIEW_MODE=1 → praca wykonana dokładnie raz", async () => {
    const listed = await GET(listRequest(`Bearer ${TOKEN}`));
    expect(listed.status).toBe(200);
    expect(work.clients).toBe(1);
    expect(work.handlers).toBe(1);

    const created = await POST(listRequest(`Bearer ${TOKEN}`));
    expect(created.status).toBe(201);

    const patched = await PATCH(patchRequest(`Bearer ${TOKEN}`), PATCH_PARAMS);
    expect(patched.status).toBe(200);

    expect(work.clients).toBe(3);
    expect(work.handlers).toBe(3);
  });
});
