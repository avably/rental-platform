/**
 * WARIANT RĘCZNY DANYCH FIRMOWYCH w `app.create_tenant` (0114, ADR-276).
 *
 * KONTEKST DECYZJI. ADR-234 wymagał dowodu weryfikacji rejestrowej (wiersz
 * w `app.nip_lookup_cache`) do założenia organizacji. Warunek blokował
 * realnych klientów: podatnik ZWOLNIONY z VAT nie figuruje w wykazie MF, a
 * fallback GUS jest na produkcji bez klucza. Właściciel rozstrzygnął
 * (2026-08-26): pozwolić wpisać dane RĘCZNIE, tymczasowo, ze ZNACZNIKIEM
 * `tenants.registry_verified_at`.
 *
 * TEN PLIK DOWODZI CZTERECH OSI:
 *
 *   1. DWA WARIANTY. Cache trafiony → dane Z CACHE'A + stempel
 *      `registry_verified_at`. Cache pusty → dane z parametrów wołającego,
 *      stempel NULL, a organizacja jest w pełni sprawna (członkostwo ownera,
 *      aktywna preferencja, subdomena — czyli wszystko, co 0114 miało
 *      zachować z 0092/0022).
 *   2. STEMPLA NIE DA SIĘ WSTRZYKNĄĆ. Trzy niezależne drogi, wszystkie
 *      zamknięte: parametr RPC nie istnieje; `PATCH /tenants` odbija się od
 *      braku polityki UPDATE dla `authenticated`; przy TRAFIONYM cache'u
 *      `p_legal_name`/`p_regon` są IGNOROWANE, więc nie da się skleić
 *      stempla z własną nazwą firmy.
 *   3. WARIANT RĘCZNY NIE OSŁABIA ŻADNEGO ZASTANEGO LIMITU NADUŻYĆ. Suma
 *      kontrolna NIP, slugi zarezerwowane, unikat sluga i limit 2 organizacji
 *      na użytkownika działają w wariancie ręcznym CO DO ZNAKU tak samo, jak
 *      w rejestrowym.
 *   4. KSZTAŁT DANYCH RĘCZNYCH jest walidowany W BAZIE (nie tylko w Zodzie
 *      panelu): za długa nazwa i REGON spoza 9/14 cyfr → 22023, dane firmowe
 *      bez NIP-u → 22023.
 *
 * Wymaga REGISTRY_CACHE_WRITE_SECRET (jak nip-lookup-cache.test.ts) —
 * ścieżka rejestrowa musi zasiać cache autoryzowanym zapisem.
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

/** 22023 (invalid_parameter_value) — klasa walidacji `app.create_tenant`. */
const PG_INVALID_PARAMETER = "22023";
/** 23505 — unikat sluga (indeks na tenants.slug), niezmieniony przez 0114. */
const PG_UNIQUE_VIOLATION = "23505";
/** PGRST202 — PostgREST nie zna funkcji o TAKIM zestawie nazwanych argumentów. */
const PGRST_NO_SUCH_FUNCTION = "PGRST202";

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

const TEST_PASSWORD = "ManualCompanyIdentity!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];
const seededNips: string[] = [];

async function createConfirmedUser(admin: SupabaseClient): Promise<{ userId: string; email: string }> {
  const email = `manual-id-${randomUUID().slice(0, 10)}@test.local`;
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

/**
 * NIP-y o POPRAWNEJ sumie kontrolnej, ŚWIADOMIE nieobecne w cache'u — to jest
 * dokładnie sytuacja podmiotu zwolnionego z VAT (MF go nie zna, GUS bez
 * klucza nie odpowie). Każdy przypadek bierze własny, żeby zasiew jednego nie
 * zmieniał wyniku drugiego.
 */
const MANUAL_NIPS = {
  happy: "8888888888",
  abuse: "2222222222",
  limit: "3333333333",
  reserved: "4444444444",
  shape: "5555555555",
  slugTaken: "6666666666",
} as const;
/** Realny NIP (PKN ORLEN) — ścieżka REJESTROWA, zasiewana do cache'a sekretem. */
const REGISTRY_NIP = "7740001454";
/** Ta sama suma kontrolna błędna — ostatnia cyfra zmieniona. */
const INVALID_CHECKSUM_NIP = "7740001450";

const WRITE_SECRET = hasEnv ? env("REGISTRY_CACHE_WRITE_SECRET") : "";

const CACHE_DATA = {
  legalName: "POLSKI KONCERN NAFTOWY ORLEN SPÓŁKA AKCYJNA",
  regon: "610188201",
  krs: "0000028860",
  address: { street: "CHEMIKÓW 7", zip: "09-411", city: "PŁOCK" },
  statusVat: "Czynny",
  source: "mf",
  fetchedAt: "2026-08-26T10:00:00.000Z",
  requestId: "manual-identity-test",
};

describe.skipIf(!hasEnv)("app.create_tenant — dane firmowe ręczne vs rejestrowe (0114, ADR-276)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
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

  async function seedRegistryCache(user: SupabaseClient): Promise<void> {
    seededNips.push(REGISTRY_NIP);
    const put = await user.schema("app").rpc("nip_lookup_cache_put", {
      p_nip: REGISTRY_NIP,
      p_data: CACHE_DATA,
      p_source: "mf",
      p_request_id: CACHE_DATA.requestId,
      p_write_secret: WRITE_SECRET,
    });
    expect(put.error).toBeNull();
  }

  // ── OŚ 1: dwa warianty ────────────────────────────────────────────────

  it("WARIANT RĘCZNY: brak wpisu w cache → tenant z danymi Z PARAMETRÓW i BEZ stempla, a organizacja jest sprawna", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-ok-${randomUUID().slice(0, 8)}`;

    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Wypożyczalnia nad jeziorem",
      p_nip: MANUAL_NIPS.happy,
      p_legal_name: "JAN KOWALSKI USŁUGI WYPOŻYCZANIA",
      p_regon: "123456785",
    });
    expect(error).toBeNull();
    expect(tenantId).toBeTruthy();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, name, registry_verified_at, trial_ends_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.nip).toBe(MANUAL_NIPS.happy);
    expect(row.data?.legal_name).toBe("JAN KOWALSKI USŁUGI WYPOŻYCZANIA");
    expect(row.data?.regon).toBe("123456785");
    // ZNACZNIK — cała treść decyzji ADR-276 w jednym polu.
    expect(row.data?.registry_verified_at).toBeNull();
    // Nazwa HANDLOWA zostaje tym, co podał operator (kontrakt sprzed 0114).
    expect(row.data?.name).toBe("Wypożyczalnia nad jeziorem");
    // Trial startuje jak zawsze (0066) — wariant ręczny nie jest gorszym kontem.
    expect(row.data?.trial_ends_at).toBeTruthy();

    // ORGANIZACJA JEST SPRAWNA, nie tylko „wiersz powstał": członkostwo
    // ownera (0003), aktywna preferencja (0092) i subdomena (0022) —
    // wszystkie trzy z TEJ SAMEJ transakcji, którą 0114 przepisało w całości.
    const member = await admin
      .from("members")
      .select("role")
      .eq("tenant_id", tenantId as string)
      .single();
    expect(member.data?.role).toBe("owner");

    const domain = await admin
      .from("domains")
      .select("domain, kind, verified")
      .eq("tenant_id", tenantId as string)
      .single();
    expect(domain.data?.domain).toBe(`${slug}.avably.io`);
    expect(domain.data?.verified).toBe(true);

    const active = await sql!<{ tenant_id: string }[]>`
      select tenant_id from app.user_active_tenant where tenant_id = ${tenantId as string}
    `;
    expect(active).toHaveLength(1);
  });

  it("WARIANT RĘCZNY bez nazwy rejestrowej: NULL przechodzi (kolumny zostają puste, stempla dalej brak)", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-nonames-${randomUUID().slice(0, 8)}`;

    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Bez nazwy rejestrowej",
      p_nip: MANUAL_NIPS.happy,
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.nip).toBe(MANUAL_NIPS.happy);
    expect(row.data?.legal_name).toBeNull();
    expect(row.data?.regon).toBeNull();
    expect(row.data?.registry_verified_at).toBeNull();
  });

  it("WARIANT REJESTROWY: wpis w cache → dane Z CACHE'A + STEMPEL registry_verified_at", async () => {
    const user = await signedInUser(admin);
    await seedRegistryCache(user);

    const slug = `registry-ok-${randomUUID().slice(0, 8)}`;
    const before = new Date();
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Marka handlowa",
      p_nip: REGISTRY_NIP,
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("nip, regon, legal_name, registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.legal_name).toBe(CACHE_DATA.legalName);
    expect(row.data?.regon).toBe(CACHE_DATA.regon);
    expect(row.data?.registry_verified_at).not.toBeNull();
    // Stempel jest ŚWIEŻY (moment tej weryfikacji), nie przepisaną datą
    // z cache'a — `fetchedAt` w CACHE_DATA celowo jest inny.
    const stamp = new Date(row.data!.registry_verified_at as string).getTime();
    expect(stamp).toBeGreaterThanOrEqual(before.getTime() - 5_000);
    expect(new Date(CACHE_DATA.fetchedAt).getTime()).not.toBe(stamp);
  });

  // ── OŚ 2: stempla nie da się wstrzyknąć ───────────────────────────────

  it("SONDA: create_tenant NIE PRZYJMUJE parametru registry_verified_at (PostgREST: nie ma takiej funkcji)", async () => {
    const user = await signedInUser(admin);
    const slug = `stamp-param-${randomUUID().slice(0, 8)}`;

    const { data, error } = await user.schema("app").rpc("create_tenant", {
      p_slug: slug,
      p_name: "Próba wstrzyknięcia stempla",
      p_nip: MANUAL_NIPS.abuse,
      p_legal_name: "FIRMA Z PALCA",
      // Parametr NIE ISTNIEJE — i to jest cała obrona. Nie ma czego
      // walidować, bo nie ma czego przyjąć.
      p_registry_verified_at: new Date().toISOString(),
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PGRST_NO_SUCH_FUNCTION);

    const check = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    expect(check.data).toBeNull();
  });

  it("SONDA: owner NIE PODNIESIE stempla przez PATCH /tenants (brak polityki UPDATE dla authenticated)", async () => {
    const user = await signedInUser(admin);
    const slug = `stamp-patch-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Ręczna",
      p_nip: MANUAL_NIPS.abuse,
      p_legal_name: "FIRMA RĘCZNA",
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    // JWT dostaje claim tenant_id dopiero przy wystawieniu tokenu — bez
    // odświeżenia sesji RLS nie zobaczyłoby nawet własnego wiersza i test
    // przechodziłby z NIEWŁAŚCIWEGO powodu.
    await user.auth.refreshSession();

    const patch = await user
      .from("tenants")
      .update({ registry_verified_at: new Date().toISOString() })
      .eq("id", tenantId as string)
      .select("id");
    // RLS bez polityki UPDATE: albo błąd, albo ZERO zmienionych wierszy —
    // sprawdzamy SKUTEK w bazie, nie kształt odpowiedzi.
    expect(patch.error !== null || (patch.data ?? []).length === 0).toBe(true);

    const row = await admin
      .from("tenants")
      .select("registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.registry_verified_at).toBeNull();
  });

  it("SONDA: przy TRAFIONYM cache'u p_legal_name/p_regon są IGNOROWANE — nie da się skleić stempla z własną nazwą", async () => {
    const user = await signedInUser(admin);
    await seedRegistryCache(user);

    const slug = `registry-override-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Marka",
      p_nip: REGISTRY_NIP,
      p_legal_name: "FIRMA PODSTAWIONA SP. Z O.O.",
      p_regon: "999999999",
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("legal_name, regon, registry_verified_at")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.legal_name).toBe(CACHE_DATA.legalName);
    expect(row.data?.regon).toBe(CACHE_DATA.regon);
    expect(row.data?.legal_name).not.toBe("FIRMA PODSTAWIONA SP. Z O.O.");
    expect(row.data?.registry_verified_at).not.toBeNull();
  });

  // ── OŚ 3: limity nadużyć bez zmian w wariancie ręcznym ────────────────

  it("LIMITY: zła suma kontrolna NIP dalej odrzucana (22023), tenant NIE powstaje — nawet z danymi ręcznymi", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-badnip-${randomUUID().slice(0, 8)}`;
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Zła suma",
      p_nip: INVALID_CHECKSUM_NIP,
      p_legal_name: "COKOLWIEK SP. Z O.O.",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);

    const check = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    expect(check.data).toBeNull();
  });

  it("LIMITY: slug ZAREZERWOWANY dalej odrzucany (22023) w wariancie ręcznym", async () => {
    const user = await signedInUser(admin);
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: "admin",
      p_name: "Rezerwacja",
      p_nip: MANUAL_NIPS.reserved,
      p_legal_name: "FIRMA RĘCZNA",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("LIMITY: unikat sluga dalej broni (23505) w wariancie ręcznym", async () => {
    const first = await signedInUser(admin);
    const slug = `manual-dup-${randomUUID().slice(0, 8)}`;
    const created = await rpcCreateTenant(first, {
      p_slug: slug,
      p_name: "Pierwsza",
      p_nip: MANUAL_NIPS.slugTaken,
      p_legal_name: "PIERWSZA SP. Z O.O.",
    });
    expect(created.error).toBeNull();
    createdTenantIds.push(created.data as string);

    const second = await signedInUser(admin);
    const collision = await rpcCreateTenant(second, {
      p_slug: slug,
      p_name: "Druga",
      p_nip: MANUAL_NIPS.slugTaken,
      p_legal_name: "DRUGA SP. Z O.O.",
    });
    expect(collision.data).toBeNull();
    expect(collision.error?.code).toBe(PG_UNIQUE_VIOLATION);
  });

  it("LIMITY: limit 2 organizacji na użytkownika dalej broni w wariancie ręcznym", async () => {
    const user = await signedInUser(admin);
    const {
      data: { user: authUser },
    } = await user.auth.getUser();

    for (const nth of ["a", "b"]) {
      const created = await rpcCreateTenant(user, {
        p_slug: `manual-limit-${nth}-${randomUUID().slice(0, 8)}`,
        p_name: `Organizacja ${nth}`,
        p_nip: MANUAL_NIPS.limit,
        p_legal_name: "FIRMA RĘCZNA",
      });
      expect(created.error).toBeNull();
      createdTenantIds.push(created.data as string);
    }

    const third = await rpcCreateTenant(user, {
      p_slug: `manual-limit-c-${randomUUID().slice(0, 8)}`,
      p_name: "Organizacja trzecia",
      p_nip: MANUAL_NIPS.limit,
      p_legal_name: "FIRMA RĘCZNA",
    });
    expect(third.data).toBeNull();
    expect(third.error).not.toBeNull();

    // ASERCJA NA SKUTKU, NIE NA KODZIE. `P0002` jest własnym SQLSTATE spoza
    // P0001, a PostgREST maskuje takie kody jako HTTP 500 bez `code` i bez
    // treści (własność stosu opisana w 0098_create_tenant_nip.sql, zastana —
    // dotyczy też P0002/P0003 w produkcyjnym createTenantAction). Sprawdzanie
    // `error.code === "P0002"` dałoby test zielony z niewłaściwego powodu albo
    // czerwony bez związku z tą migracją; liczba organizacji użytkownika jest
    // faktem, którego maskowanie nie dotyczy.
    const memberships = await sql!<{ count: string }[]>`
      select count(distinct tenant_id)::text as count from members where user_id = ${authUser!.id}
    `;
    expect(memberships[0]!.count).toBe("2");
  });

  // ── OŚ 4: kształt danych ręcznych walidowany w BAZIE ──────────────────

  it("KSZTAŁT: REGON spoza 9/14 cyfr → 22023, tenant NIE powstaje", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-regon-${randomUUID().slice(0, 8)}`;
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Zły REGON",
      p_nip: MANUAL_NIPS.shape,
      p_legal_name: "FIRMA RĘCZNA",
      p_regon: "12345",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);

    const check = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    expect(check.data).toBeNull();
  });

  it("KSZTAŁT: REGON 14-cyfrowy (jednostka lokalna GUS) przechodzi", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-regon14-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Jednostka lokalna",
      p_nip: MANUAL_NIPS.shape,
      p_legal_name: "FIRMA RĘCZNA",
      p_regon: "12345678512345",
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin.from("tenants").select("regon").eq("id", tenantId as string).single();
    expect(row.data?.regon).toBe("12345678512345");
  });

  it("KSZTAŁT: nazwa rejestrowa dłuższa niż 200 znaków → 22023", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-longname-${randomUUID().slice(0, 8)}`;
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Za długa nazwa rejestrowa",
      p_nip: MANUAL_NIPS.shape,
      p_legal_name: "X".repeat(201),
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("KSZTAŁT: dane firmowe BEZ p_nip → 22023 (odmowa, nie ciche zignorowanie)", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-nonip-${randomUUID().slice(0, 8)}`;
    const { data, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Dane bez NIP-u",
      p_legal_name: "FIRMA BEZ NIP-U",
    });
    expect(data).toBeNull();
    expect(error?.code).toBe(PG_INVALID_PARAMETER);

    const check = await admin.from("tenants").select("id").eq("slug", slug).maybeSingle();
    expect(check.data).toBeNull();
  });

  it("KSZTAŁT: puste stringi w danych ręcznych lądują jako NULL, nie jako ''", async () => {
    const user = await signedInUser(admin);
    const slug = `manual-empty-${randomUUID().slice(0, 8)}`;
    const { data: tenantId, error } = await rpcCreateTenant(user, {
      p_slug: slug,
      p_name: "Puste pola",
      p_nip: MANUAL_NIPS.shape,
      p_legal_name: "   ",
      p_regon: "",
    });
    expect(error).toBeNull();
    createdTenantIds.push(tenantId as string);

    const row = await admin
      .from("tenants")
      .select("legal_name, regon")
      .eq("id", tenantId as string)
      .single();
    expect(row.data?.legal_name).toBeNull();
    expect(row.data?.regon).toBeNull();
  });
});
