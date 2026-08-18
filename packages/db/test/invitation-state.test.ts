/**
 * app.invitation_state — stan zaproszenia CZYTANY, nie zgadywany z błędu
 * (migracja 0087, ADR-196).
 *
 * PO CO TA FUNKCJA: odmowy `app.accept_invitation` rozróżniają stany kodami
 * P0003–P0007, ale PostgREST zjada klasę P0xxx do gołego 500 bez treści —
 * panel nie miał więc JAK powiedzieć człowiekowi, CZY zaproszenie wygasło,
 * czy zostało wystawione na inny adres (ADR-193 D6). Funkcja oddaje etykietę
 * stanu z ZAMKNIĘTEGO zbioru sześciu wartości i NIC ponad nią (ADR-181).
 *
 * NAJWAŻNIEJSZY TEST TEGO PLIKU: para stan↔zachowanie dla każdego z sześciu
 * stanów NA ŻYWEJ BAZIE — etykieta z `invitation_state` musi odpowiadać
 * faktycznemu wynikowi `accept_invitation` w TEJ SAMEJ sytuacji (odpowiedni
 * kod błędu albo sukces). To jest dowód, że funkcja odczytu nie jest drugim,
 * rozjeżdżalnym źródłem prawdy o warunkach wejścia do tenanta.
 *
 * Kanały jak w lifecycle-guards.test.ts: goły SQL w kontekście roli
 * `authenticated` z podstawionym claimem (kody błędów widoczne wprost —
 * PostgREST by je zjadł) ORAZ PostgREST (tak woła panel).
 *
 * Wymaga uruchomionego lokalnego Supabase.
 */
import { randomBytes, createHash, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

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

/** Zamknięty zbiór etykiet — kontrakt funkcji (0087). Nic poza nim nie wychodzi. */
const INVITATION_STATES = [
  "open",
  "not_found",
  "used",
  "revoked",
  "expired",
  "email_mismatch",
] as const;

const TEST_PASSWORD = "InvitationState!12345678";
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

async function createConfirmedUser(
  admin: SupabaseClient,
  label: string,
): Promise<{ id: string; email: string }> {
  const email = `invstate-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);
  return { id: data.user.id, email };
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error || !data.session) throw new Error(`signIn(${email}): ${error?.message}`);
  return client;
}

/** Tenant z ownerem — ścieżką produkcyjną (app.create_tenant), nie insertem. */
async function createTenantWithOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ tenantId: string; owner: { id: string; email: string } }> {
  const owner = await createConfirmedUser(admin, label);
  const bootstrapClient = await signIn(owner.email);
  const { data: tenantId, error } = await rpcCreateTenant(bootstrapClient, {
    p_slug: `invstate-${label}-${randomUUID()}`.slice(0, 39),
    p_name: `InvState ${label}`,
  });
  if (error || !tenantId) throw new Error(`create_tenant(${label}): ${error?.message}`);
  createdTenantIds.push(tenantId as string);
  return { tenantId: tenantId as string, owner };
}

/** Zaproszenie z surowym tokenem (hash liczony tak samo jak w panelu). */
async function seedInvitation(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
  patch: Record<string, unknown> = {},
): Promise<{ id: string; rawToken: string }> {
  const rawToken = randomBytes(32).toString("hex");
  const { data, error } = await admin
    .from("invitations")
    .insert({
      tenant_id: tenantId,
      email,
      role: "staff",
      token_hash: createHash("sha256").update(rawToken).digest("hex"),
      // Margines DOBY, nie sekund: zegar VM Dockera potrafi dryfować względem
      // zegara Node — ciasny margines robi z testu flake zależny od dryfu.
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      ...patch,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`insert invitations: ${error?.message}`);
  return { id: data.id as string, rawToken };
}

describe.skipIf(!hasEnv)("app.invitation_state (0087, ADR-196)", () => {
  let admin: SupabaseClient;
  let sql: ReturnType<typeof postgres>;
  let tenantA: { tenantId: string; owner: { id: string; email: string } };
  let tenantB: { tenantId: string; owner: { id: string; email: string } };
  /** Zapraszany BEZ żadnego członkostwa — jego sesja nie widzi invitations przez RLS. */
  let invitee: { id: string; email: string };

  beforeAll(async () => {
    admin = createAdminClient();
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    tenantA = await createTenantWithOwner(admin, "a");
    tenantB = await createTenantWithOwner(admin, "b");
    invitee = await createConfirmedUser(admin, "invitee");
  }, 60_000);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) {
      await admin.from("tenants").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdTenantIds.length = 0;
    createdUserIds.length = 0;
    await sql.end({ timeout: 5 });
  });

  /**
   * Goły SQL w kontekście roli `authenticated` (claim podstawiony ręcznie).
   * `sub: null` = brak sesji (auth.uid() zwraca NULL) — tak wygląda wywołanie
   * bez zalogowania, gdyby grant kiedyś objął rolę anon.
   */
  async function asAuthenticated<T>(
    sub: string | null,
    run: (tx: ReturnType<typeof postgres>) => Promise<T>,
  ): Promise<{ value?: T; errorCode?: string; errorMessage?: string }> {
    const claims: Record<string, unknown> = { role: "authenticated", app_metadata: {} };
    if (sub) claims.sub = sub;
    const jwt = JSON.stringify(claims);
    try {
      const value = await sql.begin(async (tx) => {
        await tx`select set_config('request.jwt.claims', ${jwt}, true)`;
        await tx`set local role authenticated`;
        return await run(tx);
      });
      return { value: value as T };
    } catch (error) {
      const err = error as { code?: string; message?: string };
      return { errorCode: err.code, errorMessage: err.message };
    }
  }

  /** Etykieta stanu gołym SQL-em w kontekście danego użytkownika. */
  async function readState(sub: string | null, token: string): Promise<string> {
    const res = await asAuthenticated(sub, async (tx) => {
      const rows = await tx`select app.invitation_state(${token}) as state`;
      return rows[0]?.state as string;
    });
    if (res.errorCode) throw new Error(`invitation_state: ${res.errorCode} ${res.errorMessage}`);
    return res.value as string;
  }

  /** Kod odmowy accept_invitation w tej samej sytuacji (undefined = sukces). */
  async function acceptCode(sub: string | null, token: string): Promise<string | undefined> {
    const res = await asAuthenticated(sub, async (tx) => {
      await tx`select app.accept_invitation(${token})`;
    });
    return res.errorCode;
  }

  // -------------------------------------------------------------------
  // 1. Zgodność stanów z rzeczywistością: etykieta == zachowanie akceptu
  //    w TEJ SAMEJ sytuacji. Sześć stanów, żywa baza.
  // -------------------------------------------------------------------

  it("not_found ↔ P0003: token bez wiersza", async () => {
    const token = randomBytes(32).toString("hex");
    expect(await readState(invitee.id, token)).toBe("not_found");
    expect(await acceptCode(invitee.id, token)).toBe("P0003");
  });

  it("used ↔ P0004: zaproszenie już wykorzystane", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email, {
      accepted_at: new Date().toISOString(),
    });
    expect(await readState(invitee.id, inv.rawToken)).toBe("used");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0004");
  });

  it("revoked ↔ P0007: zaproszenie odwołane", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email, {
      revoked_at: new Date().toISOString(),
    });
    expect(await readState(invitee.id, inv.rawToken)).toBe("revoked");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0007");
  });

  it("expired ↔ P0005: zaproszenie wygasłe (znacznik względem zegara BAZY)", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email);
    // Wygaśnięcie stemplujemy zegarem bazy, nie Node — dryf zegara VM Dockera
    // na tej maszynie potrafił odwracać porównania stemplowane mieszanie.
    await sql`update public.invitations set expires_at = now() - interval '1 hour' where id = ${inv.id}`;
    expect(await readState(invitee.id, inv.rawToken)).toBe("expired");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0005");
  });

  it("email_mismatch ↔ P0006: sesja na inny adres niż zaproszenie", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, "ktos-inny@test.local");
    expect(await readState(invitee.id, inv.rawToken)).toBe("email_mismatch");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0006");
  });

  it("open ↔ sukces akceptu: żywe zaproszenie na adres sesji wpuszcza — i dopiero wtedy", async () => {
    // Osobny użytkownik: po sukcesie STAJE SIĘ członkiem tenanta A, a testy
    // izolacji niżej wymagają zapraszanego BEZ członkostwa (kolejność w pliku
    // nie może być tym, co je chroni).
    const joiner = await createConfirmedUser(admin, "joiner");
    const inv = await seedInvitation(admin, tenantA.tenantId, joiner.email);

    expect(await readState(joiner.id, inv.rawToken)).toBe("open");

    // Akcept kanałem PostgREST — dokładnie tak woła panel.
    const joinerClient = await signIn(joiner.email);
    const { data, error } = await joinerClient
      .schema("app")
      .rpc("accept_invitation", { p_token: inv.rawToken });
    expect(error, `akcept żywego zaproszenia: ${error?.message}`).toBeNull();
    expect(data).toBe(tenantA.tenantId);

    // Po wykorzystaniu etykieta przechodzi w 'used' — stan nadąża za faktami.
    expect(await readState(joiner.id, inv.rawToken)).toBe("used");
  });

  it("brak sesji: stan tokenu BEZ rozstrzygania adresu (open, nie email_mismatch); akcept bez sesji to 28000", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, "adresat-nieobecny@test.local");
    // auth.uid() IS NULL → funkcja nie ma czego porównać i nie zgaduje.
    expect(await readState(null, inv.rawToken)).toBe("open");
    // Sam akcept bez sesji odmawia PRZED dotknięciem wiersza (28000) — stan
    // 'open' niczego więc nie obiecuje: bramką wejścia pozostaje akcept.
    expect(await acceptCode(null, inv.rawToken)).toBe("28000");
  });

  // -------------------------------------------------------------------
  // 2. Priorytet rozstrzygania — kolejność warunków jest kontraktem (0051)
  // -------------------------------------------------------------------

  it("priorytet: wiersz ODWOŁANY I WYGASŁY naraz daje 'revoked', jak P0007 akceptu", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email, {
      revoked_at: new Date().toISOString(),
    });
    await sql`update public.invitations set expires_at = now() - interval '1 hour' where id = ${inv.id}`;
    // Decyzja ownera bije upływ czasu (ADR-105 D3) — komunikat nie ma
    // sugerować, że wystarczy poprosić o przedłużenie.
    expect(await readState(invitee.id, inv.rawToken)).toBe("revoked");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0007");
  });

  it("priorytet: wiersz WYKORZYSTANY I ODWOŁANY naraz daje 'used', jak P0004 akceptu", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email, {
      accepted_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
    });
    expect(await readState(invitee.id, inv.rawToken)).toBe("used");
    expect(await acceptCode(invitee.id, inv.rawToken)).toBe("P0004");
  });

  // -------------------------------------------------------------------
  // 3. Kanał PostgREST — tak woła panel (sesja zapraszanego, schema app)
  // -------------------------------------------------------------------

  it("PostgREST: sesja zapraszanego czyta etykietę; każda wartość z zamkniętego zbioru", async () => {
    const expired = await seedInvitation(admin, tenantA.tenantId, invitee.email);
    await sql`update public.invitations set expires_at = now() - interval '1 hour' where id = ${expired.id}`;
    const mismatch = await seedInvitation(admin, tenantA.tenantId, "inny@test.local");
    const open = await seedInvitation(admin, tenantA.tenantId, invitee.email);

    const inviteeClient = await signIn(invitee.email);
    const cases: Array<{ token: string; expected: string }> = [
      { token: expired.rawToken, expected: "expired" },
      { token: mismatch.rawToken, expected: "email_mismatch" },
      { token: open.rawToken, expected: "open" },
      { token: randomBytes(32).toString("hex"), expected: "not_found" },
    ];
    for (const c of cases) {
      const { data, error } = await inviteeClient
        .schema("app")
        .rpc("invitation_state", { p_token: c.token });
      expect(error, `invitation_state(${c.expected}): ${error?.message}`).toBeNull();
      expect(data).toBe(c.expected);
      // Zero danych ponad stan: odpowiedź to GOŁA etykieta z zamkniętego
      // zbioru — nie obiekt, nie wiersz, nie adres (ADR-181).
      expect(typeof data).toBe("string");
      expect(INVITATION_STATES).toContain(data);
    }
  });

  // -------------------------------------------------------------------
  // 4. Izolacja (warunek zamknięcia zadania)
  // -------------------------------------------------------------------

  it("izolacja: token tenanta A z sesji użytkownika tenanta B — stan TAK (token=uprawnienie), członkostwo NIE", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, "adresat-a@test.local");

    // Owner B ma własnego tenanta i NIE jest członkiem A. Token dostał (np.
    // przekazany dalej) — stan wolno mu odczytać, bo tokenem się legitymuje...
    const ownerBClient = await signIn(tenantB.owner.email);
    const { data, error } = await ownerBClient
      .schema("app")
      .rpc("invitation_state", { p_token: inv.rawToken });
    expect(error).toBeNull();
    expect(data).toBe("email_mismatch");
    expect(INVITATION_STATES).toContain(data);

    // ...ale odczyt stanu NICZEGO nie otwiera: akcept cudzego zaproszenia
    // dalej odmawia (P0006) i żadne członkostwo w A nie powstaje.
    expect(await acceptCode(tenantB.owner.id, inv.rawToken)).toBe("P0006");
    const { data: members } = await admin
      .from("members")
      .select("user_id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("user_id", tenantB.owner.id);
    expect(members ?? []).toHaveLength(0);
  });

  it("izolacja: anon bez SELECT na invitations (42501) i bez EXECUTE na invitation_state (42501)", async () => {
    // Kontrola pozytywna: wiersz ISTNIEJE (zasiany), odmowa nie jest skutkiem
    // pustej tabeli, tylko braku grantu.
    const inv = await seedInvitation(admin, tenantA.tenantId, "widoczny-tylko-funkcja@test.local");

    const anonClient = createAnonClient();
    const { data: rows, error: selectError } = await anonClient
      .from("invitations")
      .select("id")
      .eq("id", inv.id);
    expect(selectError, "anon dostał SELECT na public.invitations — regres grantów").not.toBeNull();
    expect(selectError?.code).toBe("42501");
    expect(rows ?? null).toBeNull();

    // Funkcja jest dla authenticated — anon nie woła jej wcale (0087: grant
    // wyłącznie authenticated; wejście anon i tak kończy się na logowaniu).
    const { data: stateData, error: rpcError } = await anonClient
      .schema("app")
      .rpc("invitation_state", { p_token: inv.rawToken });
    expect(rpcError, "anon wykonał app.invitation_state — regres grantu 0087").not.toBeNull();
    expect(rpcError?.code).toBe("42501");
    expect(stateData ?? null).toBeNull();
  });

  it("izolacja: zapraszany (authenticated, nie-członek) NIE widzi wiersza wprost — nawet własnego zaproszenia; jedyna droga to funkcja", async () => {
    // Najostrzejsza wersja: wiersz jest ADRESOWANY do niego (jego e-mail),
    // a RLS tenant_select (0001/0060) i tak pokazuje invitations wyłącznie
    // CZŁONKOM tenanta. Grant tabelowy authenticated z 0001 istnieje, ale
    // bez polityki nie daje ani wiersza.
    const inv = await seedInvitation(admin, tenantA.tenantId, invitee.email);

    const inviteeClient = await signIn(invitee.email);
    const direct = await inviteeClient.from("invitations").select("id, email, token_hash");
    expect(direct.error, `bezpośredni SELECT zapraszanego: ${direct.error?.message}`).toBeNull();
    expect(
      direct.data ?? [],
      "sesja zapraszanego zobaczyła wiersze invitations wprost — RLS przestało filtrować",
    ).toHaveLength(0);

    const scoped = await inviteeClient.from("invitations").select("id").eq("id", inv.id);
    expect(scoped.data ?? []).toHaveLength(0);
  });

  it("izolacja: członek tenanta B nie widzi invitations tenanta A wprost (macierz najemca↔najemca)", async () => {
    const inv = await seedInvitation(admin, tenantA.tenantId, "cudzy-wiersz@test.local");
    const ownerBClient = await signIn(tenantB.owner.email);
    const { data, error } = await ownerBClient.from("invitations").select("id").eq("id", inv.id);
    expect(error).toBeNull();
    expect(data ?? []).toHaveLength(0);
  });
});
