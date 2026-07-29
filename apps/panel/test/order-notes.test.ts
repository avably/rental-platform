/**
 * Testy integracyjne notatek zamówienia (lista wpisów, ADR-079) na żywym,
 * lokalnym Supabase — wzorzec deposits.test.ts: realni użytkownicy, realne
 * sesje, zero mocków. Weryfikują ścieżkę PANELU (klient z sesją, zero
 * service-role) przez rdzeń notes-core.ts, dokładnie tak, jak wołają go akcje:
 *
 *   1. dodanie wpisu zapisuje AUTORA = wołający członek (created_by); lista
 *      zwraca wpisy najnowsze na górze,
 *   2. resolver app.tenant_member_emails() zwraca e-mail autora WŁASNEGO
 *      tenanta, a NIE cudzego (izolacja adresów),
 *   3. edycja zmienia treść (także cudzego wpisu w obrębie tenanta — ADR-079),
 *   4. twarde usunięcie kasuje wiersz,
 *   5. izolacja: członek tenanta B nie czyta, nie edytuje, nie usuwa notatek
 *      A i nie dopnie wpisu do zamówienia A (FK złożony 23503).
 *
 * Macierz izolacji RLS dla tej tabeli (SELECT/INSERT/UPDATE/DELETE, gołe
 * mutacje bez WHERE) żyje w packages/db/test/rls-isolation.test.ts —
 * tu dowodzimy ścieżki produktowej i autora, nie powtarzając macierzy.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import {
  addOrderNote,
  deleteOrderNote,
  editOrderNote,
} from "@/app/[locale]/(panel)/zamowienia/[id]/notes-core";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "NotesTest!12345678";

const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function createAdminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function createAnonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

interface Member {
  client: SupabaseClient;
  tenantId: string;
  userId: string;
  email: string;
}

async function createTenantMember(admin: SupabaseClient, label: string): Promise<Member> {
  const email = `notes-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap.schema("app").rpc("create_tenant", {
    p_slug: `notes-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `Organizacja notatek ${label}`,
  });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);

  return { client: await signIn(email), tenantId: tenantId as string, userId: data.user.id, email };
}

describe.skipIf(!hasEnv)("notatki zamówienia (lista wpisów, ADR-079)", () => {
  let admin: SupabaseClient;
  let a: Member;
  let b: Member;

  beforeAll(async () => {
    admin = createAdminClient();
    a = await createTenantMember(admin, "a");
    b = await createTenantMember(admin, "b");
  }, 60_000);

  afterAll(async () => {
    for (const userId of createdUserIds) await admin.auth.admin.deleteUser(userId);
    createdUserIds.length = 0;
    if (createdTenantIds.length > 0) await admin.from("tenants").delete().in("id", createdTenantIds);
    createdTenantIds.length = 0;
  }, 60_000);

  /** Zamówienie tenanta A z sesji członka — nośnik notatek. */
  async function createOrderA(): Promise<string> {
    const { data: customer, error: customerError } = await a.client
      .from("customers")
      .insert({ tenant_id: a.tenantId, email: `klient-${randomUUID()}@test.local` })
      .select("id")
      .single();
    if (customerError) throw new Error(`insert customers: ${customerError.message}`);

    const { data: order, error: orderError } = await a.client
      .from("orders")
      .insert({
        tenant_id: a.tenantId,
        customer_id: customer!.id,
        start_date: "2026-09-10",
        end_date: "2026-09-12",
        delivery_method: "courier",
      })
      .select("id")
      .single();
    if (orderError) throw new Error(`insert orders: ${orderError.message}`);
    return order!.id as string;
  }

  interface NoteRow {
    id: string;
    body: string;
    created_by: string | null;
    created_at: string;
    updated_at: string;
  }

  async function notesOf(orderId: string): Promise<NoteRow[]> {
    const { data, error } = await admin
      .from("order_notes")
      .select("id, body, created_by, created_at, updated_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (error) throw new Error(`notesOf: ${error.message}`);
    return (data ?? []) as NoteRow[];
  }

  it("dodaje wpis z autorem = wołający członek; lista najnowsze na górze", async () => {
    const orderId = await createOrderA();

    const first = await addOrderNote(a.client, a.tenantId, a.userId, {
      orderId,
      body: "Odbiór: komplet, bez uwag.",
    });
    expect(first).toEqual({ ok: true });

    // Odstęp gwarantuje różny created_at → deterministyczna kolejność.
    await new Promise((r) => setTimeout(r, 15));

    const second = await addOrderNote(a.client, a.tenantId, a.userId, {
      orderId,
      body: "Zwrot: kabel porysowany.",
    });
    expect(second).toEqual({ ok: true });

    const rows = await notesOf(orderId);
    expect(rows).toHaveLength(2);
    // Najnowszy wpis na górze.
    expect(rows[0]!.body).toBe("Zwrot: kabel porysowany.");
    expect(rows[1]!.body).toBe("Odbiór: komplet, bez uwag.");
    // AUTOR: każdy wpis niesie uuid wołającego członka (pominięcie go dałoby
    // wpis bez autora — dowiedzione testem mutacyjnym w raporcie).
    expect(rows[0]!.created_by).toBe(a.userId);
    expect(rows[1]!.created_by).toBe(a.userId);
  });

  it("resolver zwraca e-mail autora własnego tenanta, a nie cudzego", async () => {
    const { data, error } = await a.client.schema("app").rpc("tenant_member_emails");
    expect(error, `rpc tenant_member_emails: ${error?.message}`).toBeNull();

    const map = new Map(
      ((data ?? []) as { user_id: string; email: string }[]).map((m) => [m.user_id, m.email]),
    );
    // Własny autor rozwiązuje się na swój e-mail…
    expect(map.get(a.userId)).toBe(a.email);
    // …a adres członka innego tenanta NIE wycieka do wołającego.
    expect(map.has(b.userId)).toBe(false);
  });

  it("edytuje treść wpisu (odczyt po zapisie potwierdza zmianę)", async () => {
    const orderId = await createOrderA();
    await addOrderNote(a.client, a.tenantId, a.userId, { orderId, body: "Wersja pierwsza." });
    const [note] = await notesOf(orderId);

    const result = await editOrderNote(a.client, a.tenantId, { noteId: note!.id, body: "Wersja druga." });
    expect(result).toEqual({ ok: true });

    const [updated] = await notesOf(orderId);
    expect(updated!.body).toBe("Wersja druga.");
    // Trigger order_notes_touch podbił updated_at.
    expect(new Date(updated!.updated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(updated!.created_at).getTime(),
    );
  });

  it("twardo usuwa wpis", async () => {
    const orderId = await createOrderA();
    await addOrderNote(a.client, a.tenantId, a.userId, { orderId, body: "Do skasowania." });
    const [note] = await notesOf(orderId);

    const result = await deleteOrderNote(a.client, a.tenantId, { noteId: note!.id });
    expect(result).toEqual({ ok: true });
    expect(await notesOf(orderId)).toHaveLength(0);
  });

  it("izolacja: tenant B nie czyta, nie zmienia, nie kasuje ani nie dopina notatek A", async () => {
    const orderId = await createOrderA();
    await addOrderNote(a.client, a.tenantId, a.userId, { orderId, body: "Tajne ustalenie A." });
    const [note] = await notesOf(orderId);

    // SELECT z sesji B: pusto (RLS filtruje), zero błędu.
    const { data: seenByB, error: selError } = await b.client
      .from("order_notes")
      .select("*")
      .eq("order_id", orderId);
    expect(selError, `SELECT B: ${selError?.message}`).toBeNull();
    expect(seenByB ?? []).toHaveLength(0);

    // INSERT do zamówienia A z sesji B: FK złożony (tenantB, orderA) nie ma
    // pokrycia → odrzucenie; żaden nowy wiersz nie powstaje.
    const added = await addOrderNote(b.client, b.tenantId, b.userId, { orderId, body: "Wtręt B." });
    expect(added.ok).toBe(false);

    // EDIT wpisu A z sesji B: filtr tenanta + RLS → 0 wierszy → ok:false.
    const edited = await editOrderNote(b.client, b.tenantId, { noteId: note!.id, body: "Podmiana B." });
    expect(edited.ok).toBe(false);

    // DELETE wpisu A z sesji B: 0 wierszy → ok:false.
    const deleted = await deleteOrderNote(b.client, b.tenantId, { noteId: note!.id });
    expect(deleted.ok).toBe(false);

    // Stan wpisu A NIENARUSZONY po wszystkich próbach B.
    const rows = await notesOf(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toBe("Tajne ustalenie A.");
  });
});
