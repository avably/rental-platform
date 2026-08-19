/**
 * Publiczny zapis uwag przeglądu NA ŻYWEJ BAZIE (ADR-206).
 *
 * Prawdziwe trasy, prawdziwe bramki, prawdziwy service_role lokalnego
 * stacka — dowód, że po rozdziale ZAPIS/PRZEGLĄD:
 *  1. ANONIM (zero sesji — poza żądaniem Next `cookies()` rzuca, bramka
 *     łapie i zapisuje createdBy=null) tworzy uwagę POST-em → 201, a wiersz
 *     w bazie ma created_by NULL mimo RLS 0033, które anonowi nie daje
 *     nawet grantu — bo zapis idzie kontrolowaną bramą service_role.
 *  2. POST zwraca WYŁĄCZNIE utworzoną uwagę — nigdy listy cudzych uwag
 *     (klucz `comment`, brak klucza `comments`).
 *  3. PATCH bez sesji zmienia własną uwagę (autor zna jej UUID z odpowiedzi).
 *  4. GET na tej samej trasie w tych samych warunkach → 404: zapisujący
 *     NIE MA drogi odczytu zebranych uwag (granica ADR-206).
 */
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    surface: "panel",
    screen: "17 Rejestracja",
    route: "/register",
    kind: "point",
    pos_x: 0.4,
    pos_y: 0.2,
    scroll_y: 0,
    body: `uwaga anonima z rejestracji ${randomUUID()}`,
    priority: 2,
    ...overrides,
  };
}

function createRequest(body: Record<string, unknown>, ip: string): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify(body));
  return new Request("http://localhost/api/review/comments", {
    method: "POST",
    headers: { "x-real-ip": ip },
    body: form,
  });
}

describe.runIf(hasEnv)("publiczny zapis uwag na żywej bazie (ADR-206)", () => {
  const createdIds: string[] = [];
  const ip = `test-${randomUUID()}`;

  beforeAll(() => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.SUPABASE_LOCAL_API_URL as string);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string);
  });

  afterAll(async () => {
    // Sprzątanie kluczem HARNESSU testowego (SUPABASE_LOCAL_*), nie fabryką
    // @avably/db/service — bramka audit-service-role.sh pilnuje ścieżek
    // PRODUKCYJNYCH i test nie ma prawa być od niej wyjątkiem.
    const { createClient } = await import("@supabase/supabase-js");
    const client = createClient(
      process.env.SUPABASE_LOCAL_API_URL as string,
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false } },
    );
    for (const id of createdIds) {
      await client.from("review_comments").delete().eq("id", id);
    }
    vi.unstubAllEnvs();
  });

  it("anonim: POST → 201, wiersz w bazie z created_by NULL, odpowiedź bez listy", async () => {
    const { POST } = await import("@/app/api/review/comments/route");

    const created = await POST(createRequest(payload(), ip));
    expect(created.status, await created.clone().text()).toBe(201);

    const body = (await created.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("comment");
    // POST nie zwraca listy cudzych uwag — tylko utworzoną uwagę.
    expect(body).not.toHaveProperty("comments");

    const comment = body.comment as { id: string; status: string };
    createdIds.push(comment.id);
    expect(comment.status).toBe("open");

    const { createClient } = await import("@supabase/supabase-js");
    const harness = createClient(
      process.env.SUPABASE_LOCAL_API_URL as string,
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string,
      { auth: { persistSession: false } },
    );
    const { data: row, error } = await harness
      .from("review_comments")
      .select("id, created_by")
      .eq("id", comment.id)
      .single();
    expect(error, `odczyt kontrolny: ${error?.message}`).toBeNull();
    expect(row?.created_by, "anonimowy zapis dostał aktora").toBeNull();
  });

  it("anonim: PATCH własnej uwagi (UUID z odpowiedzi POST) → 200", async () => {
    const { POST } = await import("@/app/api/review/comments/route");
    const { PATCH } = await import("@/app/api/review/comments/[id]/route");

    const created = await POST(createRequest(payload(), ip));
    expect(created.status, await created.clone().text()).toBe(201);
    const { comment } = (await created.json()) as { comment: { id: string } };
    createdIds.push(comment.id);

    const patched = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-real-ip": ip },
        body: JSON.stringify({ body: "poprawiona treść uwagi", priority: 1 }),
      }),
      { params: Promise.resolve({ id: comment.id }) },
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
    const done = (await patched.json()) as { comment: { priority: number } };
    expect(done.comment.priority).toBe(1);
  });

  it("GET w tych samych warunkach → 404: zapisujący nie odczyta zebranych uwag", async () => {
    const { GET } = await import("@/app/api/review/comments/route");

    const listed = await GET(
      new Request("http://localhost/api/review/comments?surface=panel&route=%2Fregister", {
        headers: { "x-real-ip": ip },
      }),
    );

    expect(listed.status).toBe(404);
  });

  it("kill-switch na żywym przebiegu: REVIEW_MODE=0 → POST 404, zero nowych wierszy", async () => {
    vi.stubEnv("REVIEW_MODE", "0");
    try {
      const { POST } = await import("@/app/api/review/comments/route");
      const marker = `kill-switch-${randomUUID()}`;

      const response = await POST(createRequest(payload({ body: marker }), ip));
      expect(response.status).toBe(404);

      const { createClient } = await import("@supabase/supabase-js");
      const harness = createClient(
        process.env.SUPABASE_LOCAL_API_URL as string,
        process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string,
        { auth: { persistSession: false } },
      );
      const { data } = await harness.from("review_comments").select("id").eq("body", marker);
      expect(data ?? [], "wiersz powstał mimo wyłączonego trybu").toHaveLength(0);
    } finally {
      vi.stubEnv("REVIEW_MODE", "1");
    }
  });
});
