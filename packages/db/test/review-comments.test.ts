/**
 * 0033 / ADR-071 — uwagi przeglądu produktu (narzędzie wewnętrzne).
 *
 * Oś izolacji jest platformowa (jak waitlist_signups): publiczność i najemca
 * NIE widzą i NIE piszą; superadmin widzi i pisze wszystko. Testy dowodzą
 * ZACHOWANIA (odmowa/pusta lista/mutacja bez zasięgu), nie istnienia polityk.
 * Do tego bramki CHECK (priority 1..5, status, kształt area) i prywatny
 * bucket review-attachments (anon/najemca odbici, superadmin przechodzi).
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const migrationUrl = new URL("../supabase/migrations/0033_review_comments.sql", import.meta.url);
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);
const BUCKET = "review-attachments";
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_CHECK_VIOLATION = "23514";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEST_PASSWORD = "ReviewRls!12345678";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak ${name}`);
  return value;
}

function commentRow(overrides: Record<string, unknown> = {}) {
  return {
    surface: "panel",
    screen: "01 Dashboard",
    route: "/",
    kind: "point",
    pos_x: 0.5,
    pos_y: 0.25,
    scroll_y: 0,
    body: `uwaga testowa ${randomUUID()}`,
    ...overrides,
  };
}

describe("kontrakt migracji 0033", () => {
  it("istnieje i deklaruje tabele platformowe + prywatny bucket superadmina", () => {
    expect(existsSync(fileURLToPath(migrationUrl)), "brak migracji 0033").toBe(true);
    const sql = readFileSync(fileURLToPath(migrationUrl), "utf8");
    expect(sql).toContain("create table public.review_comments");
    expect(sql).toContain("create table public.review_comment_attachments");
    // Tabele PLATFORMOWE — świadomie bez KOLUMNY tenant_id (komentarze mogą
    // ją nazywać, kolumna nie może istnieć).
    expect(sql).not.toMatch(/tenant_id uuid/);
    expect(sql).toMatch(/values\s*\(\s*'review-attachments'\s*,\s*'review-attachments'\s*,\s*false\s*\)/i);
    // Zero grantów dla anon: odmowa ma padać na uprawnieniach, nie na polityce.
    expect(sql).not.toMatch(/grant\s+[^;]*on\s+public\.review_comment(s|_attachments)\s+to\s+anon/i);
    expect(sql).toMatch(/revoke all on public\.review_comments from anon, authenticated/);
  });
});

describe.runIf(hasEnv)("review_comments — publiczność/najemca vs superadmin (RLS + Storage)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let a: TenantCtx;
  let b: TenantCtx;
  let anonClient: SupabaseClient;
  let superadminClient: SupabaseClient;
  let superadminUserId: string;
  let seededId: string;
  const uploadedPaths: string[] = [];

  const clientOptions = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  };

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(requiredEnv("SUPABASE_LOCAL_URL"), { max: 1 });
    ({ a, b } = await seedTwoTenants());

    anonClient = createClient(
      requiredEnv("SUPABASE_LOCAL_API_URL"),
      requiredEnv("SUPABASE_LOCAL_ANON_KEY"),
      clientOptions,
    );

    const email = `review-superadmin-${randomUUID()}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) throw new Error(`createUser(superadmin): ${error?.message}`);
    superadminUserId = data.user.id;
    await sql`insert into app.superadmins (user_id) values (${superadminUserId})`;

    // Logowanie PO wpisie do app.superadmins — claim wchodzi do JWT hookiem.
    superadminClient = createClient(
      requiredEnv("SUPABASE_LOCAL_API_URL"),
      requiredEnv("SUPABASE_LOCAL_ANON_KEY"),
      clientOptions,
    );
    const { error: signInError } = await superadminClient.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError) throw new Error(`Logowanie superadmina: ${signInError.message}`);
  }, 120_000);

  beforeEach(async () => {
    const rows = await sql<{ id: string }[]>`
      insert into public.review_comments (surface, screen, route, kind, pos_x, pos_y, body)
      values ('panel', '01 Dashboard', '/', 'point', 0.5, 0.25, ${`seed-${randomUUID()}`})
      returning id
    `;
    seededId = rows[0].id;
  });

  afterEach(async () => {
    await sql`delete from public.review_comments where id = ${seededId}`;
  });

  afterAll(async () => {
    if (uploadedPaths.length > 0) await admin.storage.from(BUCKET).remove(uploadedPaths);
    await sql`delete from public.review_comments where true`;
    await sql`delete from app.superadmins where user_id = ${superadminUserId}`;
    await admin.auth.admin.deleteUser(superadminUserId);
    await cleanupSeeded(admin);
    await sql.end({ timeout: 5 });
  }, 120_000);

  // ------------------------------------------------------------------
  // Tabele: odczyt/zapis
  // ------------------------------------------------------------------

  it("anon nie odczyta uwag (odmowa na grancie, nie pusta lista)", async () => {
    const { data, error } = await anonClient.from("review_comments").select("*");
    expect(data ?? [], "anon zobaczył uwagi przeglądu").toEqual([]);
    expect(error?.code, `anon dostał inną odpowiedź niż odmowę uprawnień: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("anon nie wstawi uwagi", async () => {
    const { error } = await anonClient.from("review_comments").insert(commentRow());
    expect(error?.code, `anon wstawił uwagę: ${error?.message}`).toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  it("service_role wstawia i czyta BEZ sesji — kontrola pozytywna bramy review (ADR-206)", async () => {
    // Jedyna legalna droga zapisu bez sesji superadmina to kontrolowany
    // endpoint panelu piszący service_rolem (REVIEW_MODE + rate limit,
    // apps/panel/lib/review-write-guard.ts). Ten test przybija, że odmowa
    // dla anon/najemcy wyżej NIE jest artefaktem świeżo zepsutej tabeli:
    // ta sama operacja service_rolem przechodzi.
    const { data: inserted, error } = await admin
      .from("review_comments")
      .insert(commentRow({ created_by: null }))
      .select("id, created_by")
      .single();
    expect(error, `INSERT service_role: ${error?.message}`).toBeNull();
    expect(inserted?.created_by, "snapshot aktora ma być NULL dla anonima").toBeNull();

    const { data: readBack, error: readError } = await admin
      .from("review_comments")
      .select("id")
      .eq("id", inserted!.id);
    expect(readError, `SELECT service_role: ${readError?.message}`).toBeNull();
    expect(readBack ?? []).toHaveLength(1);

    await sql`delete from public.review_comments where id = ${inserted!.id}`;
  });

  it("najemca (owner tenanta) nie widzi uwag — grant jest, polityka zatrzymuje", async () => {
    const { data, error } = await a.ownerClient.from("review_comments").select("*");
    expect(error, `SELECT jako owner: ${error?.message}`).toBeNull();
    expect(data ?? [], "najemca zobaczył uwagi przeglądu").toHaveLength(0);
  });

  it("najemca nie wstawi, nie zmieni ani nie skasuje uwag", async () => {
    const { error: insertError } = await a.ownerClient.from("review_comments").insert(commentRow());
    expect(insertError, "INSERT najemcy przeszedł").not.toBeNull();

    // Mutacje celujące wprost w zasiany wiersz: zasięg polityk UPDATE/DELETE
    // musi być pusty (PostgREST wymaga WHERE, więc filtr po znanym id).
    const { data: updated, error: updateError } = await b.ownerClient
      .from("review_comments")
      .update({ status: "done" })
      .eq("id", seededId)
      .select("id");
    expect(updateError, `UPDATE najemcy: nieoczekiwany błąd ${updateError?.message}`).toBeNull();
    expect(updated ?? [], "najemca zmienił uwagę").toHaveLength(0);

    const { data: deleted, error: deleteError } = await b.ownerClient
      .from("review_comments")
      .delete()
      .eq("id", seededId)
      .select("id");
    expect(deleteError, `DELETE najemcy: nieoczekiwany błąd ${deleteError?.message}`).toBeNull();
    expect(deleted ?? [], "najemca skasował uwagę").toHaveLength(0);

    const check = await sql<{ id: string }[]>`
      select id from public.review_comments where id = ${seededId} and status = 'open'
    `;
    expect(check, "zasiana uwaga zniknęła lub zmieniła status").toHaveLength(1);
  });

  it("najemca nie czyta i nie pisze załączników", async () => {
    const { data, error } = await a.ownerClient.from("review_comment_attachments").select("*");
    expect(error, `SELECT załączników jako owner: ${error?.message}`).toBeNull();
    expect(data ?? [], "najemca zobaczył załączniki").toHaveLength(0);

    const { error: insertError } = await a.ownerClient
      .from("review_comment_attachments")
      .insert({ comment_id: seededId, image_path: `x/${randomUUID()}.png` });
    expect(insertError, "INSERT załącznika najemcy przeszedł").not.toBeNull();
  });

  it("superadmin czyta, wstawia, edytuje i kasuje uwagi + załączniki (kaskada)", async () => {
    const { data: list, error: listError } = await superadminClient
      .from("review_comments")
      .select("id")
      .eq("id", seededId);
    expect(listError, `SELECT superadmina: ${listError?.message}`).toBeNull();
    expect((list ?? []).map((r) => r.id), "superadmin nie widzi zasianej uwagi").toContain(seededId);

    const { data: inserted, error: insertError } = await superadminClient
      .from("review_comments")
      .insert(commentRow({ kind: "area", area_w: 0.2, area_h: 0.1, priority: 1 }))
      .select("id, priority")
      .single();
    expect(insertError, `INSERT superadmina: ${insertError?.message}`).toBeNull();
    expect(inserted?.priority).toBe(1);

    const path = `${inserted!.id}/${randomUUID()}.png`;
    const { error: attachError } = await superadminClient
      .from("review_comment_attachments")
      .insert({ comment_id: inserted!.id, image_path: path });
    expect(attachError, `INSERT załącznika superadmina: ${attachError?.message}`).toBeNull();

    const { data: toggled, error: toggleError } = await superadminClient
      .from("review_comments")
      .update({ status: "done", priority: 2 })
      .eq("id", inserted!.id)
      .select("status, priority, updated_at, created_at")
      .single();
    expect(toggleError, `UPDATE superadmina: ${toggleError?.message}`).toBeNull();
    expect(toggled?.status).toBe("done");
    // Trigger touch: updated_at ruszył względem created_at.
    expect(new Date(toggled!.updated_at).getTime()).toBeGreaterThan(
      new Date(toggled!.created_at).getTime(),
    );

    const { error: deleteError } = await superadminClient
      .from("review_comments")
      .delete()
      .eq("id", inserted!.id);
    expect(deleteError, `DELETE superadmina: ${deleteError?.message}`).toBeNull();

    const orphans = await sql<{ id: string }[]>`
      select id from public.review_comment_attachments where comment_id = ${inserted!.id}
    `;
    expect(orphans, "kaskada nie sprzątnęła załączników").toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // Bramki CHECK
  // ------------------------------------------------------------------

  it.each([{ priority: 0 }, { priority: 6 }])(
    "CHECK: priorytet $priority poza 1..5 odbity",
    async ({ priority }) => {
      const { error } = await superadminClient
        .from("review_comments")
        .insert(commentRow({ priority }));
      expect(error?.code, `priorytet ${priority} przeszedł`).toBe(PG_CHECK_VIOLATION);
    },
  );

  it("CHECK: status spoza open/done odbity", async () => {
    const { error } = await superadminClient
      .from("review_comments")
      .insert(commentRow({ status: "wontfix" }));
    expect(error?.code, "status wontfix przeszedł").toBe(PG_CHECK_VIOLATION);
  });

  it("CHECK: area bez wymiarów i punkt z wymiarami odbite", async () => {
    const { error: areaError } = await superadminClient
      .from("review_comments")
      .insert(commentRow({ kind: "area" }));
    expect(areaError?.code, "area bez w/h przeszła").toBe(PG_CHECK_VIOLATION);

    const { error: pointError } = await superadminClient
      .from("review_comments")
      .insert(commentRow({ kind: "point", area_w: 0.5, area_h: 0.5 }));
    expect(pointError?.code, "punkt z w/h przeszedł").toBe(PG_CHECK_VIOLATION);
  });

  // ------------------------------------------------------------------
  // Storage: prywatny bucket review-attachments
  // ------------------------------------------------------------------

  it("bucket jest niepubliczny", async () => {
    const rows = await sql<{ public: boolean }[]>`
      select public from storage.buckets where id = ${BUCKET}
    `;
    expect(rows, "brak bucketu review-attachments").toHaveLength(1);
    expect(rows[0].public, "bucket review-attachments jest publiczny").toBe(false);
  });

  it("anon i najemca nie wgrają ani nie odczytają obrazka; superadmin tak", async () => {
    const path = `${randomUUID()}/inspiracja.png`;

    const anonUpload = await anonClient.storage.from(BUCKET).upload(path, PNG, {
      contentType: "image/png",
      upsert: false,
    });
    expect(anonUpload.error, "anon wgrał obrazek do bucketu przeglądu").not.toBeNull();

    const tenantUpload = await a.ownerClient.storage.from(BUCKET).upload(path, PNG, {
      contentType: "image/png",
      upsert: false,
    });
    expect(tenantUpload.error, "najemca wgrał obrazek do bucketu przeglądu").not.toBeNull();

    const saUpload = await superadminClient.storage.from(BUCKET).upload(path, PNG, {
      contentType: "image/png",
      upsert: false,
    });
    expect(saUpload.error, `upload superadmina: ${saUpload.error?.message}`).toBeNull();
    uploadedPaths.push(path);

    const anonDownload = await anonClient.storage.from(BUCKET).download(path);
    expect(anonDownload.error, "anon pobrał obrazek z bucketu przeglądu").not.toBeNull();

    const tenantDownload = await a.ownerClient.storage.from(BUCKET).download(path);
    expect(tenantDownload.error, "najemca pobrał obrazek z bucketu przeglądu").not.toBeNull();

    const saDownload = await superadminClient.storage.from(BUCKET).download(path);
    expect(saDownload.error, `download superadmina: ${saDownload.error?.message}`).toBeNull();
    expect((await saDownload.data!.arrayBuffer()).byteLength).toBe(PNG.byteLength);

    // Signed URL — droga podglądu miniatur w nakładce i widoku PM.
    const signed = await superadminClient.storage.from(BUCKET).createSignedUrl(path, 60);
    expect(signed.error, `signed URL: ${signed.error?.message}`).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status, "signed URL nie serwuje obrazka").toBe(200);
  });
});
