/**
 * ULUBIONE nawigacji — izolacja per użytkownik i strażnik zapisu (ADR-232,
 * migracja 0094_nav_favorites.sql):
 * packages/db/supabase/migrations/0094_nav_favorites.sql.
 *
 * Tabela `app.user_nav_favorites` jest PER-UŻYTKOWNIK (klucz `user_id`), więc
 * stoi POZA macierzą izolacji tenantów (rls-isolation.test.ts skanuje wyłącznie
 * `table_schema = 'public'`). Izolację UŻYTKOWNIKA A↔B trzeba więc udowodnić
 * WPROST — i tak, żeby dowód PADAŁ po rozszczelnieniu polityki SELECT.
 *
 * OŚ IZOLACJI (data-adjacent): user A NIE widzi wiersza B (RLS SELECT po
 * `user_id = auth.uid()`); `set_nav_favorites` zapisuje TYLKO wiersz wołającego
 * (user z `auth.uid()`, nie z argumentu — cudzego user_id nie da się podać);
 * anon → odmowa; nie-tablica / za długie → 22023.
 *
 * Wymaga uruchomionego lokalnego Supabase (`supabase start` z packages/db) i
 * tych samych zmiennych co auth-hook/rls-isolation (patrz integration-env).
 */
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

const TEST_PASSWORD = "NavFavoritesTest!12345678";
const createdUserIds: string[] = [];

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

async function createConfirmedUser(admin: SupabaseClient, label: string): Promise<string> {
  const email = `navfav-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}) failed: ${error?.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function emailForUser(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new Error(`getUserById failed: ${error?.message}`);
  return data.user.email;
}

async function signIn(email: string): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return client;
}

/** Seed wiersza ulubionych service-rolem (omija RPC — kontrolujemy dane wprost). */
async function seedFavorites(
  admin: SupabaseClient,
  userId: string,
  favorites: string[],
): Promise<void> {
  const { error } = await admin
    .schema("app")
    .from("user_nav_favorites")
    .upsert({ user_id: userId, favorites }, { onConflict: "user_id" });
  if (error) throw new Error(`seedFavorites failed: ${error.message}`);
}

describe.skipIf(!hasEnv)("ulubione nawigacji — izolacja per użytkownik (0094, ADR-232)", () => {
  const admin = hasEnv ? createAdminClient() : (null as unknown as SupabaseClient);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
    createdUserIds.length = 0;
  });

  it("OŚ IZOLACJI: user A widzi WYŁĄCZNIE swój wiersz — nie wiersz B (RLS SELECT po auth.uid())", async () => {
    const userA = await createConfirmedUser(admin, "iso-a");
    const userB = await createConfirmedUser(admin, "iso-b");
    await seedFavorites(admin, userA, ["orders", "catalog"]);
    await seedFavorites(admin, userB, ["payments", "security"]);

    const clientA = await signIn(await emailForUser(admin, userA));
    const { data, error } = await clientA
      .schema("app")
      .from("user_nav_favorites")
      .select("user_id, favorites");
    expect(error, `SELECT ulubionych A powinien się powieść: ${error?.message}`).toBeNull();

    const rows = data ?? [];
    // Podłoga liczności: dokładnie JEDEN wiersz — własny. Po rozszczelnieniu
    // polityki SELECT (usunięcie `user_id = auth.uid()` / dodanie `or true`)
    // A zobaczyłby też wiersz B i ta asercja PADA (dowód mutacyjny).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(userA);
    expect(rows[0]?.favorites).toEqual(["orders", "catalog"]);
    // Wiersz B jest NIEWIDOCZNY dla A — twardy niezmiennik osi izolacji.
    expect(rows.some((row) => row.user_id === userB)).toBe(false);
  });

  it("set_nav_favorites zapisuje TYLKO własny wiersz wołającego (nie da się podać cudzego user_id)", async () => {
    const userA = await createConfirmedUser(admin, "write-a");
    const userB = await createConfirmedUser(admin, "write-b");
    await seedFavorites(admin, userB, ["payments"]);

    const clientA = await signIn(await emailForUser(admin, userA));
    const { error } = await clientA
      .schema("app")
      .rpc("set_nav_favorites", { p_favorites: ["orders", "customers"] });
    expect(error, `set_nav_favorites(A) powinno się powieść: ${error?.message}`).toBeNull();

    // Wiersz A powstał z auth.uid() wołającego — RPC nie przyjmuje user_id,
    // więc „zapisz cudze ulubione" jest niewyrażalne.
    const { data: rowA } = await admin
      .schema("app")
      .from("user_nav_favorites")
      .select("favorites")
      .eq("user_id", userA)
      .maybeSingle();
    expect(rowA?.favorites).toEqual(["orders", "customers"]);

    // Wiersz B NIETKNIĘTY zapisem A.
    const { data: rowB } = await admin
      .schema("app")
      .from("user_nav_favorites")
      .select("favorites")
      .eq("user_id", userB)
      .maybeSingle();
    expect(rowB?.favorites).toEqual(["payments"]);
  });

  it("round-trip: po zapisie A odczytuje własną listę w zapisanej kolejności", async () => {
    const userA = await createConfirmedUser(admin, "round");
    const clientA = await signIn(await emailForUser(admin, userA));

    const list = ["security", "orders", "catalog"];
    const { error: writeError } = await clientA
      .schema("app")
      .rpc("set_nav_favorites", { p_favorites: list });
    expect(writeError, `zapis: ${writeError?.message}`).toBeNull();

    const { data } = await clientA
      .schema("app")
      .from("user_nav_favorites")
      .select("favorites")
      .maybeSingle();
    // Kolejność zachowana co do znaku (tablica UPORZĄDKOWANA = kolejność paska).
    expect(data?.favorites).toEqual(list);
  });

  it("anon: set_nav_favorites ODMAWIA (brak auth.uid() → 42501)", async () => {
    const anon = createAnonClient();
    const { data, error } = await anon
      .schema("app")
      .rpc("set_nav_favorites", { p_favorites: ["orders"] });
    expect(error, "anon nie ma prawa zapisać ulubionych").not.toBeNull();
    expect(data).toBeNull();
  });

  it("walidacja: nie-tablica → 22023", async () => {
    const userA = await createConfirmedUser(admin, "valid-shape");
    const clientA = await signIn(await emailForUser(admin, userA));
    const { error } = await clientA
      .schema("app")
      .rpc("set_nav_favorites", { p_favorites: { not: "an array" } });
    expect(error, "obiekt zamiast tablicy musi zostać odrzucony").not.toBeNull();
    expect(error?.code).toBe("22023");
  });

  it("walidacja: lista przekraczająca rozmiar → 22023", async () => {
    const userA = await createConfirmedUser(admin, "valid-size");
    const clientA = await signIn(await emailForUser(admin, userA));
    // > 2048 znaków JSON — jawnie ponad granicę CHECK/RPC.
    const huge = Array.from({ length: 200 }, (_, index) => `bardzo-dluga-pozycja-${index}`);
    const { error } = await clientA
      .schema("app")
      .rpc("set_nav_favorites", { p_favorites: huge });
    expect(error, "za duża lista musi zostać odrzucona").not.toBeNull();
    expect(error?.code).toBe("22023");
  });
});
