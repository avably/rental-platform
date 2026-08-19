/**
 * Trasy /api/review/comments — bramki wejścia po rozdziale ZAPIS/PRZEGLĄD
 * (ADR-206). Wzorzec review-ingest-route.test.ts: DOWODZIMY NIE KODU
 * ODPOWIEDZI, TYLKO BRAKU PRACY — każdy przypadek negatywny sprawdza odmowę
 * ORAZ to, że ani szew klienta service_role, ani handlery rdzenia
 * @avably/review nie zostały wywołane.
 *
 * Trzy kontrakty, których broni ten plik:
 *  1. KILL-SWITCH: REVIEW_MODE≠1 → 404 na GET/POST/PATCH, zero pracy.
 *  2. ZAPIS BEZ SUPERADMINA: przy REVIEW_MODE=1 anonim przechodzi bramkę
 *     zapisu (POST/PATCH), a snapshot aktora (createdBy) niesie id usera
 *     tylko wtedy, gdy żądanie ma sesję.
 *  3. PRZEGLĄD ZOSTAJE SUPERADMINOWY: GET dla anonima i zwykłego usera
 *     odpowiada 404 i nie wykonuje ŻADNEJ pracy — zdjęcie superadmina
 *     z odczytu to regresja, nie feature (granica ADR-206).
 *  4. RATE LIMIT: seria zapisów z jednego IP ponad próg → 429 i zero pracy
 *     (odmowa pada w bramce, zanim ktokolwiek dotknie handlera).
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REVIEW_WRITE_LIMIT } from "@/lib/review-write-guard";

const work = vi.hoisted(() => ({
  clients: 0,
  handlers: 0,
  createdBy: [] as (string | null)[],
}));

let claims: Record<string, unknown> | null = null;

vi.mock("@/app/api/review/client", () => ({
  reviewServiceClient: () => {
    work.clients += 1;
    return {};
  },
}));

vi.mock("@avably/review", () => ({
  handleListRequest: async () => {
    work.handlers += 1;
    return Response.json({ comments: [] });
  },
  handleCreateRequest: async (_client: unknown, _request: unknown, createdBy: string | null) => {
    work.handlers += 1;
    work.createdBy.push(createdBy);
    return Response.json({ comment: {} }, { status: 201 });
  },
  handlePatchRequest: async () => {
    work.handlers += 1;
    return Response.json({ comment: {} });
  },
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: null },
    },
  }),
}));

const { GET, POST } = await import("@/app/api/review/comments/route");
const { PATCH } = await import("@/app/api/review/comments/[id]/route");

const PATCH_PARAMS = { params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000001" }) };

/** Unikalne IP per przypadek — kubełki rate limitu nie przeciekają między testami. */
function uniqueIp(): string {
  return `test-${randomUUID()}`;
}

function postRequest(ip: string): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify({}));
  return new Request("https://panel.test/api/review/comments", {
    method: "POST",
    headers: { "x-real-ip": ip },
    body: form,
  });
}

function getRequest(): Request {
  return new Request("https://panel.test/api/review/comments?surface=panel&route=%2Fregister");
}

function patchRequest(ip: string): Request {
  return new Request("https://panel.test/x", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: JSON.stringify({ status: "done" }),
  });
}

function session(appMetadata: Record<string, unknown>): Record<string, unknown> {
  return {
    sub: "00000000-0000-4000-8000-00000000000a",
    email: "user@example.com",
    aal: "aal1",
    app_metadata: appMetadata,
  };
}

beforeEach(() => {
  work.clients = 0;
  work.handlers = 0;
  work.createdBy.length = 0;
  claims = null;
  vi.stubEnv("REVIEW_MODE", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("kill-switch REVIEW_MODE", () => {
  it("REVIEW_MODE=0 → 404 na GET/POST/PATCH i zero pracy", async () => {
    vi.stubEnv("REVIEW_MODE", "0");

    for (const response of [
      await GET(getRequest()),
      await POST(postRequest(uniqueIp())),
      await PATCH(patchRequest(uniqueIp()), PATCH_PARAMS),
    ]) {
      expect(response.status).toBe(404);
    }
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("REVIEW_MODE niezdefiniowany → 404 i zero pracy", async () => {
    vi.stubEnv("REVIEW_MODE", "");

    const response = await POST(postRequest(uniqueIp()));

    expect(response.status).toBe(404);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });
});

describe("zapis bez superadmina (ADR-206)", () => {
  it("anonim: POST przechodzi bramkę zapisu — handler dostaje szew service_role i createdBy=null", async () => {
    const response = await POST(postRequest(uniqueIp()));

    expect(response.status).toBe(201);
    expect(work.clients).toBe(1);
    expect(work.handlers).toBe(1);
    expect(work.createdBy).toEqual([null]);
  });

  it("zwykły user (nie superadmin): POST przechodzi, createdBy = id z sesji", async () => {
    claims = session({ tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" });

    const response = await POST(postRequest(uniqueIp()));

    expect(response.status).toBe(201);
    expect(work.createdBy).toEqual(["00000000-0000-4000-8000-00000000000a"]);
  });

  it("anonim: PATCH przechodzi bramkę zapisu", async () => {
    const response = await PATCH(patchRequest(uniqueIp()), PATCH_PARAMS);

    expect(response.status).toBe(200);
    expect(work.clients).toBe(1);
    expect(work.handlers).toBe(1);
  });
});

describe("PRZEGLĄD zostaje superadminowy — granica ADR-206", () => {
  it("GET jako anonim → 404 i zero pracy", async () => {
    const response = await GET(getRequest());

    expect(response.status).toBe(404);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });

  it("GET jako zwykły user (nie superadmin) → 404 i zero pracy", async () => {
    claims = session({ tenant_id: "00000000-0000-4000-8000-000000000009", role: "owner" });

    const response = await GET(getRequest());

    expect(response.status).toBe(404);
    expect(work.clients).toBe(0);
    expect(work.handlers).toBe(0);
  });
});

describe("rate limit zapisu", () => {
  it(`próg ${REVIEW_WRITE_LIMIT} przechodzi, próg+1 → 429 i zero dalszej pracy`, async () => {
    const ip = uniqueIp();

    for (let i = 0; i < REVIEW_WRITE_LIMIT; i += 1) {
      const response = await POST(postRequest(ip));
      expect(response.status, `zapis ${i + 1}/${REVIEW_WRITE_LIMIT} odbity za wcześnie`).toBe(201);
    }
    expect(work.handlers).toBe(REVIEW_WRITE_LIMIT);

    const throttled = await POST(postRequest(ip));

    expect(throttled.status).toBe(429);
    expect(work.handlers, "handler ruszył mimo odmowy limitu").toBe(REVIEW_WRITE_LIMIT);
    expect(work.clients, "szew service_role dotknięty mimo odmowy limitu").toBe(
      REVIEW_WRITE_LIMIT,
    );
  });

  it("odmowa limitu nie zdradza nazw konfiguracji", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < REVIEW_WRITE_LIMIT; i += 1) await POST(postRequest(ip));

    const body = await (await POST(postRequest(ip))).text();

    expect(body).not.toContain("REVIEW_MODE");
    expect(body).not.toContain("RATE_LIMIT");
  });
});
