import { randomUUID } from "node:crypto";

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
 * LOGO NAJEMCY (0076, ADR-160) — znak firmy w modelu draft/publish.
 *
 * Ten plik dowodzi ośmiu rzeczy, a każda psuje się inaczej:
 *
 *   1. OKNO WDROŻENIOWE — najemca bez znaku ma kopertę BAJTOWO taką, jak przed
 *      0076 (brak klucza `logo`). Migracja wchodzi na produkcję PRZED kodem,
 *      a stary storefront odrzuca kopertę z nieznanym kluczem (`.strict()`);
 *   2. ZAPIS SZKICU NIE RUSZA SKLEPU — `logo_draft` nie zmienia koperty o bajt;
 *   3. PUBLIKACJA PRZENOSI ZNAK — i dopiero wtedy koperta dostaje klucz `logo`;
 *   4. STRAŻNIK obejmuje `logo_published` — bezpośredni zapis rolą, która MA
 *      politykę UPDATE na `tenants` (superadmin), to 42501;
 *   5. ZAWĘŻENIE ŚCIEŻKI JEST W CIELE RPC, nie w RLS — najemca A nie postawi
 *      u siebie pliku najemcy B, mimo że `set_tenant_logo` jest SECURITY
 *      DEFINER i RLS w nim nie uczestniczy;
 *   6. BILET UPLOADU BEZ STRONY działa (bramka Storage widzi bilet logo)
 *      i ma WŁASNY, ostrzejszy sufit;
 *   7. SPRZĄTACZ SIEROT WIDZI ŻYWY ZNAK — `app.site_image_paths_in_use` zwraca
 *      ścieżkę z `logo_draft` ORAZ z `logo_published`. Bez tego cron kasuje
 *      żywe logo najemcy (dowód całej drogi: apps/panel/test/tenant-logo-live);
 *   8. IZOLACJA — najemca A nie czyta ani nie zapisuje znaku najemcy B.
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

/** Odmowa UPRAWNIENIA — ten sam SQLSTATE, co RLS i grant (ADR-091). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/** Odmowa RPC — jedno zdanie dla wszystkich powodów (wzorzec 0043). */
const PG_INVALID_PARAMETER = "22023";

const BUCKET = "site-images";
const MAX_LOGO_BYTES = 512 * 1024;
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const sql = process.env.SUPABASE_LOCAL_URL
  ? postgres(process.env.SUPABASE_LOCAL_URL, { max: 1 })
  : null;

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

let admin: SupabaseClient;
let anon: SupabaseClient;
let a: TenantCtx;
let b: TenantCtx;
let superadmin: SupabaseClient;
let superadminUserId: string;
const uploadedPaths: string[] = [];

function createAnonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_ANON_KEY as string,
    {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...realtimeTransport,
    },
  );
}

async function envelope(tenantId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await anon
    .schema("app")
    .rpc("get_published_site", { p_tenant_id: tenantId });
  if (error) throw new Error(`get_published_site jako anon zawiodło: ${error.message}`);
  return data as Record<string, unknown> | null;
}

async function createPublishedSite(ctx: TenantCtx): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("sites")
    .insert({ tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  const siteId = data.id as string;
  await ctx.ownerClient.from("site_sections").insert({
    tenant_id: ctx.tenantId,
    site_id: siteId,
    type: "hero",
    position: 0,
    content_draft: { heading: "Hero" },
  });
  const published = await ctx.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteId });
  if (published.error) throw new Error(`publish_site zawiodło: ${published.error.message}`);
  return siteId;
}

function issueLogo(client: SupabaseClient, mime = "image/png", size = 68) {
  return client
    .schema("app")
    .rpc("issue_site_logo_upload", { p_declared_mime: mime, p_declared_size: size })
    .single();
}

function setLogo(client: SupabaseClient, logo: Record<string, unknown>) {
  return client.schema("app").rpc("set_tenant_logo", { p_logo: logo });
}

function publishLogo(client: SupabaseClient) {
  return client.schema("app").rpc("publish_tenant_logo");
}

async function logoColumns(tenantId: string) {
  const [row] = await sql!<{ logo_draft: unknown; logo_published: unknown }[]>`
    select logo_draft, logo_published from public.tenants where id = ${tenantId}
  `;
  return row!;
}

describe.skipIf(!hasEnv)("logo najemcy wchodzi na żywo wyłącznie publikacją (0076, ADR-160)", () => {
  let logoPathA: string;

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    await createPublishedSite(a);
    await createPublishedSite(b);

    // Superadmin: JEDYNA rola interaktywna z polityką UPDATE na `tenants`
    // (0001). Bez niego dowód strażnika byłby po pustym zbiorze — członek
    // dostaje od RLS „zero wierszy", a nie odmowę, więc niczego by nie mierzył.
    const email = `tenant-logo-super-${randomUUID()}@test.local`;
    const created = await admin.auth.admin.createUser({
      email,
      password: "TenantLogo!12345678",
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw created.error;
    superadminUserId = created.data.user.id;
    await sql!`insert into app.superadmins (user_id) values (${superadminUserId})`;
    superadmin = createAnonClient();
    const signedIn = await superadmin.auth.signInWithPassword({
      email,
      password: "TenantLogo!12345678",
    });
    if (signedIn.error) throw signedIn.error;
  }, 60_000);

  afterAll(async () => {
    if (uploadedPaths.length > 0) await admin.storage.from(BUCKET).remove(uploadedPaths);
    if (superadminUserId) {
      await sql!`delete from app.superadmins where user_id = ${superadminUserId}`;
      await admin.auth.admin.deleteUser(superadminUserId);
    }
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("kolumny logo istnieją, są NOT NULL i startują pustym obiektem", async () => {
    const rows = await sql!`
      select column_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public' and table_name = 'tenants'
         and column_name in ('logo_draft', 'logo_published')
       order by column_name`;
    expect(rows.map((row) => row.column_name)).toEqual(["logo_draft", "logo_published"]);
    for (const row of rows) {
      expect(row.is_nullable, `${row.column_name} musi być NOT NULL`).toBe("NO");
      expect(String(row.column_default)).toContain("'{}'");
    }
  });

  it("OKNO WDROŻENIOWE: najemca bez znaku ma kopertę bez klucza `logo`", async () => {
    const koperta = await envelope(a.tenantId);
    expect(koperta).not.toBeNull();
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "template"]);
  });

  it("bilet uploadu logo ma ścieżkę {tenant}/logo/{upload}.{ext} i nie pyta o stronę", async () => {
    const { data, error } = await issueLogo(a.ownerClient);
    expect(error, error?.message).toBeNull();
    const uploadId = (data as { upload_id: string }).upload_id;
    expect((data as { storage_path: string }).storage_path).toBe(
      `${a.tenantId}/logo/${uploadId}.png`,
    );

    const [row] = await sql!<{ kind: string; site_id: string | null }[]>`
      select kind, site_id from public.site_image_uploads where id = ${uploadId}
    `;
    expect(row).toMatchObject({ kind: "logo", site_id: null });
  });

  it("bilet logo ma WŁASNY sufit: 512 KiB przechodzi, jeden bajt więcej nie", async () => {
    const exact = await issueLogo(a.ownerClient, "image/png", MAX_LOGO_BYTES);
    expect(exact.error, exact.error?.message).toBeNull();

    const tooLarge = await issueLogo(a.ownerClient, "image/png", MAX_LOGO_BYTES + 1);
    expect(tooLarge.error?.code).toBe(PG_INVALID_PARAMETER);
  });

  it("anon nie ma EXECUTE do wystawienia biletu logo ani do zapisu znaku", async () => {
    expect((await issueLogo(anon)).error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect((await setLogo(anon, {})).error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    expect((await publishLogo(anon)).error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
  });

  it("bramka Storage przyjmuje podpis dla biletu logo, a bez biletu odmawia", async () => {
    // To jest dowód gałęzi `site_id is null` w app.can_upload_site_image:
    // przed 0076 join na `sites` odcinał bilet logo i podpis NIE powstawał.
    const issued = await issueLogo(a.ownerClient);
    const path = (issued.data as { storage_path: string }).storage_path;
    const signed = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(path, { upsert: false });
    expect(signed.error, signed.error?.message).toBeNull();

    const uploaded = await a.ownerClient.storage
      .from(BUCKET)
      .uploadToSignedUrl(path, signed.data!.token, PNG, {
        contentType: "image/png",
        upsert: false,
      });
    expect(uploaded.error, uploaded.error?.message).toBeNull();
    uploadedPaths.push(path);
    logoPathA = path;

    const withoutTicket = `${a.tenantId}/logo/${randomUUID()}.png`;
    const refused = await a.ownerClient.storage
      .from(BUCKET)
      .createSignedUploadUrl(withoutTicket, { upsert: false });
    expect(refused.error, "ścieżka logo bez biletu nie ma prawa dostać podpisu").not.toBeNull();
  });

  it("ZAWĘŻENIE ŚCIEŻKI: najemca A nie postawi u siebie pliku najemcy B", async () => {
    // `set_tenant_logo` jest SECURITY DEFINER, więc RLS w tym zapisie NIE
    // uczestniczy — jedyną bramką jest wzorzec ścieżki w ciele funkcji.
    const foreign = await setLogo(a.ownerClient, {
      path: `${b.tenantId}/logo/${randomUUID()}.png`,
    });
    expect(foreign.error?.code, foreign.error?.message).toBe(PG_INVALID_PARAMETER);

    // Ta sama odmowa dla ścieżki spoza katalogu `logo` i dla wyjścia w górę.
    for (const path of [
      `${a.tenantId}/${randomUUID()}/${randomUUID()}.png`,
      `${a.tenantId}/logo/../../${randomUUID()}.png`,
      `../${a.tenantId}/logo/${randomUUID()}.png`,
    ]) {
      const refused = await setLogo(a.ownerClient, { path });
      expect(refused.error?.code, `przyjęta ścieżka: ${path}`).toBe(PG_INVALID_PARAMETER);
    }

    expect((await logoColumns(a.tenantId)).logo_draft).toEqual({});
  });

  it("zapis SZKICU znaku nie zmienia koperty ani o bajt", async () => {
    const przed = JSON.stringify(await envelope(a.tenantId));

    const saved = await setLogo(a.ownerClient, {
      path: logoPathA,
      alt: "Znak testowy",
      inFooter: true,
    });
    expect(saved.error, saved.error?.message).toBeNull();
    expect((await logoColumns(a.tenantId)).logo_draft).toMatchObject({ path: logoPathA });

    expect(JSON.stringify(await envelope(a.tenantId))).toBe(przed);
  });

  it("SPRZĄTACZ: ścieżka ze SZKICU jest w użyciu, obca nie", async () => {
    const unused = `${a.tenantId}/logo/${randomUUID()}.png`;
    const inUse = await sql!<{ path: string }[]>`
      select path from app.site_image_paths_in_use(${sql!.array([logoPathA, unused])}::text[]) as path
    `;
    expect(inUse.map((row) => row.path)).toEqual([logoPathA]);
  });

  it("PUBLIKACJA przenosi znak i dopiero wtedy koperta dostaje klucz `logo`", async () => {
    const published = await publishLogo(a.ownerClient);
    expect(published.error, published.error?.message).toBeNull();

    const koperta = await envelope(a.tenantId);
    expect(Object.keys(koperta!).sort()).toEqual([
      "logo",
      "published_at",
      "sections",
      "template",
    ]);
    expect(koperta!.logo).toEqual({ path: logoPathA, alt: "Znak testowy", inFooter: true });

    const columns = await logoColumns(a.tenantId);
    expect(columns.logo_published).toEqual(columns.logo_draft);
  });

  it("SPRZĄTACZ: ścieżka z bliźniaka opublikowanego też jest w użyciu", async () => {
    // Osobny przypadek od szkicu: najemca może wgrać nowy znak (szkic się
    // zmienia), a plik ŻYWY dalej wisi w sklepie i nie wolno go skasować.
    const nextPath = `${a.tenantId}/logo/${randomUUID()}.png`;
    const issued = await issueLogo(a.ownerClient);
    const draftPath = (issued.data as { storage_path: string }).storage_path;
    await setLogo(a.ownerClient, { path: draftPath, inFooter: false });

    const inUse = await sql!<{ path: string }[]>`
      select path from app.site_image_paths_in_use(
        ${sql!.array([logoPathA, draftPath, nextPath])}::text[]
      ) as path
    `;
    expect(inUse.map((row) => row.path).sort()).toEqual([draftPath, logoPathA].sort());

    // Stan przywrócony, żeby kolejne przypadki widziały opublikowany znak.
    await setLogo(a.ownerClient, { path: logoPathA, alt: "Znak testowy", inFooter: true });
  });

  it("STRAŻNIK: superadmin nie zapisze logo_published wprost — 42501", async () => {
    const { error } = await superadmin
      .from("tenants")
      .update({ logo_published: { path: logoPathA, inFooter: true } })
      .eq("id", b.tenantId);
    expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}, było: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("zapis logo_published TĄ SAMĄ wartością przechodzi — strażnik broni ZMIANY", async () => {
    const { error } = await superadmin
      .from("tenants")
      .update({ logo_published: {} })
      .eq("id", b.tenantId);
    expect(error, `zapis bez zmiany powinien przejść: ${error?.message}`).toBeNull();
  });

  it("najemca nie może URODZIĆ SIĘ z opublikowanym znakiem — INSERT to 42501", async () => {
    const { error } = await superadmin
      .from("tenants")
      .insert({
        slug: `logo-guard-${randomUUID().slice(0, 8)}`,
        name: "Strażnik",
        logo_published: { path: logoPathA, inFooter: true },
      })
      .select("id");
    expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}, było: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("odczyt publiczny nie czyta kolumny SZKICU znaku", async () => {
    // Strażnik STRUKTURALNY (wzorzec z site-style-gate): gdyby ktoś podmienił
    // źródło koperty na `logo_draft`, wszystkie testy wyżej dalej by przeszły
    // dla najemcy, którego szkic równa się publikacji — a wyciek byłby pełny.
    const [row] = await sql!`
      select pg_get_functiondef('app.get_published_site(uuid)'::regprocedure)
        || pg_get_functiondef('app.get_published_page(uuid,text)'::regprocedure) as def
    `;
    expect(String(row!.def).length, "puste definicje — czujnik po pustym zbiorze").toBeGreaterThan(
      500,
    );
    expect(String(row!.def)).not.toContain("logo_draft");
    expect(String(row!.def)).toContain("logo_published");
  });

  it("IZOLACJA: znak najemcy A nie wychodzi na sklep najemcy B", async () => {
    const koperta = await envelope(b.tenantId);
    expect(koperta).not.toBeNull();
    expect(Object.keys(koperta!)).not.toContain("logo");

    // Odczyt wiersza cudzego najemcy: RLS oddaje zero wierszy (own_select).
    const foreign = await a.ownerClient
      .from("tenants")
      .select("id, logo_published")
      .eq("id", b.tenantId);
    expect(foreign.data ?? []).toEqual([]);
  });

  it("publikacja znaku przez najemcę B nie kopiuje znaku najemcy A", async () => {
    const published = await publishLogo(b.ownerClient);
    expect(published.error, published.error?.message).toBeNull();
    expect((await logoColumns(b.tenantId)).logo_published).toEqual({});
    expect((await logoColumns(a.tenantId)).logo_published).toMatchObject({ path: logoPathA });
  });

  it("pusty obiekt zdejmuje znak ze sklepu po publikacji", async () => {
    expect((await setLogo(a.ownerClient, {})).error).toBeNull();
    expect((await publishLogo(a.ownerClient)).error).toBeNull();

    const koperta = await envelope(a.tenantId);
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "template"]);
  });
});
