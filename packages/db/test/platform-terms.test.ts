/**
 * Regulamin platformy — niezmienne wersje, dowód akceptacji i twarde
 * wymuszenie w app.create_tenant (migracja 0070_platform_terms.sql, ADR-141;
 * platformowe lustro B4/ADR-129).
 *
 * Test dowodzi pięciu osi:
 *   1. SZKIC NIE JEST UMOWĄ: placeholder v0 (effective_from NULL) nie wychodzi
 *      żadną drogą publiczną (get_platform_terms, permalink), niczego nie
 *      wymusza i nie da się go zaakceptować. Brak opublikowanej wersji =
 *      zachowanie sprzed 0070 CO DO ZNAKU.
 *   2. STEMPEL: version_no, version_label, sha256_pl/en i published_at nadaje
 *      BAZA — wartości z wejścia są ignorowane; parytet PL↔EN to CHECK-i.
 *   3. WYMUSZENIE TWARDE (D5): przy obowiązującej wersji create_tenant bez
 *      wskazania DOKŁADNIE tej wersji odmawia; z akceptacją tenant + dowód
 *      powstają w JEDNEJ transakcji.
 *   4. NIEZMIENNOŚĆ: wersji ani dowodu nie zmieni i nie usunie sesja API
 *      nawet po zdjęciu warstwy grantów (strażnik, 42501); dowód nie może
 *      wskazać nieistniejącej wersji (FK).
 *   5. IZOLACJA: dowody widzi wyłącznie żywy członek własnej organizacji;
 *      anon nic; zapis przez API nie istnieje (wyłącznie funkcje DEFINER).
 *
 * PUBLIKACJA W TESTACH WYŁĄCZNIE W TRANSAKCJI ZAMKNIĘTEJ ROLLBACK-IEM
 * (wzorzec B4 z legal-documents.test.ts): baza lokalna jest WSPÓŁDZIELONA,
 * a zacommitowana wersja obowiązująca uzbroiłaby wymuszenie w create_tenant
 * dla wszystkich równoległych suit. Z tego samego powodu sondy strażników
 * zdejmują granty/polityki TYLKO wewnątrz transakcji (nigdy globalnie),
 * z krótkim deadlock_timeout i ponowieniami — samoofiarowanie przy DDL na
 * gorących tabelach (lekcja z sondy B4).
 */
import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_INVALID_PARAMETER = "22023";
const PG_CHECK_VIOLATION = "23514";
const PG_FK_VIOLATION = "23503";
const PG_TERMS_REQUIRED = "P0003";
const PG_DEADLOCK = "40P01";

/** Sygnał domknięcia sondy — cała transakcja odwijana ROLLBACK-iem. */
class Rollback extends Error {}

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function adminClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const TEST_PASSWORD = "PlatformTerms!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

interface Actor {
  userId: string;
  email: string;
  client: SupabaseClient;
}

/** Świeży, potwierdzony użytkownik (bez logowania). */
async function createConfirmedUser(
  admin: SupabaseClient,
  appMetadata?: Record<string, unknown>,
): Promise<{ userId: string; email: string }> {
  const email = `pterms-${randomUUID().slice(0, 10)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    ...(appMetadata ? { app_metadata: appMetadata } : {}),
  });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { userId: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn: ${error.message}`);
  return client;
}

/** Potwierdzony użytkownik zalogowany kluczem anon (bez organizacji). */
async function signedInUser(admin: SupabaseClient): Promise<Actor> {
  const user = await createConfirmedUser(admin);
  return { ...user, client: await signIn(user.email) };
}

/**
 * Tenant zasiany service-rolem + zalogowany członek zadanej roli.
 * KOLEJNOŚĆ MA ZNACZENIE (wzorzec seedActor z legal-documents.test.ts):
 * logowanie dopiero PO wpisie do members — hook tokenów liczy claim
 * tenant_id przy WYSTAWIENIU tokenu, więc wcześniejsza sesja nie niosłaby
 * kontekstu organizacji i RLS słusznie pokazywałoby pustkę.
 */
async function seedTenantWithMember(
  admin: SupabaseClient,
  role: "owner" | "staff",
  existingTenantId?: string,
): Promise<{ tenantId: string; actor: Actor }> {
  let tenantId = existingTenantId;
  if (!tenantId) {
    const slug = `pterms-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data: tenant, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Platform terms ${role}`, locale: "pl" })
      .select("id")
      .single();
    if (error || !tenant) throw new Error(`seed tenant: ${error?.message}`);
    tenantId = tenant.id as string;
    createdTenantIds.push(tenantId);
  }

  const user = await createConfirmedUser(admin, { tenant_id: tenantId, role });
  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: user.userId, role });
  if (memberError) throw new Error(`seed member: ${memberError.message}`);
  return { tenantId, actor: { ...user, client: await signIn(user.email) } };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

describe.skipIf(!hasEnv)("regulamin platformy (0070, ADR-141)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);
  const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

  afterAll(async () => {
    if (!hasEnv) return;
    // Tenanty założone przez create_tenant w testach wymuszenia — dołącz
    // te, które wiszą na członkostwach userów testowych.
    if (createdUserIds.length > 0) {
      const rows = await sql!<{ tenant_id: string }[]>`
        select distinct tenant_id from public.members
        where user_id = any(${sql!.array(createdUserIds)}::uuid[])
      `;
      for (const row of rows) createdTenantIds.push(row.tenant_id);
    }
    for (const id of [...new Set(createdTenantIds)]) {
      await admin.from("tenants").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    await sql?.end({ timeout: 5 });
  });

  // -------------------------------------------------------------------
  // 1. Szkic v0 — stan bazowy współdzielonej bazy
  // -------------------------------------------------------------------

  it("seed 0070: placeholder v0 istnieje wyłącznie jako SZKIC i nie wychodzi żadną drogą publiczną", async () => {
    const rows = await sql!<
      { version_label: string; szkic: boolean; sha_ok: boolean; published: boolean }[]
    >`
      select version_label,
             effective_from is null as szkic,
             sha256_pl = ${sha256Hex("[treść po weryfikacji prawnika]")} as sha_ok,
             published_at is not null as published
      from public.platform_terms_versions
      where version_no = 0
    `;
    expect(rows, "brak placeholder v0 z seedu 0070").toHaveLength(1);
    expect(rows[0]!.version_label).toBe("v0");
    expect(rows[0]!.szkic, "v0 ma być SZKICEM (effective_from NULL)").toBe(true);
    expect(rows[0]!.sha_ok, "stempel sha256_pl nie odpowiada bajtom placeholdera").toBe(true);
    expect(rows[0]!.published).toBe(true);

    // Permalink NIE ZWRACA SZKICU — dokładnie ta własność jest celem wektora
    // mutacyjnego „permalink zwraca szkic" (zdjęcie filtra effective_from).
    const { data: permalink, error: permalinkError } = await anon
      .schema("app")
      .rpc("get_platform_terms_version", { p_version_no: 0 });
    expect(permalinkError).toBeNull();
    expect(permalink, "SZKIC v0 wyszedł permalinkiem").toBeNull();
  });

  it("brak OBOWIĄZUJĄCEJ wersji NICZEGO nie blokuje: create_tenant działa bez akceptacji (bramka (f) czeka na prawnika)", async () => {
    // Adaptacyjnie względem stanu współdzielonej bazy: dziś (po 0070, przed
    // migracją-seedem od prawnika) nic nie obowiązuje i goły create_tenant MA
    // przechodzić. Gdy treść od prawnika kiedyś wejdzie, ten sam test dowodzi
    // drugiej połowy kontraktu: goły create_tenant MA odmawiać P0003.
    const { data: current } = await anon.schema("app").rpc("get_platform_terms");

    const user = await signedInUser(admin);
    const slug = `pterms-plain-${randomUUID().slice(0, 8)}`.slice(0, 39);
    const { data, error } = await user.client.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Bez regulaminu",
    });

    if (current == null) {
      expect(error, `create_tenant bez wersji odmówił mimo braku obowiązującej: ${error?.message}`).toBeNull();
      expect(data).toBeTruthy();
      createdTenantIds.push(data as string);
    } else {
      expect(error).not.toBeNull();
      expect(error!.code).toBe(PG_TERMS_REQUIRED);
    }
  });

  it("wskazanie wersji, gdy ŻADNA nie obowiązuje → odmowa (dowód na nieobowiązującą wersję byłby kłamstwem)", async () => {
    const { data: current } = await anon.schema("app").rpc("get_platform_terms");
    if (current != null) return; // gałąź ma sens tylko przed seedem treści

    const [{ id: szkicId }] = await sql!<{ id: string }[]>`
      select id from public.platform_terms_versions where version_no = 0
    `;
    const user = await signedInUser(admin);
    const { error } = await user.client.schema("app").rpc("create_tenant", {
      p_slug: `pterms-fake-${randomUUID().slice(0, 8)}`.slice(0, 39),
      p_name: "Ze szkicem",
      p_terms_version_id: szkicId,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe(PG_INVALID_PARAMETER);
  });

  it("helper testowy rpcCreateTenant przechodzi w obu stanach rejestru (kontrakt na przyszły seed v1)", async () => {
    const user = await signedInUser(admin);
    const { data, error } = await rpcCreateTenant(user.client, {
      p_slug: `pterms-helper-${randomUUID().slice(0, 8)}`.slice(0, 39),
      p_name: "Helper",
    });
    expect(error, `rpcCreateTenant: ${error?.message}`).toBeNull();
    createdTenantIds.push(data as string);
  });

  // -------------------------------------------------------------------
  // 2. Publikacja w transakcji ROLLBACK — stemple i odczyt publiczny
  // -------------------------------------------------------------------

  it("stempel wersji: numer, etykietę, sha256 PL/EN i moment publikacji nadaje BAZA; permalink okazuje wersje historyczne", async () => {
    await sql!
      .begin(async (tx) => {
        // Wejście celowo KŁAMIE (version_no=999, sha=aaa…/bbb…) — stempel
        // ma je nadpisać wartościami policzonymi przez bazę.
        await tx`
          insert into public.platform_terms_versions
            (version_no, sha256_pl, sha256_en, title_pl, body_pl, title_en, body_en, effective_from)
          values
            (999, ${"a".repeat(64)}, ${"b".repeat(64)},
             'Regulamin', 'Treść PL v1', 'Terms', 'Body EN v1', now())
        `;

        const [v1] = await tx<
          { id: string; version_no: number; version_label: string; sha_pl: string; sha_en: string }[]
        >`
          select id, version_no, version_label, sha256_pl as sha_pl, sha256_en as sha_en
          from public.platform_terms_versions
          order by version_no desc limit 1
        `;
        expect(v1.version_no, "numer wersji ma nadać baza (max+1), nie wejście").toBe(1);
        expect(v1.version_label).toBe("v1");
        expect(v1.sha_pl).toBe(sha256Hex("Treść PL v1"));
        expect(v1.sha_en).toBe(sha256Hex("Body EN v1"));

        const [{ live }] = await tx<{ live: string }[]>`
          select app.get_platform_terms() ->> 'version_label' as live
        `;
        expect(live).toBe("v1");

        // Druga wersja przejmuje rolę żywej…
        await tx`
          insert into public.platform_terms_versions
            (title_pl, body_pl, title_en, body_en, effective_from)
          values ('Regulamin', 'Treść PL v2', 'Terms', 'Body EN v2', now())
        `;
        const [after] = await tx<
          { live: string; old_current: boolean; old_body: string; szkic_hidden: boolean }[]
        >`
          select app.get_platform_terms() ->> 'version_label' as live,
                 (app.get_platform_terms_version(1) ->> 'current')::boolean as old_current,
                 app.get_platform_terms_version(1) ->> 'body_pl' as old_body,
                 app.get_platform_terms_version(0) is null as szkic_hidden
        `;
        expect(after.live).toBe("v2");
        // …a stara zostaje OKAZYWALNA permalinkiem, bajt w bajt (B4).
        expect(after.old_current).toBe(false);
        expect(after.old_body).toBe("Treść PL v1");
        // Szkic dalej nie wychodzi, choć obok stoją dwie opublikowane.
        expect(after.szkic_hidden).toBe(true);

        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  it("parytet PL↔EN jest własnością wersji: pusta treść któregokolwiek języka nie przechodzi CHECK-a", async () => {
    await sql!
      .begin(async (tx) => {
        let code: string | undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`
              insert into public.platform_terms_versions
                (title_pl, body_pl, title_en, body_en, effective_from)
              values ('Regulamin', 'Treść PL', 'Terms', '   ', now())
            `;
          });
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code, "wersja z pustym body_en przeszła — parytet PL↔EN nie jest egzekwowany").toBe(
          PG_CHECK_VIOLATION,
        );
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  // -------------------------------------------------------------------
  // 3. Twarde wymuszenie w create_tenant + atomowość dowodu (ROLLBACK)
  // -------------------------------------------------------------------

  it("create_tenant przy obowiązującej wersji: bez akceptacji → P0003, zła wersja → 22023, z akceptacją → tenant + dowód ATOMOWO", async () => {
    // Potwierdzony user powstaje PRZED transakcją (GoTrue pisze własną pulą),
    // ale wszystko, co dotyczy regulaminu, żyje i umiera w transakcji.
    const user = await signedInUser(admin);
    const claims = JSON.stringify({ sub: user.userId, role: "authenticated" });

    await sql!
      .begin(async (tx) => {
        await tx`
          insert into public.platform_terms_versions
            (title_pl, body_pl, title_en, body_en, effective_from)
          values ('Regulamin', 'Treść PL v1', 'Terms', 'Body EN v1', now())
        `;
        const [{ id: v1Id }] = await tx<{ id: string }[]>`
          select id from public.platform_terms_versions where version_no = 1
        `;

        await tx`select set_config('request.jwt.claims', ${claims}, true)`;
        await tx`set local role authenticated`;

        // (a) bez wskazania wersji → P0003 (WEKTOR MUTACYJNY: zdjęcie
        //     wymuszenia w RPC gasi dokładnie tę asercję).
        let code: string | undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`select app.create_tenant(${`pt-a-${randomUUID().slice(0, 8)}`}, 'Bez akceptacji')`;
          });
        } catch (error) {
          if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
          code = (error as { code?: string }).code;
        }
        expect(code, "create_tenant BEZ akceptacji przeszedł mimo obowiązującej wersji").toBe(
          PG_TERMS_REQUIRED,
        );

        // (b) wersja inna niż obowiązująca → 22023.
        code = undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`select app.create_tenant(${`pt-b-${randomUUID().slice(0, 8)}`}, 'Zła wersja', ${randomUUID()}::uuid)`;
          });
        } catch (error) {
          if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
          code = (error as { code?: string }).code;
        }
        expect(code).toBe(PG_INVALID_PARAMETER);

        // (c) z akceptacją → tenant + członkostwo + DOWÓD w jednej transakcji.
        const [{ tenant_id }] = await tx<{ tenant_id: string }[]>`
          select app.create_tenant(${`pt-c-${randomUUID().slice(0, 8)}`}, 'Z akceptacją', ${v1Id}::uuid) as tenant_id
        `;
        expect(tenant_id).toBeTruthy();

        await tx`reset role`;
        const proofs = await tx<
          { user_id: string; version_id: string; context: string }[]
        >`
          select user_id, version_id, context
          from public.platform_terms_acceptances
          where tenant_id = ${tenant_id}
        `;
        expect(proofs, "brak dowodu akceptacji w tej samej transakcji co tenant").toHaveLength(1);
        expect(proofs[0]!.user_id).toBe(user.userId);
        expect(proofs[0]!.version_id).toBe(v1Id);
        expect(proofs[0]!.context).toBe("tenant_creation");

        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  it("accept_platform_terms (konta istniejące): żywy owner tak — idempotentnie; personel 42501; wersja zastąpiona 22023; szkic 22023", async () => {
    const owner = await signedInUser(admin);
    const staff = await signedInUser(admin);

    await sql!
      .begin(async (tx) => {
        await tx`
          insert into public.platform_terms_versions
            (title_pl, body_pl, title_en, body_en, effective_from)
          values ('Regulamin', 'Treść PL v1', 'Terms', 'Body EN v1', now())
        `;
        const [{ id: v1Id }] = await tx<{ id: string }[]>`
          select id from public.platform_terms_versions where version_no = 1
        `;
        const [{ id: szkicId }] = await tx<{ id: string }[]>`
          select id from public.platform_terms_versions where version_no = 0
        `;
        const [{ id: tenantId }] = await tx<{ id: string }[]>`
          insert into public.tenants (slug, name)
          values (${`pt-acc-${randomUUID().slice(0, 10)}`}, 'Konto istniejące')
          returning id
        `;
        await tx`
          insert into public.members (tenant_id, user_id, role)
          values (${tenantId}, ${owner.userId}, 'owner'), (${tenantId}, ${staff.userId}, 'staff')
        `;

        const asUser = async (userId: string) => {
          const claims = JSON.stringify({
            sub: userId,
            role: "authenticated",
            app_metadata: { tenant_id: tenantId, role: "member" },
          });
          await tx`select set_config('request.jwt.claims', ${claims}, true)`;
          await tx`set local role authenticated`;
        };

        // Personel NIE akceptuje w imieniu organizacji (bramka ŻYWEGO ownera).
        await asUser(staff.userId);
        let code: string | undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`select app.accept_platform_terms(${v1Id}::uuid)`;
          });
        } catch (error) {
          if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
          code = (error as { code?: string }).code;
        }
        expect(code, "personel zaakceptował regulamin w imieniu organizacji").toBe(
          PG_INSUFFICIENT_PRIVILEGE,
        );

        // Szkic nie jest umową — nie da się go przyjąć.
        await asUser(owner.userId);
        code = undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`select app.accept_platform_terms(${szkicId}::uuid)`;
          });
        } catch (error) {
          if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
          code = (error as { code?: string }).code;
        }
        expect(code, "SZKIC dał się zaakceptować").toBe(PG_INVALID_PARAMETER);

        // Owner przyjmuje v1 — dwa razy, dowód jest JEDEN (idempotencja).
        await tx`select app.accept_platform_terms(${v1Id}::uuid)`;
        await tx`select app.accept_platform_terms(${v1Id}::uuid)`;
        await tx`reset role`;
        const proofs = await tx<{ context: string; user_id: string }[]>`
          select context, user_id from public.platform_terms_acceptances
          where tenant_id = ${tenantId}
        `;
        expect(proofs).toHaveLength(1);
        expect(proofs[0]!.context).toBe("terms_update");
        expect(proofs[0]!.user_id).toBe(owner.userId);

        // Po wejściu v2 stara wersja przestaje być akceptowalna (22023) —
        // owner musi przeczytać nową; jej przyjęcie działa.
        await tx`
          insert into public.platform_terms_versions
            (title_pl, body_pl, title_en, body_en, effective_from)
          values ('Regulamin', 'Treść PL v2', 'Terms', 'Body EN v2', now())
        `;
        const [{ id: v2Id }] = await tx<{ id: string }[]>`
          select id from public.platform_terms_versions where version_no = 2
        `;
        await asUser(owner.userId);
        code = undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`select app.accept_platform_terms(${v1Id}::uuid)`;
          });
        } catch (error) {
          if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
          code = (error as { code?: string }).code;
        }
        expect(code, "wersja zastąpiona nowszą dała się zaakceptować").toBe(PG_INVALID_PARAMETER);
        await tx`select app.accept_platform_terms(${v2Id}::uuid)`;

        await tx`reset role`;
        const [{ count }] = await tx<{ count: number }[]>`
          select count(*)::int as count from public.platform_terms_acceptances
          where tenant_id = ${tenantId}
        `;
        expect(count).toBe(2);

        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  // -------------------------------------------------------------------
  // 4. Niezmienność — sondy strażników (grant + polityka zdjęte w tx)
  // -------------------------------------------------------------------

  /**
   * Sonda wspólna dla obu tabel: wewnątrz JEDNEJ transakcji nadaje roli
   * authenticated grant + permisywne polityki (widoczne tylko w tej
   * transakcji), wykonuje mutację i oczekuje 42501 od STRAŻNIKA — nie ciszy
   * RLS, nie braku grantu. Deadlock (CREATE POLICY na tabeli vs równoległe
   * suity na katalogach auth) rozstrzyga krótki deadlock_timeout — ofiarą
   * jest ta transakcja, którą po prostu ponawiamy.
   */
  async function guardProbe(
    table: "platform_terms_versions" | "platform_terms_acceptances",
    seed: (tx: postgres.TransactionSql) => Promise<string>,
    mutate: (tx: postgres.TransactionSql, id: string) => Promise<void>,
  ): Promise<{ proven: boolean; guardCode?: string; selectable: number }> {
    const MAX_ATTEMPTS = 10;
    let proven = false;
    let guardCode: string | undefined;
    let selectable = -1;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !proven; attempt++) {
      guardCode = undefined;
      selectable = -1;
      try {
        await sql!.begin(async (tx) => {
          await tx`set local deadlock_timeout = '20ms'`;
          const rowId = await seed(tx);

          await tx.unsafe(`grant select, update, delete on public.${table} to authenticated`);
          await tx.unsafe(
            `create policy probe_select on public.${table} for select using (true)`,
          );
          await tx.unsafe(
            `create policy probe_update on public.${table} for update using (true) with check (true)`,
          );
          await tx.unsafe(`create policy probe_delete on public.${table} for delete using (true)`);
          await tx`select set_config('request.jwt.claims', ${JSON.stringify({
            sub: randomUUID(),
            role: "authenticated",
          })}, true)`;
          await tx`set local role authenticated`;

          // KONTROLA POZYTYWNA: rola/polityka/grant działają — wiersz WIDAĆ.
          const visible = await tx.unsafe(
            `select 1 from public.${table} where id = '${rowId}'`,
          );
          selectable = visible.length;

          try {
            await tx.savepoint(async (sp) => {
              await mutate(sp as unknown as postgres.TransactionSql, rowId);
            });
          } catch (error) {
            if ((error as { code?: string }).code === PG_DEADLOCK) throw error;
            guardCode = (error as { code?: string }).code;
          }

          proven = true;
          throw new Rollback();
        });
      } catch (error) {
        if (error instanceof Rollback) break;
        if ((error as { code?: string }).code === PG_DEADLOCK) continue;
        throw error;
      }
    }
    return { proven, guardCode, selectable };
  }

  const seedVersion = async (tx: postgres.TransactionSql): Promise<string> => {
    const [{ id }] = await tx<{ id: string }[]>`
      insert into public.platform_terms_versions (title_pl, body_pl, title_en, body_en, effective_from)
      values ('Regulamin', 'Chroniona treść', 'Terms', 'Guarded body', now())
      returning id
    `;
    return id;
  };

  const seedAcceptance = async (tx: postgres.TransactionSql): Promise<string> => {
    const [{ id: tenantId }] = await tx<{ id: string }[]>`
      insert into public.tenants (slug, name)
      values (${`pt-guard-${randomUUID().slice(0, 10)}`}, 'Guard probe')
      returning id
    `;
    const [{ id: versionId }] = await tx<{ id: string }[]>`
      select id from public.platform_terms_versions where version_no = 0
    `;
    const [{ id }] = await tx<{ id: string }[]>`
      insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
      values (${tenantId}, ${randomUUID()}, ${versionId}, 'tenant_creation')
      returning id
    `;
    return id;
  };

  it("strażnik wersji odbija UPDATE i DELETE po zdjęciu warstwy grantów (42501)", async () => {
    for (const op of ["update", "delete"] as const) {
      const result = await guardProbe(
        "platform_terms_versions",
        seedVersion,
        async (sp, id) => {
          if (op === "update") {
            await sp.unsafe(
              `update public.platform_terms_versions set title_pl = 'Podmieniony' where id = '${id}'`,
            );
          } else {
            await sp.unsafe(`delete from public.platform_terms_versions where id = '${id}'`);
          }
        },
      );
      expect(result.proven, `sonda ${op} zakleszczała się w każdej próbie`).toBe(true);
      expect(result.selectable, "kontrola pozytywna: wiersza nie widać — sonda nic nie dowodzi").toBe(1);
      expect(
        result.guardCode,
        `z grantem i polityką permisywną wersję dało się ${op === "update" ? "zmienić" : "usunąć"} — strażnik nie działa`,
      ).toBe(PG_INSUFFICIENT_PRIVILEGE);
    }
  });

  it("strażnik dowodów odbija UPDATE i DELETE po zdjęciu warstwy grantów (42501)", async () => {
    for (const op of ["update", "delete"] as const) {
      const result = await guardProbe(
        "platform_terms_acceptances",
        seedAcceptance,
        async (sp, id) => {
          if (op === "update") {
            await sp.unsafe(
              `update public.platform_terms_acceptances set context = 'terms_update' where id = '${id}'`,
            );
          } else {
            await sp.unsafe(`delete from public.platform_terms_acceptances where id = '${id}'`);
          }
        },
      );
      expect(result.proven, `sonda ${op} zakleszczała się w każdej próbie`).toBe(true);
      expect(result.selectable).toBe(1);
      expect(result.guardCode, `dowód akceptacji dał się ${op === "update" ? "zmienić" : "usunąć"}`).toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
    }
  });

  it("dowód nie może wskazać nieistniejącej wersji — FK (WEKTOR: zdjęcie FK dowodu)", async () => {
    await sql!
      .begin(async (tx) => {
        const [{ id: tenantId }] = await tx<{ id: string }[]>`
          insert into public.tenants (slug, name)
          values (${`pt-fk-${randomUUID().slice(0, 10)}`}, 'FK probe')
          returning id
        `;
        let code: string | undefined;
        try {
          await tx.savepoint(async (sp) => {
            await sp`
              insert into public.platform_terms_acceptances (tenant_id, user_id, version_id, context)
              values (${tenantId}, ${randomUUID()}, ${randomUUID()}, 'tenant_creation')
            `;
          });
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code, "dowód wskazał wersję, której nie ma — FK nie działa").toBe(PG_FK_VIOLATION);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });

  // -------------------------------------------------------------------
  // 5. Izolacja i drogi zapisu (PostgREST, dane trwałe + sprzątanie)
  // -------------------------------------------------------------------

  it("dowody widzi żywy członek WŁASNEJ organizacji (owner i personel); cudzych nie widać; anon nic", async () => {
    const a = await seedTenantWithMember(admin, "owner");
    const b = await seedTenantWithMember(admin, "owner");
    const { actor: staffA } = await seedTenantWithMember(admin, "staff", a.tenantId);

    const [{ id: versionId }] = await sql!<{ id: string }[]>`
      select id from public.platform_terms_versions where version_no = 0
    `;
    const { error: seedError } = await admin.from("platform_terms_acceptances").insert([
      { tenant_id: a.tenantId, user_id: a.actor.userId, version_id: versionId, context: "tenant_creation" },
      { tenant_id: b.tenantId, user_id: b.actor.userId, version_id: versionId, context: "tenant_creation" },
    ]);
    expect(seedError, `seed dowodów: ${seedError?.message}`).toBeNull();

    // Owner A widzi wyłącznie wpisy organizacji A…
    const { data: mine, error: mineError } = await a.actor.client
      .from("platform_terms_acceptances")
      .select("tenant_id");
    expect(mineError).toBeNull();
    expect(mine!.length).toBeGreaterThan(0);
    expect(mine!.every((row) => row.tenant_id === a.tenantId)).toBe(true);

    // …celowane zapytanie o cudzą organizację jest PUSTE (nieodróżnialne od braku).
    const { data: foreign } = await a.actor.client
      .from("platform_terms_acceptances")
      .select("id")
      .eq("tenant_id", b.tenantId);
    expect(foreign).toEqual([]);

    // Personel A czyta fakt akceptacji własnej organizacji (odczyt CZŁONKOWSKI
    // — bez niego przesłona zapalałaby się zdegradowanemu ownerowi, patrz 0070).
    const { data: staffRead, error: staffError } = await staffA.client
      .from("platform_terms_acceptances")
      .select("tenant_id")
      .eq("tenant_id", a.tenantId);
    expect(staffError).toBeNull();
    expect(staffRead!.length).toBe(1);

    // Anon: zero grantu SELECT — odmowa, nie pusta lista.
    const { error: anonError } = await anon.from("platform_terms_acceptances").select("id");
    expect(anonError, "anon odczytał dowody akceptacji").not.toBeNull();
  });

  it("sesja API nie zapisze, nie zmieni i nie usunie dowodu — zapis wyłącznie funkcjami DEFINER", async () => {
    const a = await seedTenantWithMember(admin, "owner");
    const [{ id: versionId }] = await sql!<{ id: string }[]>`
      select id from public.platform_terms_versions where version_no = 0
    `;

    const { error: insertError } = await a.actor.client.from("platform_terms_acceptances").insert({
      tenant_id: a.tenantId,
      user_id: a.actor.userId,
      version_id: versionId,
      context: "tenant_creation",
    });
    expect(insertError, "INSERT sesją API przeszedł").not.toBeNull();

    await admin.from("platform_terms_acceptances").insert({
      tenant_id: a.tenantId,
      user_id: a.actor.userId,
      version_id: versionId,
      context: "tenant_creation",
    });
    const { error: updateError } = await a.actor.client
      .from("platform_terms_acceptances")
      .update({ context: "terms_update" })
      .eq("tenant_id", a.tenantId);
    expect(updateError, "UPDATE sesją API przeszedł").not.toBeNull();

    const { error: deleteError } = await a.actor.client
      .from("platform_terms_acceptances")
      .delete()
      .eq("tenant_id", a.tenantId);
    expect(deleteError, "DELETE sesją API przeszedł").not.toBeNull();

    // Rejestr WERSJI jest dla sesji API całkowicie niewidoczny (zero grantów)
    // — odczyt publiczny istnieje wyłącznie przez funkcje DEFINER.
    const { error: versionsError } = await a.actor.client
      .from("platform_terms_versions")
      .select("id");
    expect(versionsError, "sesja API czyta rejestr wersji wprost").not.toBeNull();
  });
});
