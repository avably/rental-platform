import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import {
  cleanupSeeded,
  createAdminClient,
  seedTwoTenants,
  type TenantCtx,
} from "./helpers/seed-tenants";

/**
 * GLOBALNA PIGUŁKA TERMINU WYŁĄCZALNA PRZEZ NAJEMCĘ — flaga
 * tenants.store_term_calendar_enabled + app.get_public_store_flags +
 * app.set_store_term_calendar (0090, ADR-203).
 *
 * ==================== CZEGO PILNUJE TEN PLIK ====================
 *
 *   1. ZERO REGRESU: najemca, który flagi nigdy nie dotknął, ma `true` —
 *      czyli dokładnie zachowanie sprzed 0090 (pigułka widoczna).
 *   2. FLAGA JEST PER NAJEMCA: wyłączenie u A nie zdejmuje pigułki u B.
 *      Bramką jest SAMO ZAPYTANIE odczytu (`t.id = p_tenant_id` w ciele,
 *      SECURITY DEFINER — RLS nie uczestniczy) ORAZ samo zapytanie zapisu
 *      (`id = app.tenant_id()` — cudzy wiersz jest niewyrażalny).
 *   3. JEDYNA DROGA DO FLAGI TO RPC: anon nie ma grantu tabelowego na
 *      `tenants` (odczyt wprost = 42501), a setter nie jest wykonywalny
 *      anonem (revoke w 0090). Kontrola POZYTYWNA stoi obok każdej odmowy —
 *      ta sama operacja właściwą drogą przechodzi.
 *   4. OKNO HANDLOWE: najemca poza oknem znika CAŁY (NULL), nieodróżnialnie
 *      od nieistniejącego — jak w get_tenant_appearance (0079).
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants).
 */
const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;

function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    },
  );
}

/** Flagi powłoki — TĄ SAMĄ drogą, którą czyta je sklep (klient anon). */
async function flags(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_public_store_flags", { p_tenant_id: tenantId });
  if (error) throw new Error(`get_public_store_flags jako anon zawiodło: ${error.message}`);
  return data as Record<string, unknown> | null;
}

/** Zapis flagi — TĄ SAMĄ drogą, którą pisze ją panel (RPC sesją członka). */
async function setFlag(ctx: TenantCtx, enabled: boolean): Promise<{ message: string } | null> {
  const { error } = await ctx.ownerClient
    .schema("app")
    .rpc("set_store_term_calendar", { p_enabled: enabled });
  return error ? { message: error.message } : null;
}

describe.skipIf(!hasEnv)("pigułka terminu wyłączalna przez najemcę (0090, ADR-203)", () => {
  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("ZERO REGRESU: świeży najemca ma flagę true — pigułka widoczna jak przed 0090", async () => {
    expect(await flags(a.tenantId)).toEqual({ term_calendar_enabled: true });
    expect(await flags(b.tenantId)).toEqual({ term_calendar_enabled: true });
  });

  it("IZOLACJA ZAPISU I ODCZYTU: wyłączenie u najemcy A nie zdejmuje pigułki u B", async () => {
    // Asercja nazwana WPROST o izolację (punkt 1 sekcji bezpieczeństwa briefu).
    // Odczyt jest SECURITY DEFINER — RLS nie uczestniczy, bramką jest wyłącznie
    // `t.id = p_tenant_id` w ciele; zapis wybiera wiersz z `app.tenant_id()`,
    // więc cudzy najemca jest niewyrażalny. Obie bramki mierzy ten sam przebieg:
    // zdjęcie KTÓREJKOLWIEK z nich robi z `flags(B)` odpowiedź najemcy A.
    expect(await setFlag(a, false)).toBeNull();

    expect(await flags(a.tenantId), "zapis własnej flagi nie zadziałał").toEqual({
      term_calendar_enabled: false,
    });
    expect(await flags(b.tenantId), "wyłączenie u A zdjęło pigułkę u B").toEqual({
      term_calendar_enabled: true,
    });

    // Powrót w drugą stronę tym samym czasownikiem — i stan wyjściowy dla
    // pozostałych przypadków.
    expect(await setFlag(a, true)).toBeNull();
    expect(await flags(a.tenantId)).toEqual({ term_calendar_enabled: true });
  });

  it("ANON nie zapisze flagi — setter ma revoke, a odmowa nie zmienia stanu", async () => {
    const { error } = await anon
      .schema("app")
      .rpc("set_store_term_calendar", { p_enabled: false });
    expect(error, "anon wykonał setter flagi — revoke z 0090 nie działa").not.toBeNull();

    // Kontrola pozytywna obok odmowy: stan NIE drgnął, a właściwa droga
    // (sesja członka) dalej działa — bez niej odmowa mogłaby znaczyć
    // „funkcji nie ma wcale".
    expect(await flags(a.tenantId)).toEqual({ term_calendar_enabled: true });
    expect(await setFlag(a, true)).toBeNull();
  });

  it("ANON nie czyta tenants wprost — jedyną drogą do flagi jest RPC", async () => {
    // Grant tabelowy na `tenants` dla anon NIE istnieje (0001) i ta migracja
    // tego nie zmienia: wiersz najemcy niesie e-mail rozliczeniowy i status
    // subskrypcji. PostgREST oddaje brak grantu jako błąd (42501).
    const direct = await anon
      .from("tenants")
      .select("store_term_calendar_enabled")
      .eq("id", a.tenantId);
    expect(direct.error, "anon przeczytał public.tenants wprost").not.toBeNull();

    // Kontrola pozytywna W RLS/grantach tej samej klasy: ta sama kolumna,
    // ten sam wiersz, sesja CZŁONKA (own_select) — odczyt przechodzi.
    // Bez niej odmowa wyżej mogłaby znaczyć „kolumny nie ma wcale".
    const member = await a.ownerClient
      .from("tenants")
      .select("store_term_calendar_enabled")
      .eq("id", a.tenantId)
      .maybeSingle();
    expect(member.error).toBeNull();
    expect(member.data).toEqual({ store_term_calendar_enabled: true });
  });

  it("NULL na wejściu settera to odmowa 22023, nie zapis", async () => {
    const { error } = await a.ownerClient
      .schema("app")
      .rpc("set_store_term_calendar", { p_enabled: null });
    expect(error, "setter przyjął NULL — „nie wiadomo czy pigułka” nie jest stanem").not.toBeNull();
    expect(await flags(a.tenantId)).toEqual({ term_calendar_enabled: true });
  });

  it("OKNO HANDLOWE: najemca poza oknem znika cały, razem z flagą", async () => {
    const status = await sql!<{ status: string }[]>`
      select status from public.tenants where id = ${a.tenantId}
    `;
    await sql!`update public.tenants set status = 'cancelled' where id = ${a.tenantId}`;
    try {
      expect(
        await flags(a.tenantId),
        "zamknięty najemca dalej odpowiada flagami powłoki",
      ).toBeNull();
    } finally {
      await sql!`update public.tenants set status = ${status[0]!.status} where id = ${a.tenantId}`;
    }
    expect(await flags(a.tenantId), "przywrócenie statusu nie zadziałało").not.toBeNull();
  });

  it("najemca nieistniejący jest NIEODRÓŻNIALNY od nieaktywnego", async () => {
    expect(await flags("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
