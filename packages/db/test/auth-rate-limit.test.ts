/**
 * Współdzielony rate-limit w Postgresie (L2, migracja 0052, ADR-106).
 *
 * Osie:
 *   1. WSPÓŁDZIELENIE: dwie NIEZALEŻNE instancje modułu
 *      @avably/security/rate-limit (osobne rejestry modułów = osobne mapy
 *      in-memory, jak dwie lambdy) widzą JEDEN licznik — wyczerpanie limitu
 *      w instancji A odcina instancję B. To jest sedno L2: limiter in-memory
 *      ten test obleje z konstrukcji (dowód mutacyjny M2).
 *   2. IZOLACJA TABELI: anon i authenticated nie czytają i nie piszą
 *      public.rate_limit_counters wprost (42501) — jedyna droga to funkcja.
 *   3. FUNKCJA DLA ANONA: app.check_rate_limit działa z kluczem anon przez
 *      PostgREST (limity kryją trasy PRZED zalogowaniem) i waliduje argumenty
 *      (22023), a jej odpowiedź nie niesie nic poza (success, remaining).
 *   4. SPRZĄTANIE: stare okna klucza znikają leniwie przy kolejnym zapisie
 *      (bez pg_cron).
 *
 * Wymaga lokalnego Supabase i SUPABASE_LOCAL_* — inaczej strażnik jawności.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

/** Prefiks unikalny per przebieg — suita nie zjada liczników innych sesji. */
const RUN_PREFIX = `l2t-${randomUUID().slice(0, 8)}`;
const PG_INSUFFICIENT_PRIVILEGE = "42501";
const PG_INVALID_PARAMETER_VALUE = "22023";

type RateLimitModule = typeof import("@avably/security/rate-limit");

/**
 * Świeża instancja modułu limitera = osobny rejestr modułów, czyli osobna
 * mapa in-memory. Dokładnie tak wyglądają dwie lambdy na hostingu
 * bezstanowym: wspólna może być wyłącznie baza.
 */
async function freshLimiterInstance(): Promise<RateLimitModule> {
  vi.resetModules();
  return import("@avably/security/rate-limit");
}

describe.runIf(hasEnv)("rate-limit w Postgresie (0052)", () => {
  let sql: ReturnType<typeof postgres>;

  beforeAll(() => {
    sql = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    // Moduł preferuje NEXT_PUBLIC_* — w tym teście musi widzieć WYŁĄCZNIE
    // lokalny harness, niezależnie od env powłoki dewelopera.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await sql`delete from public.rate_limit_counters where bucket_key like ${RUN_PREFIX + "%"}`;
    await sql.end();
  });

  it("licznik jest współdzielony między instancjami modułu (dwie „lambdy”)", async () => {
    const instanceA = await freshLimiterInstance();
    const instanceB = await freshLimiterInstance();
    const opts = { limit: 3, windowSeconds: 3600, prefix: RUN_PREFIX };
    const key = `shared:${randomUUID().slice(0, 8)}`;

    for (let i = 0; i < 3; i += 1) {
      expect((await instanceA.checkRateLimit(key, opts)).success).toBe(true);
    }

    // Instancja B nigdy nie widziała tego klucza lokalnie — jeśli limiter
    // liczy w pamięci procesu, przepuści (i ten test ma wtedy spłonąć).
    const fromB = await instanceB.checkRateLimit(key, opts);
    expect(fromB.success, "instancja B dostała świeży licznik — limit nie jest współdzielony").toBe(
      false,
    );
    expect(fromB.remaining).toBe(0);
  });

  it("anon nie czyta i nie pisze liczników wprost (PostgREST)", async () => {
    const anon = anonClient();

    const read = await anon.from("rate_limit_counters").select("*").limit(1);
    expect(read.error, "anon odczytał tabelę liczników wprost").not.toBeNull();
    expect(read.error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

    const write = await anon.from("rate_limit_counters").insert({
      bucket_key: `${RUN_PREFIX}:wprost`,
      window_start: new Date().toISOString(),
      count: 0,
    });
    expect(write.error, "anon zapisał licznik wprost").not.toBeNull();
    expect(write.error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  it("authenticated nie czyta i nie pisze liczników wprost (rola surowa)", async () => {
    // SET ROLE zamiast pełnego seedu członka: przywileje tabeli nie zależą od
    // claimów JWT, więc rola wystarcza do dowodu (wzorzec macierzy RLS).
    // Asercja obejmuje CAŁĄ transakcję — postgres.js po błędzie w środku
    // odrzuca cały blok begin() tym samym błędem.
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`select * from public.rate_limit_counters limit 1`;
      }),
    ).rejects.toMatchObject({ code: PG_INSUFFICIENT_PRIVILEGE });
    await expect(
      sql.begin(async (tx) => {
        await tx`set local role authenticated`;
        await tx`insert into public.rate_limit_counters (bucket_key, window_start, count)
                 values (${RUN_PREFIX + ":auth-wprost"}, now(), 0)`;
      }),
    ).rejects.toMatchObject({ code: PG_INSUFFICIENT_PRIVILEGE });
  });

  it("app.check_rate_limit działa dla anona i nie ujawnia nic poza (success, remaining)", async () => {
    const anon = anonClient();
    const { data, error } = await anon.schema("app").rpc("check_rate_limit", {
      p_key: `${RUN_PREFIX}:anon:${randomUUID().slice(0, 8)}`,
      p_limit: 2,
      p_window_seconds: 3600,
    });

    expect(error).toBeNull();
    const rows = data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // Kształt odpowiedzi to całość kontraktu — żadnych cudzych kluczy,
    // liczników ani fragmentów tabeli.
    expect(Object.keys(rows[0]!).sort()).toEqual(["remaining", "success"]);
    expect(rows[0]).toEqual({ success: true, remaining: 1 });
  });

  it("funkcja odrzuca śmieciowe argumenty (22023) — cap na klucz i okno", async () => {
    const anon = anonClient();

    const tooLong = await anon.schema("app").rpc("check_rate_limit", {
      p_key: "x".repeat(129),
      p_limit: 3,
      p_window_seconds: 60,
    });
    expect(tooLong.error?.code).toBe(PG_INVALID_PARAMETER_VALUE);

    const absurdWindow = await anon.schema("app").rpc("check_rate_limit", {
      p_key: `${RUN_PREFIX}:okno`,
      p_limit: 3,
      p_window_seconds: 86_401,
    });
    expect(absurdWindow.error?.code).toBe(PG_INVALID_PARAMETER_VALUE);
  });

  it("stare okna klucza znikają leniwie przy kolejnym zapisie", async () => {
    const key = `${RUN_PREFIX}:sprzatanie`;
    await sql`insert into public.rate_limit_counters (bucket_key, window_start, count)
              values (${key}, now() - interval '2 hours', 5)`;

    const anon = anonClient();
    const { error } = await anon
      .schema("app")
      .rpc("check_rate_limit", { p_key: key, p_limit: 3, p_window_seconds: 60 });
    expect(error).toBeNull();

    const rows = await sql`select count, window_start from public.rate_limit_counters
                           where bucket_key = ${key}`;
    // Został wyłącznie wiersz bieżącego okna ze świeżym licznikiem — stare
    // okno nie czeka na żaden cron.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(1);
  });
});
