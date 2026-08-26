/**
 * `app.nip_lookup_cache` + weryfikacja NIP w `app.create_tenant` (0096-0099,
 * ADR-234). Test dowodzi PIĘCIU osi:
 *
 *   1. TABELA NIEDOSTĘPNA WPROST przez PostgREST — ani authenticated (żaden
 *      tenant), ani anon nie odczyta/zapisze `app.nip_lookup_cache`
 *      bezpośrednio (zero grantów + RLS bez polityk = fail-closed). To jest
 *      ADAPTACJA standardowej sondy izolacji tenant-vs-tenant z
 *      rls-isolation.test.ts: tabela NIE jest per-tenant (klucz to `nip`, nie
 *      `tenant_id` — dane rejestru są publiczne z natury), więc oś ochrony to
 *      "nikt poza serwerem panelu nie widzi surowej tabeli", nie "tenant A
 *      vs B". Stąd bespoke test zamiast wpisu do macierzy
 *      `packages/db/test/helpers/seed-tenants.ts` (który i tak by tej tabeli
 *      nie zobaczył — filtruje `table_schema='public'`, `app` jest poza nim,
 *      dokładnie jak `app.user_active_tenant` z 0092).
 *   2. RPC `nip_lookup_cache_get`/`_put` działają dla KAŻDEGO zalogowanego
 *      Z POPRAWNYM SEKRETEM (dane publiczne, nie ma tu czego różnicować per
 *      tenant), odmawiają anonowi, walidują kształt wejścia.
 *   3. LUKA Z RECENZJI PRZED MERGE (0099) — REGRESJA DOWODZĄCA FIX-A:
 *      `nip_lookup_cache_put` BEZ poprawnego `p_write_secret` (brak albo zły)
 *      jest ODRZUCANE (42501), niezależnie od poprawności kształtu danych —
 *      zalogowany user z konsoli przeglądarki NIE MOŻE sam sobie uwiarygodnić
 *      dowolnego NIP-u. Po ADR-276 (0114) skutek tej odmowy jest INNY, ale
 *      obrona ta sama: `create_tenant` dla NIP-u, dla którego istnieje
 *      WYŁĄCZNIE odrzucona próba, zakłada organizację jako NIEZWERYFIKOWANĄ
 *      (`registry_verified_at IS NULL`) i BEZ sfabrykowanych danych — stempel
 *      weryfikacji dalej jest nieosiągalny tą drogą.
 *   4. `create_tenant` z `p_nip`: zła suma kontrolna → 22023 (bez zmian);
 *      suma dobra + cache trafiony PRAWDZIWYM (autoryzowanym sekretem)
 *      zapisem → tenant dostaje nip/regon/legal_name Z CACHE'A i STEMPEL
 *      `registry_verified_at`; suma dobra bez wpisu w cache'u → od ADR-276
 *      organizacja POWSTAJE, ale bez stempla (wariant ręczny — pełne
 *      pokrycie w manual-company-identity.test.ts).
 *   5. WSTECZNA KOMPATYBILNOŚĆ: `p_nip` pominięty → zachowanie DOKŁADNIE jak
 *      przed 0098 (nip/regon/legal_name zostają NULL) — to jest to, na czym
 *      stoi >40 istniejących plików testowych używających create_tenant jako
 *      gołej fabryki tenanta (patrz nagłówek 0098_create_tenant_nip.sql).
 *
 * Wymaga REGISTRY_CACHE_WRITE_SECRET — MUSI być identyczny z sekretem
 * zaszytym w `packages/db/supabase/seed.sql` (lokalnie/CI; prod ma inny,
 * poza repo — patrz OPS w 0099_nip_lookup_cache_write_secret.sql).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { rpcCreateTenant } from "./helpers/create-tenant";
import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = { realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket } };

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
  "REGISTRY_CACHE_WRITE_SECRET",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const PG_INVALID_PARAMETER = "22023";
/** 42501 (insufficient_privilege) — bramka sekretu zapisu (0099), standardowa klasa, PostgREST jej nie maskuje. */
const PG_WRITE_SECRET_DENIED = "42501";

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

const TEST_PASSWORD = "NipLookupCache!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];
const seededNips: string[] = [];

async function createConfirmedUser(admin: SupabaseClient): Promise<{ userId: string; email: string }> {
  const email = `nip-cache-${randomUUID().slice(0, 10)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: TEST_PASSWORD, email_confirm: true });
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

async function signedInUser(admin: SupabaseClient): Promise<SupabaseClient> {
  const user = await createConfirmedUser(admin);
  return signIn(user.email);
}

/** Realny, poprawny NIP (PKN ORLEN) — zweryfikowany na żywo w MF Białej liście. */
const VALID_NIP = "7740001454";
/** Ta sama suma kontrolna błędna — ostatnia cyfra zmieniona. */
const INVALID_CHECKSUM_NIP = "7740001450";
/** Poprawna suma kontrolna, ale ŚWIADOMIE nie wkładamy go do cache — "niezweryfikowany". */
const UNVERIFIED_NIP = "1111111111";
/** Poprawna suma kontrolna, wyłącznie do sondy "atakujący próbuje sfabrykować dane bez sekretu" (0099). */
const ATTACKER_FORGED_NIP = "8121913614";

/**
 * MUSI być identyczny z sekretem zaszytym w packages/db/supabase/seed.sql.
 * Warunkowe na `hasEnv` jak `admin`/`anon`/`sql` niżej — inaczej moduł rzuci
 * przy imporcie w środowisku z jawnym pominięciem (ALLOW_INTEGRATION_SKIP=1),
 * zanim `describe.skipIf` w ogóle dostanie szansę pominąć testy.
 */
const WRITE_SECRET = hasEnv ? env("REGISTRY_CACHE_WRITE_SECRET") : "";

const CACHE_DATA = {
  legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
  regon: "610188201",
  krs: "0000028860",
  address: { street: "CHEMIKÓW 7", zip: "09-411", city: "PŁOCK" },
  statusVat: "Czynny",
  source: "mf",
  fetchedAt: "2026-08-24T10:00:00.000Z",
  requestId: "test-request-id",
};

describe.skipIf(!hasEnv)("app.nip_lookup_cache + weryfikacja NIP w create_tenant (0096-0099, ADR-234)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);
  const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdUserIds.length > 0) {
      const rows = await sql!<{ tenant_id: string }[]>`
        select distinct tenant_id from members where user_id = any(${createdUserIds})
      `;
      for (const row of rows) createdTenantIds.push(row.tenant_id);
    }
    for (const tenantId of new Set(createdTenantIds)) {
      await admin.from("tenants").delete().eq("id", tenantId);
    }
    for (const userId of createdUserIds) {
      await admin.auth.admin.deleteUser(userId).catch(() => {});
    }
    for (const nip of seededNips) {
      await sql!`delete from app.nip_lookup_cache where nip = ${nip}`;
    }
    await sql?.end();
  });

  it("tabela app.nip_lookup_cache jest NIEDOSTĘPNA wprost dla authenticated (zero grantów)", async () => {
    const user = await signedInUser(admin);
    const select = await user.schema("app").from("nip_lookup_cache").select("*");
    expect(select.error).not.toBeNull();

    const insert = await user
      .schema("app")
      .from("nip_lookup_cache")
      .insert({ nip: VALID_NIP, data: CACHE_DATA, source: "mf" });
    expect(insert.error).not.toBeNull();
  });

  it("tabela app.nip_lookup_cache jest NIEDOSTĘPNA wprost dla anon", async () => {
    const select = await anon.schema("app").from("nip_lookup_cache").select("*");
    expect(select.error).not.toBeNull();
  });

  it("nip_lookup_cache_put/_get: zalogowany user może zapisać i odczytać (dane publiczne, bez osi tenanta)", async () => {
    const user = await signedInUser(admin);
    seededNips.push(VALID_NIP);

    const put = await user.schema("app").rpc("nip_lookup_cache_put", {
      p_nip: VALID_NIP,
      p_data: CACHE_DATA,
      p_source: "mf",
      p_request_id: "test-request-id",
      p_write_secret: WRITE_SECRET,
    });
    expect(put.error).toBeNull();

    const get = await user.schema("app").rpc("nip_lookup_cache_get", { p_nip: VALID_NIP });
    expect(get.error).toBeNull();
    expect(get.data).toHaveLength(1);
    expect(get.data[0].data.legalName).toBe(CACHE_DATA.legalName);
    expect(get.data[0].source).toBe("mf");
  });

  it("nip_lookup_cache_put waliduje kształt PO bramce sekretu: NIP nie-10-cyfr, source spoza {mf,gus}, data nie-obiekt", async () => {
    const user = await signedInUser(admin);

    const badNip = await user
      .schema("app")
      .rpc("nip_lookup_cache_put", { p_nip: "123", p_data: CACHE_DATA, p_source: "mf", p_write_secret: WRITE_SECRET });
    expect(badNip.error?.code).toBe(PG_INVALID_PARAMETER);

    const badSource = await user
      .schema("app")
      .rpc("nip_lookup_cache_put", {
        p_nip: VALID_NIP,
        p_data: CACHE_DATA,
        p_source: "wikipedia",
        p_write_secret: WRITE_SECRET,
      });
    expect(badSource.error?.code).toBe(PG_INVALID_PARAMETER);

    const badData = await user.schema("app").rpc("nip_lookup_cache_put", {
      p_nip: VALID_NIP,
      p_data: "not-an-object",
      p_source: "mf",
      p_write_secret: WRITE_SECRET,
    });
    expect(badData.error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("nip_lookup_cache_put/_get: anon dostaje odmowę (brak grantu execute) — nawet z poprawnym sekretem", async () => {
    const put = await anon
      .schema("app")
      .rpc("nip_lookup_cache_put", { p_nip: VALID_NIP, p_data: CACHE_DATA, p_source: "mf", p_write_secret: WRITE_SECRET });
    expect(put.error).not.toBeNull();

    const get = await anon.schema("app").rpc("nip_lookup_cache_get", { p_nip: VALID_NIP });
    expect(get.error).not.toBeNull();
  });

  it("LUKA Z RECENZJI (0099): nip_lookup_cache_put BEZ poprawnego sekretu jest ODRZUCANE (42501), niezależnie od poprawności kształtu danych", async () => {
    const user = await signedInUser(admin);
    seededNips.push(ATTACKER_FORGED_NIP); // defensywnie — próba ma się nie udać, ale sprzątamy na wypadek regresu

    // (a) brak p_write_secret w ogóle — dokładnie to, co robiły WSZYSTKIE
    // wywołania w tym pliku PRZED 0099 (i to, co zrobiłby atakujący z konsoli
    // przeglądarki, nie znając sekretu serwera).
    const noSecret = await user
      .schema("app")
      .rpc("nip_lookup_cache_put", { p_nip: ATTACKER_FORGED_NIP, p_data: CACHE_DATA, p_source: "mf" });
    expect(noSecret.error?.code).toBe(PG_WRITE_SECRET_DENIED);

    // (b) zły sekret — atakujący zgadujący/podający dowolny string.
    const wrongSecret = await user.schema("app").rpc("nip_lookup_cache_put", {
      p_nip: ATTACKER_FORGED_NIP,
      p_data: CACHE_DATA,
      p_source: "mf",
      p_write_secret: "zgadnij-sobie",
    });
    expect(wrongSecret.error?.code).toBe(PG_WRITE_SECRET_DENIED);

    // Kształt danych w OBU próbach był NIENAGANNY (CACHE_DATA) — odmowa jest
    // WYŁĄCZNIE o sekrecie, nie o walidacji, dowodząc że bramka sekretu stoi
    // PRZED walidacją kształtu i żadna z prób nie mogła jej ominąć inną drogą.
    const row = await sql!`select 1 from app.nip_lookup_cache where nip = ${ATTACKER_FORGED_NIP}`;
    expect(row).toHaveLength(0);
  });

  it("LUKA Z RECENZJI (0099) + ADR-276: fabrykacja bez sekretu nie daje STEMPLA weryfikacji — organizacja powstaje, ale jako NIEZWERYFIKOWANA", async () => {
    const user = await signedInUser(admin);

    // Atakujący próbuje sfabrykować dane firmy dla poprawnego (checksum) NIP-u
    // BEZ znajomości sekretu — dokładnie luka znaleziona w recenzji przed
    // merge. Próba MUSI się nie udać (dowiedzione wyżej), więc w cache'u nie
    // ma po niej śladu.
    const forgedAttempt = await user
      .schema("app")
      .rpc("nip_lookup_cache_put", { p_nip: ATTACKER_FORGED_NIP, p_data: CACHE_DATA, p_source: "mf" });
    expect(forgedAttempt.error?.code).toBe(PG_WRITE_SECRET_DENIED);

    // ZMIANA WOBEC ADR-234 (decyzja właściciela 2026-08-26, ADR-276): brak
    // dowodu w cache'u NIE BLOKUJE już zakładania organizacji — blokował
    // realnych klientów (podmiot zwolniony z VAT + brak klucza GUS). Ten
    // przypadek pilnuje więc tego, co ZOSTAŁO obroną: fabrykacja bez sekretu
    // nie daje STEMPLA. Organizacja powstaje, ale `registry_verified_at`
    // jest NULL, a `legal_name` to WYŁĄCZNIE to, co wołający podał wprost —
    // nie sfabrykowana treść z odrzuconego `put` (której w bazie nie ma).
    const slug = `nip-forged-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Sfabrykowany",
      p_nip: ATTACKER_FORGED_NIP,
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, registry_verified_at")
      .eq("slug", slug)
      .single();
    expect(row.data?.nip).toBe(ATTACKER_FORGED_NIP);
    expect(row.data?.registry_verified_at).toBeNull();
    // Kluczowe: dane z ODRZUCONEGO put-a nie przeciekły do tenanta.
    expect(row.data?.legal_name).toBeNull();
    expect(row.data?.regon).toBeNull();
  });

  it("create_tenant z p_nip o złej sumie kontrolnej → 22023, tenant NIE powstaje", async () => {
    const user = await signedInUser(admin);
    const slug = `nip-bad-${randomUUID().slice(0, 8)}`;
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Zła suma",
      p_nip: INVALID_CHECKSUM_NIP,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);

    const check = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    expect(check.data).toBeNull();
  });

  it("ADR-276: create_tenant z p_nip poprawnym, ale BEZ wpisu w cache → tenant POWSTAJE bez stempla (dawniej odmowa 22023)", async () => {
    const user = await signedInUser(admin);
    const slug = `nip-unverif-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Niezweryfikowany",
      p_nip: UNVERIFIED_NIP,
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, registry_verified_at")
      .eq("slug", slug)
      .single();
    expect(row.data?.nip).toBe(UNVERIFIED_NIP);
    expect(row.data?.registry_verified_at).toBeNull();
  });

  it("create_tenant z p_nip zweryfikowanym w cache → tenant dostaje nip/regon/legal_name Z CACHE'A", async () => {
    const user = await signedInUser(admin);
    seededNips.push(VALID_NIP);
    const put = await user.schema("app").rpc("nip_lookup_cache_put", {
      p_nip: VALID_NIP,
      p_data: CACHE_DATA,
      p_source: "mf",
      p_request_id: "test-request-id",
      p_write_secret: WRITE_SECRET,
    });
    expect(put.error).toBeNull();

    const slug = `nip-ok-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Nazwa handlowa (może różnić się od rejestrowej)",
      p_nip: VALID_NIP,
    });
    expect(error).toBeNull();
    expect(tenantId).toBeTruthy();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, name, slug, registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.nip).toBe(VALID_NIP);
    expect(row.data?.regon).toBe(CACHE_DATA.regon);
    expect(row.data?.legal_name).toBe(CACHE_DATA.legalName);
    // ADR-276 (0114): ścieżka rejestrowa STEMPLUJE moment potwierdzenia.
    expect(row.data?.registry_verified_at).not.toBeNull();
    // Nazwa handlowa i slug NIE są nadpisane danymi rejestru (brief SPEC D).
    expect(row.data?.name).toBe("Nazwa handlowa (może różnić się od rejestrowej)");
    expect(row.data?.slug).toBe(slug);
  });

  it("create_tenant BEZ p_nip → zachowanie sprzed 0098, nip/regon/legal_name zostają NULL", async () => {
    const user = await signedInUser(admin);
    const slug = `nip-omitted-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, { p_slug: slug, p_name: "Bez NIP" });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.nip).toBeNull();
    expect(row.data?.regon).toBeNull();
    expect(row.data?.legal_name).toBeNull();
    expect(row.data?.registry_verified_at).toBeNull();
  });
});
