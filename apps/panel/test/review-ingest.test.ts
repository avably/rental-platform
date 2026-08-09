/**
 * Trasy ingest uwag przeglądu — przebieg na żywej bazie (ADR-099/ADR-115).
 *
 * Dowodzi, że po przejściu bramek (REVIEW_MODE=1 + poprawny token) zapis,
 * odczyt i zmiana uwagi biegną service_rolem DOKŁADNIE tak, jak przed
 * przeprowadzką biegły w storefroncie (dawny storefront/test/review-api.test.ts)
 * — z uploadem załącznika do prywatnego bucketa i signed URL-em włącznie.
 *
 * Powierzchnia tokenu: test „obce pola" dowodzi, że payload nie ma jak
 * przemycić identyfikatora tenanta ani wskazać innej tabeli — zod odrzuca
 * nieznaną powierzchnię, a obce klucze wycina przed zapisem.
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

const TOKEN = "sekret-ingest-integracyjny-a1";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function payload(overrides: Record<string, unknown> = {}) {
  return {
    surface: "marketing",
    screen: "35 Landing",
    route: "/",
    kind: "point",
    pos_x: 0.4,
    pos_y: 0.2,
    scroll_y: 120,
    body: `uwaga przez ingest ${randomUUID()}`,
    priority: 2,
    ...overrides,
  };
}

function createRequest(body: Record<string, unknown>, images: Blob[] = []): Request {
  const form = new FormData();
  form.set("payload", JSON.stringify(body));
  for (const image of images) form.append("images", image, "obrazek.png");
  return new Request("http://localhost/api/review/ingest/comments", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: form,
  });
}

describe.runIf(hasEnv)("ingest przeglądu na żywej bazie (service_role w panelu)", () => {
  const createdIds: string[] = [];

  beforeAll(() => {
    vi.stubEnv("REVIEW_MODE", "1");
    vi.stubEnv("REVIEW_INGEST_TOKEN", TOKEN);
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

  it("POST zapisuje punkt, GET filtruje po trasie, PATCH przełącza status", async () => {
    const { GET, POST } = await import("@/app/api/review/ingest/comments/route");
    const { PATCH } = await import("@/app/api/review/ingest/comments/[id]/route");

    const created = await POST(createRequest(payload()));
    expect(created.status, await created.clone().text()).toBe(201);
    const { comment } = (await created.json()) as { comment: { id: string; status: string } };
    createdIds.push(comment.id);
    expect(comment.status).toBe("open");

    const listed = await GET(
      new Request("http://localhost/api/review/ingest/comments?surface=marketing&route=%2F", {
        headers: { authorization: `Bearer ${TOKEN}` },
      }),
    );
    expect(listed.status).toBe(200);
    const { comments } = (await listed.json()) as { comments: { id: string }[] };
    expect(comments.map((c) => c.id)).toContain(comment.id);

    const patched = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ status: "done", priority: 1 }),
      }),
      { params: Promise.resolve({ id: comment.id }) },
    );
    expect(patched.status, await patched.clone().text()).toBe(200);
    const done = (await patched.json()) as { comment: { status: string; priority: number } };
    expect(done.comment.status).toBe("done");
    expect(done.comment.priority).toBe(1);
  });

  it("POST z obrazkiem: plik ląduje w prywatnym buckecie, wraca signed URL", async () => {
    const { POST } = await import("@/app/api/review/ingest/comments/route");
    const created = await POST(
      createRequest(payload({ kind: "area", area_w: 0.3, area_h: 0.2 }), [
        new Blob([PNG], { type: "image/png" }),
      ]),
    );
    expect(created.status, await created.clone().text()).toBe(201);
    const { comment } = (await created.json()) as {
      comment: { id: string; attachments: { url: string }[] };
    };
    createdIds.push(comment.id);
    expect(comment.attachments).toHaveLength(1);
    const image = await fetch(comment.attachments[0]!.url);
    expect(image.status, "signed URL nie serwuje obrazka").toBe(200);
  });

  it("walidacja odbija: zły priorytet, zła powierzchnia, area bez wymiarów", async () => {
    const { POST } = await import("@/app/api/review/ingest/comments/route");
    for (const bad of [
      payload({ priority: 9 }),
      payload({ surface: "cockpit" }),
      payload({ kind: "area" }),
    ]) {
      const response = await POST(createRequest(bad));
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it("obce pola payloadu (tenant_id, tabela) nie przechodzą do zapisu", async () => {
    const { POST } = await import("@/app/api/review/ingest/comments/route");
    const created = await POST(
      createRequest(payload({ tenant_id: randomUUID(), table: "orders", created_by: randomUUID() })),
    );
    // Zod wycina nieznane klucze; wiersz powstaje bez nich, a `created_by`
    // ustawia WYŁĄCZNIE handler (droga ingest = null, jak dawniej storefront).
    expect(created.status, await created.clone().text()).toBe(201);
    const { comment } = (await created.json()) as { comment: Record<string, unknown> & { id: string } };
    createdIds.push(comment.id);
    expect(comment).not.toHaveProperty("tenant_id");
    expect(comment).not.toHaveProperty("table");
  });
});
