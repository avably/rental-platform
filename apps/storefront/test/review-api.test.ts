/**
 * Endpoint przeglądu na storefroncie (ADR-071) — dwa dowody:
 *
 * 1. KILL-SWITCH bez środowiska: REVIEW_MODE wyłączony → 404 zanim powstanie
 *    jakikolwiek klient (endpoint „nie istnieje"). To biegnie zawsze, także
 *    w jobie ci bez Supabase.
 * 2. Integracyjnie (SUPABASE_LOCAL_*): przy REVIEW_MODE=1 zapis/odczyt/patch
 *    przechodzą service_rolem, walidacja odbija śmieci, upload obrazka ląduje
 *    w prywatnym buckecie i wraca signed URL-em.
 */
import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

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
  });

  it.each(["", "0", undefined])("REVIEW_MODE=%s → 404 na GET i POST", async (value) => {
    if (value === undefined) vi.stubEnv("REVIEW_MODE", "");
    else vi.stubEnv("REVIEW_MODE", value);
    const { GET, POST } = await import("../app/api/review/comments/route");
    const get = await GET(new Request("http://localhost/api/review/comments"));
    expect(get.status).toBe(404);
    const post = await POST(createRequest(payload()));
    expect(post.status).toBe(404);
  });

  it("REVIEW_MODE off → 404 na PATCH", async () => {
    vi.stubEnv("REVIEW_MODE", "0");
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
  });
});

describe.runIf(hasEnv)("zapis service_rolem przy REVIEW_MODE=1 (integracyjnie)", () => {
  const createdIds: string[] = [];

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

  it("POST zapisuje punkt, GET filtruje po trasie, PATCH przełącza status", async () => {
    const { GET, POST } = await import("../app/api/review/comments/route");
    const { PATCH } = await import("../app/api/review/comments/[id]/route");

    const created = await POST(createRequest(payload()));
    expect(created.status, await created.clone().text()).toBe(201);
    const { comment } = (await created.json()) as { comment: { id: string; status: string } };
    createdIds.push(comment.id);
    expect(comment.status).toBe("open");

    const listed = await GET(
      new Request("http://localhost/api/review/comments?surface=marketing&route=%2F"),
    );
    expect(listed.status).toBe(200);
    const { comments } = (await listed.json()) as { comments: { id: string }[] };
    expect(comments.map((c) => c.id)).toContain(comment.id);

    const patched = await PATCH(
      new Request("http://localhost/x", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
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
    const { POST } = await import("../app/api/review/comments/route");
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
    const { POST } = await import("../app/api/review/comments/route");
    for (const bad of [
      payload({ priority: 9 }),
      payload({ surface: "cockpit" }),
      payload({ kind: "area" }),
    ]) {
      const response = await POST(createRequest(bad));
      expect(response.status, JSON.stringify(bad)).toBe(400);
    }
  });
});
