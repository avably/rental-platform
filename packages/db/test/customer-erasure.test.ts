/**
 * app.erase_customer + app.purge_email_log_bodies (C2b, migracja 0056; ADR-116)
 * na ŻYWYM lokalnym Supabase.
 *
 * PRZEDMIOTEM TESTU JEST BAZA: realizacja art. 17 RODO idzie JEDNĄ funkcją
 * SECURITY DEFINER, bo dwie z trzech operacji są pod RLS niewykonalne
 * z założenia (`email_logs` jest append-only, `audit_log` przyjmuje INSERT
 * tylko od superadmina). DEFINER znosi RLS, więc CAŁA izolacja stoi na trzech
 * rzeczach wewnątrz funkcji: tenant z claimu, `app.is_tenant_owner()` i jawny
 * filtr `tenant_id` w każdym zapytaniu. Każda z nich ma tu własny test.
 *
 * Osie:
 *   1. ZASIĘG — anonimizacja obejmuje KOMPLET kopii danych osobowych
 *      (customers, orders.delivery_address_*, email_logs recipient+body,
 *      contract_documents.recipient, order_notes, customer_bans) i zostawia
 *      to, co ma zostać: historię rozliczeniową i metadane wysyłki.
 *   2. TRYB — klient bez zamówień znika w całości (twarde usunięcie),
 *      klient z zamówieniami zostaje jako pusty wiersz z `id`.
 *   3. IZOLACJA — właściciel A z identyfikatorem klienta tenanta B: odmowa
 *      i ZERO zmian na wierszu OFIARY (asercja na danych B, nie na kodzie
 *      odpowiedzi). Dowód mutacyjny: zdjęcie filtra `tenant_id = v_tenant`
 *      z SELECT-a wiersza klienta pali dokładnie ten test.
 *   4. ROLA — zwykły członek (staff) odbija się od bramki właściciela; obie
 *      strony granicy udowodnione (owner robi, staff nie).
 *   5. ANON — brak grantu, odmowa na warstwie uprawnień (pinowana treścią
 *      komunikatu, żeby `grant … to anon` faktycznie paliło test).
 *   6. IDEMPOTENCJA — powtórka nie pracuje drugi raz i nie mnoży wpisów
 *      w dzienniku, ale NADAL oddaje ścieżki plików (domknięcie przerwanego
 *      sprzątania Storage).
 *   7. ZNACZNIK — `anonymized_at` nie daje się ustawić wprost przez PostgREST
 *      (trigger 23514); inaczej karta klienta mogłaby kłamać, że dane usunięto.
 *   8. RETENCJA — `body` starsze niż okres znika, metadane zostają, ślad
 *      powstaje per najemca, a sesja najemcy funkcji nie dosięga.
 */
import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const LOCAL_DB_URL = process.env.SUPABASE_LOCAL_URL;
const sql = LOCAL_DB_URL ? postgres(LOCAL_DB_URL, { max: 1 }) : null;

const TEST_PASSWORD = "RlsTest!12345678";
const SHA = "a".repeat(64);

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function bareClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

let admin: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let staffAClient: SupabaseClient;

interface Fixture {
  customerId: string;
  email: string;
  orderId: string;
  emailLogId: string;
  documentId: string;
  documentPath: string;
  noteId: string;
}

/**
 * Klient z KOMPLETEM kopii danych osobowych: profil, zamówienie z własną
 * migawką adresu dostawy, log wysyłki z treścią, umowa PDF, notatka operatora
 * i ban. Każda z tych rzeczy jest osobną kopią tych samych danych — test
 * zasięgu ma sens tylko wtedy, gdy wszystkie istnieją PRZED wywołaniem.
 */
async function seedCustomer(tenantId: string, options: { withOrder?: boolean } = {}): Promise<Fixture> {
  const withOrder = options.withOrder ?? true;
  const email = `erasure-${randomUUID()}@test.local`;

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({
      tenant_id: tenantId,
      email,
      full_name: "Jan Testowy",
      phone: "+48600100200",
      company_name: "Testowa spółka",
      nip: "1234563218",
      address_street: "Kwiatowa 7",
      address_zip: "00-001",
      address_city: "Warszawa",
      locale: "pl",
    })
    .select("id")
    .single();
  if (customerError || !customer) throw new Error(customerError?.message ?? "brak klienta");
  const customerId = customer.id as string;

  const { error: banError } = await admin
    .from("customer_bans")
    .insert({ tenant_id: tenantId, customer_id: customerId });
  if (banError) throw new Error(banError.message);

  if (!withOrder) {
    // Log bez zamówienia — wiąże go z klientem WYŁĄCZNIE adres (order_id NULL
    // zostaje po `on delete set null`, 0021). To druga ścieżka dopasowania.
    const { data: orphanLog, error: orphanError } = await admin
      .from("email_logs")
      .insert({
        tenant_id: tenantId,
        kind: "invitation",
        recipient: email,
        subject: "Zaproszenie",
        status: "sent",
        body: "<p>Dane osobowe w treści</p>",
      })
      .select("id")
      .single();
    if (orphanError || !orphanLog) throw new Error(orphanError?.message ?? "brak logu");
    return {
      customerId,
      email,
      orderId: "",
      emailLogId: orphanLog.id as string,
      documentId: "",
      documentPath: "",
      noteId: "",
    };
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customerId,
      start_date: "2026-09-01",
      end_date: "2026-09-03",
      delivery_method: "courier",
      delivery_address_source: "custom",
      delivery_address_name: "Jan Testowy",
      delivery_address_street: "Kwiatowa 7",
      delivery_address_zip: "00-001",
      delivery_address_city: "Warszawa",
      delivery_address_phone: "+48600100200",
    })
    .select("id")
    .single();
  if (orderError || !order) throw new Error(orderError?.message ?? "brak zamówienia");
  const orderId = order.id as string;

  const { data: log, error: logError } = await admin
    .from("email_logs")
    .insert({
      tenant_id: tenantId,
      order_id: orderId,
      kind: "rental_confirmed",
      recipient: email,
      subject: "Rezerwacja potwierdzona",
      status: "sent",
      provider_message_id: `msg-${randomUUID()}`,
      body: `<p>Jan Testowy, Kwiatowa 7, ${email}</p>`,
    })
    .select("id")
    .single();
  if (logError || !log) throw new Error(logError?.message ?? "brak logu");

  const documentId = randomUUID();
  const documentPath = `${tenantId}/${orderId}/${documentId}.pdf`;
  const { error: documentError } = await admin.from("contract_documents").insert({
    id: documentId,
    tenant_id: tenantId,
    order_id: orderId,
    storage_path: documentPath,
    sha256: SHA,
    locale: "pl",
    terms_version: "2026-07",
    recipient: email,
    created_by: tenantId === a.tenantId ? a.ownerUserId : b.ownerUserId,
  });
  if (documentError) throw new Error(documentError.message);

  const { data: note, error: noteError } = await admin
    .from("order_notes")
    .insert({
      tenant_id: tenantId,
      order_id: orderId,
      body: "Klient Jan Testowy prosił o kontakt pod 600100200.",
    })
    .select("id")
    .single();
  if (noteError || !note) throw new Error(noteError?.message ?? "brak notatki");

  return {
    customerId,
    email,
    orderId,
    emailLogId: log.id as string,
    documentId,
    documentPath,
    noteId: note.id as string,
  };
}

async function erase(client: SupabaseClient, customerId: string) {
  return client.schema("app").rpc("erase_customer", { p_customer_id: customerId });
}

describe.skipIf(!hasEnv)("usunięcie i anonimizacja klienta (0056, ADR-116)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    ({ a, b } = await seedTwoTenants());

    const staffEmail = `erasure-staff-${randomUUID()}@test.local`;
    const created = await admin.auth.admin.createUser({
      email: staffEmail,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: a.tenantId, role: "staff" },
    });
    if (created.error || !created.data.user) throw new Error(created.error?.message ?? "brak staff");
    const member = await admin
      .from("members")
      .insert({ tenant_id: a.tenantId, user_id: created.data.user.id, role: "staff" });
    if (member.error) throw new Error(member.error.message);

    staffAClient = bareClient();
    const signedIn = await staffAClient.auth.signInWithPassword({
      email: staffEmail,
      password: TEST_PASSWORD,
    });
    if (signedIn.error) throw new Error(signedIn.error.message);
  }, 60_000);

  afterAll(async () => {
    if (admin) await cleanupSeeded(admin);
  });

  it("anonimizacja zdejmuje KAŻDĄ kopię danych osobowych i zostawia rozliczenia", async () => {
    const fx = await seedCustomer(a.tenantId);

    const { data, error } = await erase(a.ownerClient, fx.customerId);
    expect(error).toBeNull();
    const result = data as Record<string, unknown>;
    expect(result.mode).toBe("anonymized");
    expect(result.contract_paths).toEqual([fx.documentPath]);

    const { data: customer } = await admin
      .from("customers")
      .select("email, full_name, phone, company_name, nip, address_street, address_zip, address_city, locale, anonymized_at")
      .eq("id", fx.customerId)
      .single();
    expect(customer!.email).toBe(`usuniety-${fx.customerId.replace(/-/g, "")}@dane-usuniete.invalid`);
    expect(customer!.full_name).toBeNull();
    expect(customer!.phone).toBeNull();
    expect(customer!.company_name).toBeNull();
    expect(customer!.nip).toBeNull();
    expect(customer!.address_street).toBeNull();
    expect(customer!.address_zip).toBeNull();
    expect(customer!.address_city).toBeNull();
    expect(customer!.locale).toBeNull();
    expect(customer!.anonymized_at).not.toBeNull();

    // Migawka adresu na zamówieniu znika RAZEM ze źródłem (CHECK
    // orders_delivery_address_shape), ale kwoty i termin zostają.
    const { data: order } = await admin
      .from("orders")
      .select("delivery_address_source, delivery_address_name, delivery_address_street, delivery_address_zip, delivery_address_city, delivery_address_phone, total_rental_grosze, start_date, customer_id")
      .eq("id", fx.orderId)
      .single();
    expect(order!.delivery_address_source).toBeNull();
    expect(order!.delivery_address_name).toBeNull();
    expect(order!.delivery_address_street).toBeNull();
    expect(order!.delivery_address_zip).toBeNull();
    expect(order!.delivery_address_city).toBeNull();
    expect(order!.delivery_address_phone).toBeNull();
    expect(order!.start_date).toBe("2026-09-01");
    expect(order!.customer_id).toBe(fx.customerId);

    // Historia wysyłki: adresat i treść znikają, METADANE zostają — inaczej
    // najemca traci dowód, co i kiedy wysłał.
    const { data: log } = await admin
      .from("email_logs")
      .select("recipient, body, subject, kind, status, created_at")
      .eq("id", fx.emailLogId)
      .single();
    expect(log!.recipient).toBe(customer!.email);
    expect(log!.body).toBeNull();
    expect(log!.subject).toBe("Rezerwacja potwierdzona");
    expect(log!.kind).toBe("rental_confirmed");
    expect(log!.status).toBe("sent");

    const { data: document } = await admin
      .from("contract_documents")
      .select("recipient, sha256")
      .eq("id", fx.documentId)
      .single();
    expect(document!.recipient).toBe(customer!.email);
    expect(document!.sha256).toBe(SHA);

    const { data: notes } = await admin.from("order_notes").select("id").eq("order_id", fx.orderId);
    expect(notes).toEqual([]);

    const { data: bans } = await admin
      .from("customer_bans")
      .select("id")
      .eq("customer_id", fx.customerId);
    expect(bans).toEqual([]);
  }, 60_000);

  it("ślad w dzienniku powstaje i NIE przechowuje tego, co usunął", async () => {
    const fx = await seedCustomer(a.tenantId);
    const { error } = await erase(a.ownerClient, fx.customerId);
    expect(error).toBeNull();

    const { data: entries } = await admin
      .from("audit_log")
      .select("tenant_id, actor_user_id, action, subject, details")
      .eq("subject", fx.customerId);
    expect(entries).toHaveLength(1);
    const entry = entries![0]!;
    expect(entry.action).toBe("customer.erased.anonymized");
    expect(entry.tenant_id).toBe(a.tenantId);
    expect(entry.actor_user_id).toBe(a.ownerUserId);
    expect(entry.details).toMatchObject({ zamowienia: 1, logi_email: 1, umowy: 1, notatki: 1, bany: 1 });
    // Dziennik jest tabelą, której najemca nie może wyczyścić — wpis z adresem
    // klienta byłby kopią danych osobowych przeżywającą samo usunięcie.
    expect(JSON.stringify(entry.details)).not.toContain(fx.email);
  }, 60_000);

  it("klient bez zamówień znika w całości, a jego logi wysyłki tracą adres i treść", async () => {
    const fx = await seedCustomer(a.tenantId, { withOrder: false });

    const { data, error } = await erase(a.ownerClient, fx.customerId);
    expect(error).toBeNull();
    expect((data as Record<string, unknown>).mode).toBe("deleted");

    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("id", fx.customerId)
      .maybeSingle();
    expect(customer).toBeNull();

    const { data: log } = await admin
      .from("email_logs")
      .select("recipient, body, kind")
      .eq("id", fx.emailLogId)
      .single();
    expect(log!.recipient).toBe(`usuniety-${fx.customerId.replace(/-/g, "")}@dane-usuniete.invalid`);
    expect(log!.body).toBeNull();

    const { data: entries } = await admin
      .from("audit_log")
      .select("action")
      .eq("subject", fx.customerId);
    expect(entries).toHaveLength(1);
    expect(entries![0]!.action).toBe("customer.erased.deleted");
  }, 60_000);

  it("IZOLACJA: właściciel A z identyfikatorem klienta B — odmowa i ZERO zmian u ofiary", async () => {
    const victim = await seedCustomer(b.tenantId);

    const { error } = await erase(a.ownerClient, victim.customerId);
    expect(error).not.toBeNull();
    expect(error!.code).toBe("22023");

    // Werdykt czytamy z WIERSZA OFIARY, nie z kodu odpowiedzi: funkcja jest
    // SECURITY DEFINER, więc RLS jej nie zatrzyma — zatrzymać ma filtr tenanta.
    const { data: customer } = await admin
      .from("customers")
      .select("email, full_name, phone, anonymized_at")
      .eq("id", victim.customerId)
      .single();
    expect(customer!.email).toBe(victim.email);
    expect(customer!.full_name).toBe("Jan Testowy");
    expect(customer!.phone).toBe("+48600100200");
    expect(customer!.anonymized_at).toBeNull();

    const { data: log } = await admin
      .from("email_logs")
      .select("recipient, body")
      .eq("id", victim.emailLogId)
      .single();
    expect(log!.recipient).toBe(victim.email);
    expect(log!.body).not.toBeNull();

    const { data: notes } = await admin.from("order_notes").select("id").eq("id", victim.noteId);
    expect(notes).toHaveLength(1);

    const { data: entries } = await admin
      .from("audit_log")
      .select("id")
      .eq("subject", victim.customerId);
    expect(entries).toEqual([]);
  }, 60_000);

  it("nieistniejący klient dostaje TĘ SAMĄ odmowę co cudzy (zero wyroczni istnienia)", async () => {
    const { error } = await erase(a.ownerClient, randomUUID());
    expect(error!.code).toBe("22023");
  }, 30_000);

  it("ROLA: zwykły członek nie usuwa danych, właściciel usuwa", async () => {
    const fx = await seedCustomer(a.tenantId);

    const denied = await erase(staffAClient, fx.customerId);
    expect(denied.error).not.toBeNull();
    expect(denied.error!.code).toBe("42501");

    const { data: untouched } = await admin
      .from("customers")
      .select("full_name, anonymized_at")
      .eq("id", fx.customerId)
      .single();
    expect(untouched!.full_name).toBe("Jan Testowy");
    expect(untouched!.anonymized_at).toBeNull();

    // Druga strona granicy: ta sama operacja, ta sama organizacja, rola owner.
    const allowed = await erase(a.ownerClient, fx.customerId);
    expect(allowed.error).toBeNull();
    expect((allowed.data as Record<string, unknown>).mode).toBe("anonymized");
  }, 60_000);

  it("ANON nie ma grantu na funkcję — odmowa na warstwie uprawnień", async () => {
    const fx = await seedCustomer(a.tenantId);
    const { error } = await erase(bareClient(), fx.customerId);
    expect(error).not.toBeNull();
    // Pin warstwy: bramka `v_tenant is null` też zwraca 42501, więc bez asercji
    // na treści `grant execute … to anon` nie zapaliłby tego testu.
    expect(error!.message).toMatch(/permission denied/i);
  }, 60_000);

  it("powtórka nie pracuje drugi raz, ale nadal oddaje ścieżki plików", async () => {
    const fx = await seedCustomer(a.tenantId);
    const first = await erase(a.ownerClient, fx.customerId);
    expect((first.data as Record<string, unknown>).mode).toBe("anonymized");

    const second = await erase(a.ownerClient, fx.customerId);
    expect(second.error).toBeNull();
    const result = second.data as Record<string, unknown>;
    expect(result.mode).toBe("already_anonymized");
    expect(result.contract_paths).toEqual([fx.documentPath]);

    const { data: entries } = await admin
      .from("audit_log")
      .select("id")
      .eq("subject", fx.customerId);
    expect(entries).toHaveLength(1);
  }, 60_000);

  it("ZNACZNIKA nie da się ustawić wprost — karta klienta nie może kłamać", async () => {
    const fx = await seedCustomer(a.tenantId);

    const { error } = await a.ownerClient
      .from("customers")
      .update({ anonymized_at: new Date().toISOString() })
      .eq("id", fx.customerId)
      .select("id");
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23514");

    const { data: customer } = await admin
      .from("customers")
      .select("anonymized_at, full_name")
      .eq("id", fx.customerId)
      .single();
    expect(customer!.anonymized_at).toBeNull();
    expect(customer!.full_name).toBe("Jan Testowy");
  }, 60_000);

  it("zwykła edycja klienta nadal działa (bramka znacznika nie blokuje wszystkiego)", async () => {
    const fx = await seedCustomer(a.tenantId);
    const { error } = await a.ownerClient
      .from("customers")
      .update({ full_name: "Jan Poprawiony" })
      .eq("id", fx.customerId)
      .select("id");
    expect(error).toBeNull();
  }, 60_000);

  it("obie funkcje są DEFINER, mają przypięty search_path i minimalne granty", async () => {
    const rows = await sql!`
      select p.proname,
             p.prosecdef as security_definer,
             p.proconfig as config,
             has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
             has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute,
             has_function_privilege('service_role', p.oid, 'EXECUTE') as service_role_execute
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'app'
         and p.proname in ('erase_customer', 'purge_email_log_bodies')
       order by p.proname`;

    const byName = Object.fromEntries(rows.map((row) => [row.proname as string, row]));

    // Usunięcie danych: wołane przez WŁAŚCICIELA z panelu — anon nigdy,
    // service_role nigdy (bez claimu tenanta i tak padłby na strażniku).
    expect(byName.erase_customer).toMatchObject({
      security_definer: true,
      authenticated_execute: true,
      anon_execute: false,
      service_role_execute: false,
    });
    expect(byName.erase_customer!.config).toContain("search_path=pg_catalog, public, app");

    // Retencja: przebieg PLATFORMOWY — żadna sesja najemcy nie ma tu wstępu.
    expect(byName.purge_email_log_bodies).toMatchObject({
      security_definer: true,
      authenticated_execute: false,
      anon_execute: false,
      service_role_execute: true,
    });
    expect(byName.purge_email_log_bodies!.config).toContain("search_path=pg_catalog, public, app");
  }, 30_000);
});

describe.skipIf(!hasEnv)("retencja treści wiadomości (0056, R3)", () => {
  let retentionAdmin: SupabaseClient;
  let ctxA: TenantCtx;

  beforeAll(async () => {
    retentionAdmin = createAdminClient();
    const seeded = await seedTwoTenants();
    ctxA = seeded.a;
  }, 60_000);

  afterAll(async () => {
    if (retentionAdmin) await cleanupSeeded(retentionAdmin);
    await sql?.end();
  });

  async function seedLog(tenantId: string, ageDays: number): Promise<string> {
    const createdAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await retentionAdmin
      .from("email_logs")
      .insert({
        tenant_id: tenantId,
        kind: "rental_confirmed",
        recipient: `retencja-${randomUUID()}@test.local`,
        subject: "Rezerwacja potwierdzona",
        status: "sent",
        body: "<p>Pełna treść z danymi osobowymi</p>",
        created_at: createdAt,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "brak logu");
    return data.id as string;
  }

  it("kasuje treść starszą niż okres retencji, metadane zostawia nietknięte", async () => {
    const oldId = await seedLog(ctxA.tenantId, 120);
    const freshId = await seedLog(ctxA.tenantId, 10);

    const { error } = await retentionAdmin
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 90, p_limit: 1000 });
    expect(error).toBeNull();

    const { data: oldRow } = await retentionAdmin
      .from("email_logs")
      .select("body, recipient, subject, status, kind")
      .eq("id", oldId)
      .single();
    expect(oldRow!.body).toBeNull();
    expect(oldRow!.subject).toBe("Rezerwacja potwierdzona");
    expect(oldRow!.status).toBe("sent");
    expect(oldRow!.recipient).toMatch(/@test\.local$/);

    const { data: freshRow } = await retentionAdmin
      .from("email_logs")
      .select("body")
      .eq("id", freshId)
      .single();
    expect(freshRow!.body).not.toBeNull();
  }, 60_000);

  it("zostawia ślad w dzienniku per najemca", async () => {
    await seedLog(ctxA.tenantId, 200);
    const { error } = await retentionAdmin
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 90, p_limit: 1000 });
    expect(error).toBeNull();

    const { data: entries } = await retentionAdmin
      .from("audit_log")
      .select("tenant_id, action, details")
      .eq("action", "retention.email_body_purged")
      .eq("tenant_id", ctxA.tenantId);
    expect(entries!.length).toBeGreaterThan(0);
    expect(entries![0]!.details).toMatchObject({ dni_retencji: 90 });
  }, 60_000);

  it("sesja najemcy NIE dosięga retencji (przebieg przekracza granicę najemcy)", async () => {
    const { error } = await ctxA.ownerClient
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 90, p_limit: 10 });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission denied/i);
  }, 30_000);

  it("anon nie dosięga retencji", async () => {
    const { error } = await bareClient()
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 90, p_limit: 10 });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/permission denied/i);
  }, 30_000);

  it("parametry poza zakresem są odrzucane", async () => {
    const zero = await retentionAdmin
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 0, p_limit: 10 });
    expect(zero.error!.code).toBe("22023");

    const huge = await retentionAdmin
      .schema("app")
      .rpc("purge_email_log_bodies", { p_days: 90, p_limit: 999_999 });
    expect(huge.error!.code).toBe("22023");
  }, 30_000);
});
