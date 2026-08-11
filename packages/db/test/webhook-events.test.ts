/**
 * Rejestr zdarzeń dostawcy i bramka writera rozliczeń (migracja 0030,
 * ADR-067) na ŻYWYM, lokalnym Supabase — realne role, realne granty, realne
 * triggery.
 *
 * PRZEDMIOTEM TESTU JEST BAZA, więc atrapa nie dowiodłaby tu niczego:
 * odpowiadałaby „ok" niezależnie od tego, czy bramka w ogóle istnieje.
 *
 * Cztery osie, każda z osobnym powodem:
 *
 *   1. REJESTR JEST PLATFORMOWY I NIEWIDOCZNY DLA NAJEMCY — RLS włączone,
 *      zero polityk i zero grantów dla anon/authenticated. Historia płatności
 *      całej platformy nie jest widokiem pojedynczego sklepu.
 *   2. IDEMPOTENCJA STOI NA UNIKACIE, nie na warunku w kodzie — pięć dostaw
 *      tego samego zdarzenia daje jeden wiersz, a dwie RÓWNOLEGŁE dostawy
 *      wyłaniają dokładnie jednego właściciela (ADR-024: `select`-potem-
 *      `insert` przeszedłby oba sprawdzenia i wykonał zapis dwa razy).
 *   3. `paid` W OBIEGU STRIPE PISZE WYŁĄCZNIE service_role — luka z Z1
 *      domknięta: dziś każdy członek tenanta mógł jednym UPDATE-em przez
 *      PostgREST ogłosić opłacenie zamówienia, za które nikt nie zapłacił.
 *   4. OBIEG `manual` ZOSTAJE NIETKNIĘTY — swoboda operatorska ADR-035 nie
 *      jest tu ofiarą uboczną. Ta oś jest kontrolą negatywną osi 3: bramka,
 *      która blokuje wszystko, „przechodziłaby" test blokady.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (docs/konwencje-
 * migracji.md). Bez nich strażnik integration-env failuje suitę.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** 23514 = check_violation — odmowa z CHECK-a albo z bramki triggera. */
const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — brak GRANT-u albo odmowa polityki RLS. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "Testowe-haslo-123!";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

const adminClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const anonClient = (): SupabaseClient =>
  createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];
const createdEventIds: string[] = [];

/**
 * Numer zamówienia musi pasować do CHECK-a `^[A-Z0-9]{2,10}-[0-9]{4}-[0-9]{3,}$`
 * (0007). Licznik, nie UUID: format jest częścią kontraktu domeny, a test,
 * który go obchodzi losowym ciągiem, nie zauważyłby jego zmiany.
 */
let orderNumberSeq = 0;
const nextOrderNumber = (): string => String(1000 + (orderNumberSeq += 1));

describe.skipIf(!hasEnv)("webhook_events + bramka writera rozliczeń — 0030", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdEventIds.length > 0) {
      await admin.from("webhook_events").delete().in("event_id", createdEventIds);
    }
    for (const tenantId of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  /** `insert ... on conflict do nothing` + liczba WSTAWIONYCH wierszy. */
  async function claim(client: SupabaseClient, eventId: string, type = "payment_intent.succeeded") {
    createdEventIds.push(eventId);
    return client
      .from("webhook_events")
      .upsert(
        { provider: "stripe", event_id: eventId, event_type: type },
        { onConflict: "provider,event_id", ignoreDuplicates: true },
      )
      .select("id");
  }

  // -------------------------------------------------------------------
  // 1. Rejestr platformowy — poza zasięgiem najemcy
  // -------------------------------------------------------------------

  describe("rejestr jest platformowy i niewidoczny dla najemcy", () => {
    it("tabela ma RLS włączone i ZERO polityk", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        const [table] = await sql<{ rowsecurity: boolean }[]>`
          select rowsecurity from pg_tables
          where schemaname = 'public' and tablename = 'webhook_events'
        `;
        expect(table?.rowsecurity, "RLS na webhook_events").toBe(true);

        // ZERO polityk to nie niedopatrzenie, tylko treść decyzji: RLS bez
        // polityki nie wpuszcza nikogo, a service_role polityk nie potrzebuje,
        // bo je omija. Polityka dla `authenticated` byłaby tu regresją.
        const policies = await sql<{ policyname: string }[]>`
          select policyname from pg_policies
          where schemaname = 'public' and tablename = 'webhook_events'
        `;
        expect(policies.map((p) => p.policyname)).toEqual([]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("tabela BEZ kolumny tenant_id — idempotencja rozstrzyga się przed rozpoznaniem tenanta", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        const columns = await sql<{ column_name: string }[]>`
          select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'webhook_events'
        `;
        expect(columns.map((c) => c.column_name)).not.toContain("tenant_id");
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("anon nie ma ŻADNEGO uprawnienia do rejestru — także TRUNCATE (poza zasięgiem RLS)", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        const rows = await sql<{ role: string; privilege: string }[]>`
          select r.role, p.privilege
          from (values ('anon'), ('authenticated')) as r(role)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('MAINTAIN')) as p(privilege)
          where has_table_privilege(r.role, 'public.webhook_events'::regclass, p.privilege)
        `;
        expect(rows).toEqual([]);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("anon dostaje 42501 przy próbie odczytu rejestru", async () => {
      const { error } = await anonClient().from("webhook_events").select("id");
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("zalogowany członek tenanta też nie widzi rejestru", async () => {
      const { member } = await seedTenantWithMember();
      const { error } = await member.from("webhook_events").select("id");
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });
  });

  // -------------------------------------------------------------------
  // 2. Idempotencja przez unikat
  // -------------------------------------------------------------------

  describe("idempotencja stoi na ograniczeniu bazy", () => {
    it("PIĘĆ dostaw tego samego event.id → jeden wiersz i jedno przejęcie", async () => {
      const eventId = `evt_${randomUUID()}`;

      const results = [];
      for (let i = 0; i < 5; i += 1) {
        const { data, error } = await claim(admin, eventId);
        expect(error, `dostawa ${i + 1}: ${error?.message}`).toBeNull();
        results.push((data ?? []).length);
      }

      // Dokładnie JEDNA dostawa wstawiła wiersz — reszta dostała pustą
      // tablicę, czyli „to zdarzenie ma już kto inny".
      expect(results).toEqual([1, 0, 0, 0, 0]);

      const { data: rows } = await admin
        .from("webhook_events")
        .select("id")
        .eq("event_id", eventId);
      expect(rows).toHaveLength(1);
    });

    /**
     * WYŚCIG, NIE SEKWENCJA. Pięć dostaw po kolei przechodziłoby także przy
     * `select`-potem-`insert` — bo każdy SELECT widziałby już wstawiony
     * wiersz. Dopiero dostawy RÓWNOLEGŁE rozstrzygają, czy idempotencja
     * jest ograniczeniem bazy, czy tylko warunkiem w kodzie (ADR-024:
     * dokładnie ten kształt wyścigu co przy przypisaniu egzemplarza).
     *
     * Osiem żądań wypuszczonych jednym `Promise.all` — nie dwa: przy dwóch
     * test przechodziłby „przypadkiem" na wolnej maszynie, gdzie pierwsze
     * zdąży się utrwalić przed startem drugiego.
     */
    it("OSIEM RÓWNOLEGŁYCH dostaw tego samego event.id → dokładnie jedno przejęcie", async () => {
      const eventId = `evt_${randomUUID()}`;
      createdEventIds.push(eventId);

      // Osobny klient na żądanie — jeden klient współdzieliłby połączenie
      // i szeregował żądania, czyli rozbroiłby wyścig.
      const attempts = Array.from({ length: 8 }, () =>
        adminClient()
          .from("webhook_events")
          .upsert(
            { provider: "stripe", event_id: eventId, event_type: "payment_intent.succeeded" },
            { onConflict: "provider,event_id", ignoreDuplicates: true },
          )
          .select("id"),
      );

      const results = await Promise.all(attempts);
      for (const result of results) {
        expect(result.error?.message ?? null).toBeNull();
      }

      const claimed = results.filter((r) => (r.data ?? []).length === 1);
      expect(claimed, "dokładnie jedna dostawa przejmuje zdarzenie").toHaveLength(1);

      const { data: rows } = await admin
        .from("webhook_events")
        .select("id")
        .eq("event_id", eventId);
      expect(rows).toHaveLength(1);
    });

    it("unikat obejmuje parę (provider, event_id) — nie blokuje innego dostawcy", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        const [constraint] = await sql<{ definition: string }[]>`
          select pg_get_constraintdef(oid) as definition
          from pg_constraint
          where conname = 'webhook_events_provider_event_unique'
        `;
        expect(constraint?.definition).toMatch(/UNIQUE \(provider, event_id\)/);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    it("status spoza zbioru jest odrzucany", async () => {
      const eventId = `evt_${randomUUID()}`;
      createdEventIds.push(eventId);
      const { error } = await admin.from("webhook_events").insert({
        provider: "stripe",
        event_id: eventId,
        event_type: "payment_intent.succeeded",
        status: "ok",
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // 3. KTO pisze rozliczenie — luka domknięta
  // -------------------------------------------------------------------

  describe("paid w obiegu stripe pisze wyłącznie service_role", () => {
    it("app.is_settlement_writer(): prawda dla service_role, fałsz dla członka", async () => {
      const sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
      try {
        // Dosłowne `current_user = 'service_role'`, świadomie NIE
        // `pg_has_role`: to drugie jest prawdziwe dla `postgres`, czyli dla
        // właściciela każdej funkcji SECURITY DEFINER — anonowa ścieżka
        // checkoutu weszłaby przez taką funkcję z wypraną tożsamością.
        const asRole = async (role: string): Promise<boolean> => {
          const rows = await sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`);
            return tx<{ writer: boolean }[]>`select app.is_settlement_writer() as writer`;
          });
          return (rows as unknown as { writer: boolean }[])[0]!.writer;
        };

        expect(await asRole("service_role")).toBe(true);
        expect(await asRole("authenticated")).toBe(false);
        expect(await asRole("anon")).toBe(false);
      } finally {
        await sql.end({ timeout: 5 });
      }
    });

    /**
     * TO JEST TEN TEST. Do 0030 przechodził na zielono w drugą stronę:
     * członek tenanta ustawiał `paid` na zamówieniu Stripe zwykłym UPDATE-em
     * przez PostgREST i baza to przyjmowała, bo `pending → paid` jest
     * w reżimie ścisłym przejściem LEGALNYM. Mapa przejść odpowiada „czy
     * wolno z tego stanu w tamten" — nie „kto".
     */
    it("CZŁONEK TENANTA nie sfałszuje paid na zamówieniu stripe (23514)", async () => {
      const { member, orderId } = await seedStripeOrder("pending");

      const { error } = await member
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId);

      expect(error?.code, `odmowa dla członka: ${error?.message}`).toBe(PG_CHECK_VIOLATION);
      expect(error?.message).toContain("service_role");

      // Odpowiedź PostgREST to DEKLARACJA — stan czytamy z bazy klientem
      // omijającym RLS (lekcja z nagłówka rls-isolation.test.ts).
      const { data } = await admin
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .single();
      expect(data?.payment_status).toBe("pending");
    });

    it("CZŁONEK TENANTA nie sfałszuje też payment_failed (23514)", async () => {
      const { member, orderId } = await seedStripeOrder("pending");

      const { error } = await member
        .from("orders")
        .update({ payment_status: "payment_failed" })
        .eq("id", orderId);
      expect(error?.code).toBe(PG_CHECK_VIOLATION);

      const { data } = await admin
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .single();
      expect(data?.payment_status).toBe("pending");
    });

    it("service_role wykonuje to samo przejście bez przeszkód", async () => {
      const { orderId } = await seedStripeOrder("pending");

      const { error } = await admin
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId);
      expect(error?.message ?? null).toBeNull();

      const { data } = await admin
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .single();
      expect(data?.payment_status).toBe("paid");
    });

    /**
     * KONTROLA NEGATYWNA BRAMKI: gdyby blokowała po prostu wszystko, testy
     * wyżej byłyby zielone przy zepsutej regule. Członek MUSI móc anulować
     * własne zamówienie także w obiegu stripe — `cancelled` nie jest
     * twierdzeniem o wpłacie.
     */
    it("członek nadal może ANULOWAĆ zamówienie stripe — bramka celuje w rozliczenie, nie w oś", async () => {
      const { member, orderId } = await seedStripeOrder("unpaid");

      const { error } = await member
        .from("orders")
        .update({ payment_status: "cancelled" })
        .eq("id", orderId);
      expect(error?.message ?? null).toBeNull();

      const { data } = await admin
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .single();
      expect(data?.payment_status).toBe("cancelled");
    });

    it("zamówienie stripe nie może się URODZIĆ jako paid z ręki członka", async () => {
      // Bez tej reguły bramka przejść miałaby obejście w jednym kroku:
      // zamówienie nie „przechodzi" wtedy w paid, tylko powstaje w nim.
      const { member, tenantId, customerId, pickupId } = await seedTenantWithMember();

      const { error } = await member.from("orders").insert({
        tenant_id: tenantId,
        customer_id: customerId,
        order_number: `Z4-2026-${nextOrderNumber()}`,
        start_date: "2026-11-01",
        end_date: "2026-11-03",
        delivery_method: "pickup",
        pickup_location_id: pickupId,
        order_status: "pending",
        payment_status: "paid",
        payment_provider: "stripe",
        total_rental_grosze: 10_000,
        total_deposit_grosze: 0,
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // 4. Obieg manual bez zmian (ADR-035)
  // -------------------------------------------------------------------

  describe("obieg manual zostaje nietknięty", () => {
    it("członek nadal oznacza zamówienie offline jako opłacone", async () => {
      const { member, orderId } = await seedManualOrder("unpaid");

      const { error } = await member
        .from("orders")
        .update({ payment_status: "paid" })
        .eq("id", orderId);
      expect(error?.message ?? null).toBeNull();

      const { data } = await admin
        .from("orders")
        .select("payment_status")
        .eq("id", orderId)
        .single();
      expect(data?.payment_status).toBe("paid");
    });

    it("swoboda operatorska ADR-035: paid → unpaid w obiegu manual nadal działa", async () => {
      const { member, orderId } = await seedManualOrder("paid");

      const { error } = await member
        .from("orders")
        .update({ payment_status: "unpaid" })
        .eq("id", orderId);
      expect(error?.message ?? null).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Seed
  // -------------------------------------------------------------------

  interface Seeded {
    member: SupabaseClient;
    tenantId: string;
    customerId: string;
    pickupId: string;
  }

  async function seedTenantWithMember(): Promise<Seeded> {
    const email = `z4-${randomUUID()}@test.local`;
    const { data: user, error: userError } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (userError || !user.user) throw new Error(`createUser: ${userError?.message}`);
    createdUserIds.push(user.user.id);

    const bootstrap = anonClient();
    const signIn = await bootstrap.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);

    const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
        p_slug: `z4-${randomUUID()}`.slice(0, 39),
        p_name: "Sklep Z4",
      });
    if (tenantError) throw new Error(`create_tenant: ${tenantError.message}`);
    createdTenantIds.push(tenantId as string);

    // Świeża sesja — claim `tenant_id` wchodzi do tokenu dopiero po
    // ponownym zalogowaniu (wzorzec order-gates.test.ts).
    const member = anonClient();
    const reSignIn = await member.auth.signInWithPassword({ email, password: TEST_PASSWORD });
    if (reSignIn.error) throw new Error(`signIn 2: ${reSignIn.error.message}`);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .insert({
        tenant_id: tenantId as string,
        full_name: "Klient Z4",
        email: `klient-${randomUUID().slice(0, 8)}@test.local`,
      })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`customer: ${customerError?.message}`);

    const { data: pickup, error: pickupError } = await admin
      .from("pickup_locations")
      .insert({ tenant_id: tenantId as string, name: "Magazyn", address_city: "Warszawa" })
      .select("id")
      .single();
    if (pickupError || !pickup) throw new Error(`pickup: ${pickupError?.message}`);

    return {
      member,
      tenantId: tenantId as string,
      customerId: customer.id as string,
      pickupId: pickup.id as string,
    };
  }

  async function seedOrder(
    provider: "stripe" | "manual",
    paymentStatus: string,
  ): Promise<Seeded & { orderId: string }> {
    const seeded = await seedTenantWithMember();

    // Zamówienie zakłada service_role: bramka 0010 wpuszcza narodziny
    // wyłącznie w statusie otwartym, a stan wyjściowy testu bywa inny.
    // To seed, nie ścieżka produkcyjna — ta idzie przez app.public_checkout.
    const { data: order, error } = await admin
      .from("orders")
      .insert({
        tenant_id: seeded.tenantId,
        customer_id: seeded.customerId,
        order_number: `Z4-2026-${nextOrderNumber()}`,
        start_date: "2026-11-01",
        end_date: "2026-11-03",
        delivery_method: "pickup",
        pickup_location_id: seeded.pickupId,
        order_status: "pending",
        payment_status: paymentStatus,
        payment_provider: provider,
        total_rental_grosze: 12_345,
        total_deposit_grosze: 0,
        delivery_grosze: 0,
      })
      .select("id")
      .single();
    if (error || !order) throw new Error(`order: ${error?.message}`);

    return { ...seeded, orderId: order.id as string };
  }

  const seedStripeOrder = (paymentStatus: string) => seedOrder("stripe", paymentStatus);
  const seedManualOrder = (paymentStatus: string) => seedOrder("manual", paymentStatus);

  beforeAll(() => {
    // Sanity: bez tego cała suita mogłaby biec na bazie bez migracji 0030
    // i „przechodzić", bo brak tabeli daje inny błąd niż brak uprawnień.
    expect(hasEnv).toBe(true);
  });
});
