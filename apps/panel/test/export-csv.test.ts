/**
 * Eksporty CSV na ŻYWYM lokalnym Supabase (C2, ADR-111) — sonda §5 briefu:
 *
 *  1. CROSS-TENANT: eksport w kontekście tenanta A niesie KOMPLET wierszy A
 *     i ANI JEDNEGO wiersza B — asercje na dokładnych zbiorach, nie count>0.
 *     Dwie warstwy osobno:
 *       a) klient SESJI członka (RLS jest bramką),
 *       b) klient SERVICE-ROLE (rdzeń musi filtrować po tenant_id sam,
 *          niezależnie od mocy klienta — to jest tarcza dowodu M1: zdjęcie
 *          `.eq("tenant_id", …)` z zapytania pali dokładnie ten test).
 *  2. ROLE: eksport klientów to hurtowy zrzut danych osobowych — staff
 *     dostaje odmowę Z BRAMKI ROLI (AuthError 403 „forbidden", mierzona
 *     kodem, nie „error truthy"), przy pozytywnej kontroli, że zamówienia
 *     i katalog temu samemu staffowi działają (tarcza dowodu M3).
 *  3. ANON: klient bez sesji nie wyciąga NICZEGO nawet z pominięciem HTTP
 *     (RLS oddaje pustkę); odmowę 401 PRZED pracą na warstwie handlera
 *     dowodzi export-routes.test.ts.
 *  4. CSV INJECTION: payload `=HYPERLINK(...)` wchodzi do bazy PUBLICZNĄ
 *     ścieżką checkoutu (anon → app.public_checkout — ta sama RPC, którą
 *     woła storefront i API v1), a eksport neutralizuje go apostrofem
 *     (tarcza dowodu M2).
 *  5. Zero logowania danych osobowych: eksport nie woła console.* wcale.
 */
import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { AuthError } from "@/lib/auth";
import { exportCatalogCsv } from "@/lib/export/catalog";
import { exportCustomersCsv } from "@/lib/export/customers";
import { exportOrdersCsv, ORDERS_CSV_HEADER } from "@/lib/export/orders";
import { CSV_BOM } from "@/lib/export/csv";
import type { ExportContext } from "@/lib/export/common";

import { rpcCreateTenant } from "./helpers/create-tenant";
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

const TEST_PASSWORD = "ExportTest!12345678";
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

/** User + własna organizacja + świeża sesja (wzorzec orders.test.ts). */
async function createTenantOwner(
  admin: SupabaseClient,
  label: string,
): Promise<{ client: SupabaseClient; tenantId: string }> {
  const email = `exp-${label}-${randomUUID()}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser(${label}): ${error?.message}`);
  createdUserIds.push(data.user.id);

  const bootstrap = await signIn(email);
  const { data: tenantId, error: tenantError } = await rpcCreateTenant(bootstrap, {
      p_slug: `exp-${label}-${randomUUID()}`.slice(0, 39),
      p_name: `Organizacja eksportu ${label}`,
    });
  if (tenantError) throw new Error(`create_tenant(${label}): ${tenantError.message}`);
  createdTenantIds.push(tenantId as string);
  return { client: await signIn(email), tenantId: tenantId as string };
}

/** Staff w ISTNIEJĄCYM tenancie (wzorzec payment-accounts.test.ts). */
async function createStaffMember(
  admin: SupabaseClient,
  tenantId: string,
): Promise<SupabaseClient> {
  const email = `exp-staff-${randomUUID()}@test.local`;
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

async function seedProductWithUnit(
  admin: SupabaseClient,
  tenantId: string,
  name: string,
  tiers: { tier_days: number; multiplier: number; label?: string; sort_order?: number }[] = [],
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name,
      description: name === "Kolumna; z \"cudzysłowem\"\ni nową linią" ? name : `Opis ${name}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`seedProduct(${name}): ${error?.message}`);
  const productId = data.id as string;
  const { error: unitError } = await admin.from("product_units").insert({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
  });
  if (unitError) throw new Error(`seedUnit(${name}): ${unitError.message}`);
  if (tiers.length > 0) {
    const { error: tierError } = await admin.from("pricing_tiers").insert(
      tiers.map((tier) => ({ tenant_id: tenantId, product_id: productId, ...tier })),
    );
    if (tierError) throw new Error(`seedTiers(${name}): ${tierError.message}`);
  }
  return productId;
}

/**
 * PUBLICZNA ścieżka checkoutu: anon → app.public_checkout — dokładnie ta RPC,
 * którą wołają storefront (lib/actions/checkout.ts) i API v1. Dowód, że
 * wektor injection jest osiągalny Z ZEWNĄTRZ, bez żadnego konta.
 */
async function publicCheckout(
  tenantId: string,
  productId: string,
  input: { email: string; fullName: string; phone?: string; startDate: string; endDate: string },
): Promise<string> {
  const { data, error } = await anonClient()
    .schema("app")
    .rpc("public_checkout", {
      p_tenant_id: tenantId,
      p_email: input.email,
      p_full_name: input.fullName,
      p_phone: input.phone ?? null,
      p_start_date: input.startDate,
      p_end_date: input.endDate,
      p_delivery_method: "courier",
      p_pickup_location_id: null,
      p_items: [{ product_id: productId, quantity: 1 }],
      p_terms_version: "test-v1",
      p_locale: "pl",
    });
  if (error) throw new Error(`public_checkout: ${error.message}`);
  return (data as { order_number: string }).order_number;
}

/** Parser CSV pod asercje: zdejmuje BOM, honoruje cudzysłowy RFC 4180. */
function parseCsv(csv: string): string[][] {
  expect(csv.startsWith(CSV_BOM)).toBe(true);
  const body = csv.slice(CSV_BOM.length);
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inQuotes) {
      if (ch === '"' && body[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ";") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && body[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      i += 1;
    } else field += ch;
  }
  expect(field).toBe(""); // plik kończy się CRLF
  return rows;
}

function column(rows: string[][], header: string[], name: string): string[] {
  const index = header.indexOf(name);
  expect(index).toBeGreaterThanOrEqual(0);
  return rows.map((row) => row[index]);
}

const INJECTION_NAME = '=HYPERLINK("http://zly.example";"klik")';

describe.skipIf(!hasEnv)("eksporty CSV na żywej bazie (C2, ADR-111)", () => {
  let admin: SupabaseClient;
  let tenantA: { client: SupabaseClient; tenantId: string };
  let tenantB: { client: SupabaseClient; tenantId: string };
  let staffAClient: SupabaseClient;

  let productA1: string;
  let productA2: string;
  let orderA1: string;
  let orderA2: string;
  let orderA3: string;

  const emailInjected = `exp-inj-${randomUUID().slice(0, 8)}@test.local`;
  const emailPlain = `exp-plain-${randomUUID().slice(0, 8)}@test.local`;
  const emailB = `exp-b-${randomUUID().slice(0, 8)}@test.local`;

  const ctxOf = (supabase: SupabaseClient, tenantId: string, role: "owner" | "staff" | null): ExportContext => ({
    supabase,
    tenantId,
    role,
  });

  beforeAll(async () => {
    admin = adminClient();
    tenantA = await createTenantOwner(admin, "a");
    tenantB = await createTenantOwner(admin, "b");
    staffAClient = await createStaffMember(admin, tenantA.tenantId);

    // Metoda courier wymaga cennika dostaw (bramka 22023 w public_checkout).
    for (const tenantId of [tenantA.tenantId, tenantB.tenantId]) {
      const { error } = await admin.from("tenant_settings").insert({
        tenant_id: tenantId,
        key: "delivery_pricing",
        value: { courier: { price_grosze: 2_000 } },
      });
      if (error) throw new Error(`seed delivery_pricing: ${error.message}`);
    }

    productA1 = await seedProductWithUnit(admin, tenantA.tenantId, "Agregat A1", [
      { tier_days: 7, multiplier: 6.5, label: "Tydzień", sort_order: 1 },
      { tier_days: 3, multiplier: 2.8, sort_order: 0 },
    ]);
    productA2 = await seedProductWithUnit(
      admin,
      tenantA.tenantId,
      'Kolumna; z "cudzysłowem"\ni nową linią',
    );
    const productB1 = await seedProductWithUnit(admin, tenantB.tenantId, "Agregat B1");

    // Zamówienia A: payload injection wchodzi PUBLICZNĄ ścieżką (anon).
    // Ten sam e-mail dwa razy → checkout deduplikuje klienta po lower(email),
    // więc orders_count=2 jest policzalne z dokładnego seedu.
    orderA1 = await publicCheckout(tenantA.tenantId, productA1, {
      email: emailInjected,
      fullName: INJECTION_NAME,
      phone: "+48 600 100 200",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });
    orderA2 = await publicCheckout(tenantA.tenantId, productA1, {
      email: emailInjected,
      fullName: INJECTION_NAME,
      startDate: "2026-09-20",
      endDate: "2026-09-22",
    });
    orderA3 = await publicCheckout(tenantA.tenantId, productA2, {
      email: emailPlain,
      fullName: "Jan Zwyczajny",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
    });
    // Numer zamówienia B celowo NIEUŻYWANY w asercjach: numeracja jest
    // per-tenant (ADR-017) i koliduje z numerami A — dyskryminatorem
    // cross-tenant są e-maile i nazwy z seedu B.
    await publicCheckout(tenantB.tenantId, productB1, {
      email: emailB,
      fullName: "Klient Tenanta B",
      startDate: "2026-09-01",
      endDate: "2026-09-03",
    });
  }, 120_000);

  afterAll(async () => {
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("zamówienia, sesja członka A: KOMPLET wierszy A, zero wierszy B, waluta i grosze z wiersza", async () => {
    const { filename, csv } = await exportOrdersCsv(
      ctxOf(tenantA.client, tenantA.tenantId, "owner"),
    );
    expect(filename).toMatch(/^avably-orders-\d{4}-\d{2}-\d{2}\.csv$/);

    const [header, ...rows] = parseCsv(csv);
    expect(header).toEqual([...ORDERS_CSV_HEADER]);

    // Dokładny zbiór: trzy zamówienia A (w tym oba zamówienia klienta
    // z payloadem). UWAGA: numery zamówień są sekwencyjne PER TENANT
    // (ADR-017) — „AV-2026-001" istnieje też u B, więc dyskryminatorem
    // cross-tenant jest e-mail klienta (unikat seedu), nie numer.
    expect(rows).toHaveLength(3);
    const pairs = rows.map((row) => [
      row[header.indexOf("order_number")],
      row[header.indexOf("customer_email")],
    ]);
    expect(new Set(pairs.map((p) => p.join("|")))).toEqual(
      new Set([
        `${orderA1}|${emailInjected.toLowerCase()}`,
        `${orderA2}|${emailInjected.toLowerCase()}`,
        `${orderA3}|${emailPlain.toLowerCase()}`,
      ]),
    );
    expect(csv).not.toContain(emailB);
    expect(csv).not.toContain(tenantB.tenantId);

    // ADR-103: waluta Z WIERSZA zamówienia, kwoty surowe grosze (int),
    // bez symbolu waluty i bez formatowania.
    expect(column(rows, header, "currency")).toEqual(["PLN", "PLN", "PLN"]);
    for (const value of column(rows, header, "total_rental_grosze")) {
      expect(value).toMatch(/^\d+$/);
    }
    expect(csv).not.toContain("zł");
  });

  it("zamówienia, klient SERVICE-ROLE: rdzeń filtruje po tenant_id SAM (tarcza dowodu M1)", async () => {
    const { csv } = await exportOrdersCsv(ctxOf(admin, tenantA.tenantId, "owner"));
    const [, ...rows] = parseCsv(csv);
    // Klient widzi WSZYSTKO (service-role omija RLS) — jeżeli w wyniku nie ma
    // wierszy B, to zasługa wyłącznie filtra tenanta w rdzeniu eksportu.
    // Dyskryminator: e-mail klienta B (numery zamówień kolidują per tenant).
    expect(rows).toHaveLength(3);
    expect(csv).not.toContain(emailB);
    expect(csv).not.toContain("Klient Tenanta B");
  });

  it("zamówienia: filtr zakresu dat działa na start_date, obustronnie inclusive", async () => {
    const { csv } = await exportOrdersCsv(ctxOf(tenantA.client, tenantA.tenantId, "owner"), {
      from: "2026-09-20",
      to: "2026-09-20",
    });
    const [header, ...rows] = parseCsv(csv);
    expect(column(rows, header, "order_number")).toEqual([orderA2]);
    expect(column(rows, header, "start_date")).toEqual(["2026-09-20"]);
  });

  it("klienci, owner A: dokładny zbiór, dane do faktury, orders_count z bazy, neutralizacja payloadu (tarcza M2)", async () => {
    const { filename, csv } = await exportCustomersCsv(
      ctxOf(tenantA.client, tenantA.tenantId, "owner"),
    );
    expect(filename).toMatch(/^avably-customers-\d{4}-\d{2}-\d{2}\.csv$/);

    const [header, ...rows] = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(new Set(column(rows, header, "email"))).toEqual(
      new Set([emailInjected.toLowerCase(), emailPlain.toLowerCase()]),
    );
    expect(csv).not.toContain(emailB);

    const byEmail = new Map(rows.map((row) => [row[header.indexOf("email")], row]));
    const injected = byEmail.get(emailInjected.toLowerCase());
    expect(injected).toBeDefined();

    // CSV INJECTION: payload zasiany ANONIMOWĄ ścieżką checkoutu wychodzi
    // z apostrofem — Excel pokaże tekst, nie wykona formuły. Telefon `+48…`
    // dostaje ten sam prefiks (koszt spójnej reguły).
    expect(injected![header.indexOf("full_name")]).toBe(`'${INJECTION_NAME}`);
    expect(injected![header.indexOf("phone")]).toBe("'+48 600 100 200");
    // Kontrola negatywna na CAŁYM pliku: żadne pole nie zaczyna się gołym
    // znakiem formuły.
    for (const row of rows) {
      for (const field of row) {
        expect(field).not.toMatch(/^[=+@\t\r]/);
        if (field.startsWith("-")) throw new Error(`goły minus w polu: ${field}`);
      }
    }

    // Liczba zamówień policzona przez bazę (agregat osadzony): 2 i 1.
    expect(injected![header.indexOf("orders_count")]).toBe("2");
    expect(byEmail.get(emailPlain.toLowerCase())![header.indexOf("orders_count")]).toBe("1");
  });

  it("klienci, staff A: odmowa Z BRAMKI ROLI — AuthError 403 forbidden, zero odczytu (tarcza dowodu M3)", async () => {
    // Pozytywna kontrola najpierw: temu SAMEMU staffowi działają zamówienia
    // i katalog — odmowa niżej pochodzi więc z bramki roli, nie z izolacji
    // tenantów ani z zepsutej sesji.
    const staffCtx = ctxOf(staffAClient, tenantA.tenantId, "staff");
    const orders = await exportOrdersCsv(staffCtx);
    expect(parseCsv(orders.csv)).toHaveLength(4); // nagłówek + 3 zamówienia
    const catalog = await exportCatalogCsv(staffCtx);
    expect(parseCsv(catalog.csv).length).toBeGreaterThan(1);

    // Mierzymy ZDANIE BRAMKI: konkretna klasa, status i kod — nie „error
    // truthy" (RLS i tak przepuściłby SELECT staffa, więc maskowałby lukę).
    const attempt = exportCustomersCsv(staffCtx);
    await expect(attempt).rejects.toBeInstanceOf(AuthError);
    await expect(attempt).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("anon bez sesji dostaje ODMOWĘ z bazy nawet z pominięciem warstwy HTTP (REVOKE, ADR-016)", async () => {
    // Odmowę 401 PRZED pracą na warstwie route handlera dowodzi
    // export-routes.test.ts — tu dowodzimy warstwy niżej: rola anon nie ma
    // w ogóle SELECT na tabelach domenowych (jawny REVOKE), więc rdzeń
    // zawołany klientem bez sesji kończy się błędem odczytu (42501),
    // nie pustym plikiem i nie danymi.
    const anonCtx = ctxOf(anonClient(), tenantA.tenantId, "owner");
    await expect(exportOrdersCsv(anonCtx)).rejects.toThrow(/odczyt nie powiódł się \(42501\)/);
    await expect(exportCustomersCsv(anonCtx)).rejects.toThrow(
      /odczyt nie powiódł się \(42501\)/,
    );
    await expect(exportCatalogCsv(anonCtx)).rejects.toThrow(/odczyt nie powiódł się \(42501\)/);
  });

  it("katalog: format wymiany produkt × próg (C3), surowy multiplier, cudzysłowy i nowe linie bez rozjazdu kolumn", async () => {
    const { filename, csv } = await exportCatalogCsv(
      ctxOf(tenantA.client, tenantA.tenantId, "owner"),
    );
    expect(filename).toMatch(/^avably-catalog-\d{4}-\d{2}-\d{2}\.csv$/);

    const [header, ...rows] = parseCsv(csv);
    // A1 ma 2 progi → 2 wiersze; A2 bez progów → 1 wiersz. Dokładnie 3.
    expect(rows).toHaveLength(3);

    const a1Rows = rows.filter((row) => row[header.indexOf("product_id")] === productA1);
    expect(a1Rows).toHaveLength(2);
    // Progi rosnąco po tier_days, multiplier SUROWY (ADR-018 — cena całkowita
    // progu w krotności stawki dziennej, nie wyliczona kwota).
    expect(a1Rows.map((row) => row[header.indexOf("tier_days")])).toEqual(["3", "7"]);
    expect(a1Rows.map((row) => row[header.indexOf("tier_multiplier")])).toEqual(["2.8", "6.5"]);
    expect(a1Rows[1][header.indexOf("tier_label")]).toBe("Tydzień");

    const a2Rows = rows.filter((row) => row[header.indexOf("product_id")] === productA2);
    expect(a2Rows).toHaveLength(1);
    expect(a2Rows[0][header.indexOf("tier_days")]).toBe("");
    // Nazwa ze średnikiem, cudzysłowem i nową linią wróciła z parsera w CAŁOŚCI
    // — cytowanie RFC 4180 utrzymało kolumny w ryzach.
    expect(a2Rows[0][header.indexOf("name")]).toBe('Kolumna; z "cudzysłowem"\ni nową linią');
    expect(a2Rows[0][header.indexOf("base_price_day_grosze")]).toBe("10000");

    // Zero produktów B (sesja członka A).
    expect(rows.every((row) => row[header.indexOf("name")] !== "Agregat B1")).toBe(true);
  });

  it("katalog, klient SERVICE-ROLE: filtr tenanta w rdzeniu też tutaj (uzupełnienie tarczy M1)", async () => {
    const { csv } = await exportCatalogCsv(ctxOf(admin, tenantA.tenantId, "owner"));
    const [header, ...rows] = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row[header.indexOf("name")] !== "Agregat B1")).toBe(true);
  });

  it("eksport nie loguje treści danych osobowych (zero wywołań console.*)", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level),
    );
    try {
      await exportOrdersCsv(ctxOf(tenantA.client, tenantA.tenantId, "owner"));
      await exportCustomersCsv(ctxOf(tenantA.client, tenantA.tenantId, "owner"));
      await exportCatalogCsv(ctxOf(tenantA.client, tenantA.tenantId, "owner"));
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
