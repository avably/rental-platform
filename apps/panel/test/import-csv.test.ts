/**
 * Import katalogu z CSV na ŻYWYM lokalnym Supabase (C3, ADR-112) — sondy
 * bezpieczeństwa i izolacji z briefu:
 *
 *  1. CROSS-TENANT PRZEZ IDENTYFIKATOR: plik z product_id najemcy B wgrany
 *     w kontekście najemcy A → odmowa i ZERO zapisu u obu (stan katalogu B
 *     porównany przed/po). Tarcza dowodu M1: warstwa planu sprawdza
 *     istnienie id JAWNYM filtrem `.eq("tenant_id", …)` — test z klientem
 *     SERVICE-ROLE pali się dokładnie wtedy, gdy ten filtr zniknie
 *     (service-role widzi produkty B, więc tylko filtr planu je odsiewa);
 *     drugą warstwę (odmowę samej funkcji SQL) dowodzi packages/db.
 *  2. CROSS-TENANT PRZEZ PODRZUCONE POLE: kolumna `tenant_id` doklejona do
 *     pliku niczego nie zmienia — produkt ląduje u najemcy z SESJI, u nikogo
 *     innego (tarcza M2).
 *  3. ANON: klient bez sesji dostaje odmowę z bazy (42501) zanim cokolwiek
 *     zostanie zapisane; odmowę 401 PRZED czytaniem pliku na warstwie akcji
 *     dowodzi import-actions.test.ts.
 *  4. GRANICE RÓL: import dziedziczy ISTNIEJĄCĄ bramkę edycji katalogu
 *     (zapis products/pricing_tiers dla każdego członka, 0007) — pin przez
 *     WYKONANIE tej bramki, nie przez powtórzoną listę ról: ten sam staff,
 *     który może dodać produkt wprost przez PostgREST, może też importować
 *     (tarcza M3: zaostrzenie bramki w imporcie bez zmiany bramki katalogu
 *     rozjedzie te dwa wyniki).
 *  5. WSTRZYKNIĘCIE: wartości `=HYPERLINK`, `@SUM`, średniki, cudzysłowy
 *     i nowe linie przechodzą jako TEKST — round-trip eksport → import →
 *     eksport jest BAJT W BAJT identyczny, a w bazie nie przybywa apostrofów.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { exportCatalogCsv } from "@/lib/export/catalog";
import { CATALOG_CSV_HEADER } from "@/lib/export/catalog";
import type { ExportContext } from "@/lib/export/common";
import { planCatalogImport, runCatalogImport } from "@/lib/import/import-catalog";

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

const TEST_PASSWORD = "ImportTest!12345678";
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Brak zmiennej środowiskowej ${name}`);
  return value;
}

function client(key: string): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const anonClient = () => client(env("SUPABASE_LOCAL_ANON_KEY"));
const adminClient = () => client(env("SUPABASE_LOCAL_SERVICE_ROLE_KEY"));

async function signIn(email: string): Promise<SupabaseClient> {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return c;
}

/** User + własna organizacja + świeża sesja (wzorzec export-csv.test.ts). */
async function createTenantOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `imp-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await bootstrap
    .schema("app")
    .rpc("create_tenant", {
      p_slug: `imp-${label}-${randomUUID()}`.slice(0, 39),
      p_name: `Organizacja importu ${label}`,
    });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);
  return { client: await signIn(email), tenantId: tenantId as string };
}

/** Staff w ISTNIEJĄCYM tenancie (wzorzec export-csv.test.ts). */
async function createStaffMember(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SupabaseClient> {
  const email = `imp-staff-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(staff): ${error?.message}`);
  createdUserIds.push(data.user.id);
  const { error: memberError } = await admin
    .from("members")
    .insert({ tenant_id: tenantId, user_id: data.user.id, role: "staff" });
  if (memberError) throw new Error(`insert members(staff): ${memberError.message}`);
  await admin.auth.admin.updateUserById(data.user.id, {
    app_metadata: { tenant_id: tenantId, role: "staff" },
  });
  return signIn(email);
}

const ctxOf = (
  supabase: SupabaseClient,
  tenantId: string,
  role: "owner" | "staff" | null,
): ExportContext => ({ supabase, tenantId, role });

const HEADER = CATALOG_CSV_HEADER.join(";");

function newProductLine(name: string): string {
  return `;${name};;10000;5000;1.0;1;1;true;;;;`;
}

interface CatalogSnapshot {
  products: Record<string, unknown>[];
  tiers: Record<string, unknown>[];
}

async function snapshotCatalog(admin: SupabaseClient, tenantId: string): Promise<CatalogSnapshot> {
  const { data: products, error: pErr } = await admin
    .from("products")
    .select("id, name, base_price_day_grosze, deposit_grosze, active")
    .eq("tenant_id", tenantId)
    .order("id");
  if (pErr) throw new Error(`snapshot products: ${pErr.message}`);
  const { data: tiers, error: tErr } = await admin
    .from("pricing_tiers")
    .select("product_id, tier_days, multiplier")
    .eq("tenant_id", tenantId)
    .order("product_id")
    .order("tier_days");
  if (tErr) throw new Error(`snapshot tiers: ${tErr.message}`);
  return { products: products ?? [], tiers: tiers ?? [] };
}

describe.skipIf(!hasEnv)("import katalogu CSV na żywej bazie (C3, ADR-112)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let staffAClient: SupabaseClient;
  let productB: string;

  beforeAll(async () => {
    admin = adminClient();
    tenantA = await createTenantOwner(admin, "a");
    tenantB = await createTenantOwner(admin, "b");
    staffAClient = await createStaffMember(admin, tenantA.tenantId);

    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantB.tenantId,
        name: "Produkt B — nie dotykać",
        base_price_day_grosze: 7_000,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed produkt B: ${error?.message}`);
    productB = data.id as string;
  }, 120_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("happy path: nowy produkt + aktualizacja + wymiana progów przez plik w formacie eksportu", async () => {
    const ctx = ctxOf(tenantA.client, tenantA.tenantId, "owner");
    const { data: seeded, error: seedErr } = await admin
      .from("products")
      .insert({ tenant_id: tenantA.tenantId, name: "Do podmiany", base_price_day_grosze: 1_000 })
      .select("id")
      .single();
    if (seedErr || !seeded) throw new Error(`seed: ${seedErr?.message}`);

    const csv = [
      HEADER,
      `${seeded.id};Po imporcie;Opis po imporcie;20000;0;1.5;0;2;false;3;2,8;;0`,
      `${seeded.id};Po imporcie;Opis po imporcie;20000;0;1.5;0;2;false;7;6.5;Tydzień;1`,
      newProductLine("Nowy z pliku"),
    ].join("\r\n");

    const result = await runCatalogImport(ctx, csv);
    expect(result.issues).toEqual([]);
    expect(result.result).toEqual({ created: 1, updated: 1, tiers: 2 });

    const { data: updated } = await admin
      .from("products")
      .select("name, description, base_price_day_grosze, active, auto_increment_multiplier")
      .eq("id", seeded.id)
      .single();
    expect(updated).toEqual({
      name: "Po imporcie",
      description: "Opis po imporcie",
      base_price_day_grosze: 20_000,
      active: false,
      auto_increment_multiplier: 1.5,
    });
    const { data: tiers } = await admin
      .from("pricing_tiers")
      .select("tier_days, multiplier, label, sort_order")
      .eq("product_id", seeded.id)
      .order("tier_days");
    expect(tiers).toEqual([
      { tier_days: 3, multiplier: 2.8, label: null, sort_order: 0 },
      { tier_days: 7, multiplier: 6.5, label: "Tydzień", sort_order: 1 },
    ]);
  });

  it("SONDA 1 — cross-tenant przez identyfikator: product_id najemcy B w pliku najemcy A → odmowa, ZERO zapisu u obu", async () => {
    const ctx = ctxOf(tenantA.client, tenantA.tenantId, "owner");
    const beforeA = await snapshotCatalog(admin, tenantA.tenantId);
    const beforeB = await snapshotCatalog(admin, tenantB.tenantId);

    const csv = [HEADER, `${productB};Przejęty produkt B;;10000;0;1.0;1;1;true;;;;`].join("\r\n");
    const result = await runCatalogImport(ctx, csv);

    expect(result.result).toBeUndefined();
    expect(result.issues).toEqual([
      { row: 2, code: "unknownProduct", column: "product_id", value: productB },
    ]);
    expect(await snapshotCatalog(admin, tenantA.tenantId)).toEqual(beforeA);
    expect(await snapshotCatalog(admin, tenantB.tenantId)).toEqual(beforeB);
  });

  it("SONDA 1b (tarcza M1) — plan z klientem SERVICE-ROLE: cudzy id odsiewa JAWNY filtr tenanta, nie RLS", async () => {
    // Service-role widzi produkty WSZYSTKICH — jeżeli plan mimo to zgłasza
    // cudzy id jako nieznany, to zasługa wyłącznie `.eq("tenant_id", …)`
    // w zapytaniu planu. Zdjęcie filtra pali dokładnie tę asercję.
    const ctx = ctxOf(admin, tenantA.tenantId, "owner");
    const csv = [HEADER, `${productB};Cudzy;;10000;0;1.0;1;1;true;;;;`].join("\r\n");
    const plan = await planCatalogImport(ctx, csv);
    expect(plan.issues).toEqual([
      { row: 2, code: "unknownProduct", column: "product_id", value: productB },
    ]);
  });

  it("SONDA 2 — podrzucona kolumna tenant_id niczego nie zmienia: produkt ląduje u najemcy z SESJI", async () => {
    const ctx = ctxOf(tenantA.client, tenantA.tenantId, "owner");
    const name = `Z podrzuconym tenant_id ${randomUUID().slice(0, 8)}`;
    const csv = [
      `${HEADER};tenant_id`,
      `${newProductLine(name)};${tenantB.tenantId}`,
    ].join("\r\n");

    const result = await runCatalogImport(ctx, csv);
    expect(result.issues).toEqual([]);
    expect(result.result).toEqual({ created: 1, updated: 0, tiers: 0 });

    // Produkt jest u A…
    const { data: atA } = await admin
      .from("products")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .eq("name", name);
    expect(atA).toHaveLength(1);
    // …a u B (i nigdzie indziej) go nie ma.
    const { data: everywhere } = await admin.from("products").select("tenant_id").eq("name", name);
    expect(everywhere).toEqual([{ tenant_id: tenantA.tenantId }]);
  });

  it("SONDA 3 — anon: odmowa z bazy (42501), zero zapisu", async () => {
    const ctx = ctxOf(anonClient(), tenantA.tenantId, "owner");
    const before = await snapshotCatalog(admin, tenantA.tenantId);
    // Plik z istniejącym id — plan MUSI dotknąć bazy i dostać odmowę odczytu.
    const { data: anyA } = await admin
      .from("products")
      .select("id")
      .eq("tenant_id", tenantA.tenantId)
      .limit(1);
    const csv = [HEADER, `${anyA![0].id};X;;10000;0;1.0;1;1;true;;;;`].join("\r\n");
    await expect(runCatalogImport(ctx, csv)).rejects.toThrow(/42501/);
    expect(await snapshotCatalog(admin, tenantA.tenantId)).toEqual(before);
  });

  it("SONDA 4 — granice ról przez ISTNIEJĄCĄ bramkę: staff może edytować katalog wprost, więc może i importować", async () => {
    // Pin bramki: ta sama sesja staffa wykonuje zapis, który bramkuje
    // polityka tenant_insert z 0007 (zapis operacyjny dla KAŻDEGO członka).
    const directName = `Staff wprost ${randomUUID().slice(0, 8)}`;
    const { error: directError } = await staffAClient
      .from("products")
      .insert({ tenant_id: tenantA.tenantId, name: directName, base_price_day_grosze: 1_000 });
    expect(directError).toBeNull();

    // Skoro bramka katalogu przepuszcza staffa, import MUSI też — inaczej
    // zaostrzylibyśmy uprawnienia w bok, poza istniejącą polityką.
    const importedName = `Staff importem ${randomUUID().slice(0, 8)}`;
    const ctx = ctxOf(staffAClient, tenantA.tenantId, "staff");
    const result = await runCatalogImport(ctx, [HEADER, newProductLine(importedName)].join("\r\n"));
    expect(result.issues).toEqual([]);
    expect(result.result).toEqual({ created: 1, updated: 0, tiers: 0 });
  });

  it("SONDA 6 — wstrzyknięcie: round-trip eksport → import → eksport BAJT W BAJT, wartości w bazie bez zmian", async () => {
    const ctx = ctxOf(tenantA.client, tenantA.tenantId, "owner");
    const nastyName = '=HYPERLINK("http://zly.example";"klik")';
    const nastyDescription = '@SUM(A1:A9);\t"cudzysłów"\ndruga linia';
    const { data: nasty, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantA.tenantId,
        name: nastyName,
        description: nastyDescription,
        base_price_day_grosze: 12_345,
      })
      .select("id")
      .single();
    if (error || !nasty) throw new Error(`seed nasty: ${error?.message}`);
    const { error: tierError } = await admin.from("pricing_tiers").insert({
      tenant_id: tenantA.tenantId,
      product_id: nasty.id,
      tier_days: 7,
      multiplier: 6.5,
      label: "+48 progowy",
    });
    if (tierError) throw new Error(`seed nasty tier: ${tierError.message}`);

    const first = await exportCatalogCsv(ctx);
    const result = await runCatalogImport(ctx, first.csv);
    expect(result.issues).toEqual([]);
    expect(result.result!.created).toBe(0);

    // Wartości w bazie IDENTYCZNE — import nie zostawił apostrofu ani nie
    // zinterpretował formuły.
    const { data: after } = await admin
      .from("products")
      .select("name, description")
      .eq("id", nasty.id)
      .single();
    expect(after).toEqual({ name: nastyName, description: nastyDescription });

    // Round-trip bajt w bajt: drugi eksport = pierwszy eksport.
    const second = await exportCatalogCsv(ctx);
    expect(second.csv).toBe(first.csv);
  });

  it("podgląd (plan) NICZEGO nie zapisuje", async () => {
    const ctx = ctxOf(tenantA.client, tenantA.tenantId, "owner");
    const before = await snapshotCatalog(admin, tenantA.tenantId);
    const plan = await planCatalogImport(ctx, [HEADER, newProductLine("Tylko podgląd")].join("\r\n"));
    expect(plan.issues).toEqual([]);
    expect(plan.created).toBe(1);
    expect(await snapshotCatalog(admin, tenantA.tenantId)).toEqual(before);
  });
});
