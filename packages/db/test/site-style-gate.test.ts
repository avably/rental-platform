/**
 * STYL STRONY W MODELU DRAFT/PUBLISH (0046, ADR-090 na kanonie ADR-091).
 *
 * Motyw strony jest wyglądem CAŁEGO sklepu — mocniejszym niż treść pojedynczej
 * sekcji, bo przemalowuje wszystko naraz. Gdyby wchodził na żywą stronę
 * natychmiast, operator eksperymentujący z paletą przemalowywałby sklep
 * klientom pod ręką. Dlatego styl dostaje bliźniaka `style_published` i wchodzi
 * dokładnie tą samą bramką, co reszta stanu widocznego.
 *
 * Ten plik dowodzi PIĘCIU rzeczy, a każda psuje się inaczej:
 *
 *   1. OKNO WDROŻENIOWE — dla strony, która nigdy nie zapisała stylu, koperta
 *      jest BAJTOWO taka, jak przed 0046 (brak klucza `style`). To jest warunek
 *      wdrożenia: migracja wchodzi na produkcję PRZED kodem, a stary storefront
 *      odrzuca kopertę z nieznanym kluczem (`.strict()`) i gasi sklep;
 *   2. ZAPIS SZKICU NIE RUSZA ŻYWEJ STRONY — `style_draft` zmieniony w kreatorze
 *      nie zmienia koperty o bajt;
 *   3. PUBLIKACJA PRZENOSI STYL — i dopiero wtedy koperta dostaje klucz `style`;
 *   4. STRAŻNIK (ADR-091) OBEJMUJE NOWĄ KOLUMNĘ — bezpośredni zapis
 *      `style_published` przez członka tenanta to 42501, mimo GRANT UPDATE na
 *      tabelę. Bez tego bliźniak byłby bliźniakiem tylko z nazwy;
 *   5. IZOLACJA — właściciel tenanta A nie zapisze stylu tenanta B.
 *
 * Wymaga lokalnego Supabase i zmiennych SUPABASE_LOCAL_* (patrz seed-tenants.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";

import { integrationEnv } from "./helpers/integration-env";
import { cleanupSeeded, createAdminClient, seedTwoTenants, type TenantCtx } from "./helpers/seed-tenants";

const REQUIRED_ENV = [
  "SUPABASE_LOCAL_URL",
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const hasEnv = integrationEnv(REQUIRED_ENV);

/** Odmowa UPRAWNIENIA — ten sam SQLSTATE, co RLS i grant (ADR-091). */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

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

async function createSite(ctx: TenantCtx): Promise<string> {
  const { data, error } = await ctx.ownerClient
    .from("sites")
    .insert({ tenant_id: ctx.tenantId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się utworzyć strony: ${error?.message}`);
  return data.id as string;
}

async function publish(ctx: TenantCtx, siteId: string): Promise<void> {
  const { error } = await ctx.ownerClient.schema("app").rpc("publish_site", { p_site_id: siteId });
  if (error) throw new Error(`publish_site zawiodło: ${error.message}`);
}

const MOTYW = { theme: "noir-lux", accent: "champagne", fontPair: "editorial" } as const;

describe.skipIf(!hasEnv)("styl strony wchodzi na żywo wyłącznie publikacją (0046, ADR-090)", () => {
  let siteAId: string;
  let siteBId: string;

  beforeAll(async () => {
    admin = createAdminClient();
    anon = createAnonClient();
    ({ a, b } = await seedTwoTenants());

    siteAId = await createSite(a);
    await a.ownerClient
      .from("site_sections")
      .insert({
        tenant_id: a.tenantId,
        site_id: siteAId,
        type: "hero",
        position: 0,
        content_draft: { heading: "Hero" },
      });
    await publish(a, siteAId);

    siteBId = await createSite(b);
  }, 60_000);

  afterAll(async () => {
    await cleanupSeeded(admin);
    await sql?.end({ timeout: 5 });
  });

  it("kolumny stylu istnieją, są NOT NULL i startują pustym obiektem", async () => {
    const rows = await sql!`
      select column_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public' and table_name = 'sites'
         and column_name in ('style_draft', 'style_published')
       order by column_name`;
    expect(rows.map((row) => row.column_name)).toEqual(["style_draft", "style_published"]);
    for (const row of rows) {
      expect(row.is_nullable, `${row.column_name} musi być NOT NULL`).toBe("NO");
      expect(String(row.column_default), `${row.column_default}`).toContain("'{}'");
    }
  });

  it("OKNO WDROŻENIOWE: strona bez zapisanego stylu ma kopertę bez klucza `style`", async () => {
    // Stary storefront parsuje kopertę `.strict()` — nieznany klucz wywraca
    // CAŁĄ kopertę i gasi sklep. Ten test jest warunkiem wdrożenia migracji
    // przed kodem, a nie kosmetyką rozmiaru odpowiedzi.
    const koperta = await envelope(a.tenantId);
    expect(koperta).not.toBeNull();
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "template"]);
  });

  it("zapis SZKICU stylu nie zmienia koperty ani o bajt", async () => {
    const przed = JSON.stringify(await envelope(a.tenantId));

    const { error } = await a.ownerClient
      .from("sites")
      .update({ style_draft: MOTYW })
      .eq("tenant_id", a.tenantId)
      .eq("id", siteAId);
    expect(error, `zapis szkicu stylu powinien przejść: ${error?.message}`).toBeNull();

    expect(JSON.stringify(await envelope(a.tenantId))).toBe(przed);
  });

  it("member NIE zapisze style_published wprost — 42501 mimo GRANT UPDATE", async () => {
    // Sedno kanonu ADR-091: rozdzielenie kolumn opisuje intencję, dopiero
    // trigger czyni ją prawem tabeli. Bez wpisu `style_published` na liście
    // strażnika to zapytanie by PRZESZŁO i przemalowało żywą stronę.
    const { error } = await a.ownerClient
      .from("sites")
      .update({ style_published: { theme: "confetti" } })
      .eq("tenant_id", a.tenantId)
      .eq("id", siteAId);
    expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}, było: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("zapis style_published TĄ SAMĄ wartością przechodzi — strażnik broni ZMIANY", async () => {
    // Ta sama zasada, co dla template_published w 0045: `is distinct from`
    // przepuszcza zapis, który niczego nie zmienia. Inaczej pierwszy UPDATE
    // dotykający całego wiersza (np. z formularza) wywracałby się bez powodu.
    const { error } = await a.ownerClient
      .from("sites")
      .update({ style_published: {} })
      .eq("tenant_id", a.tenantId)
      .eq("id", siteAId);
    expect(error, `zapis bez zmiany powinien przejść: ${error?.message}`).toBeNull();
  });

  it("strona nie może URODZIĆ SIĘ z opublikowanym stylem — INSERT to 42501", async () => {
    const { error } = await b.ownerClient
      .from("sites")
      .insert({ tenant_id: b.tenantId, style_published: MOTYW })
      .select("id");
    expect(error?.code, `oczekiwano ${PG_INSUFFICIENT_PRIVILEGE}, było: ${error?.message}`).toBe(
      PG_INSUFFICIENT_PRIVILEGE,
    );
  });

  it("PUBLIKACJA przenosi styl i dopiero wtedy koperta dostaje klucz `style`", async () => {
    await publish(a, siteAId);

    const koperta = await envelope(a.tenantId);
    expect(Object.keys(koperta!).sort()).toEqual(["published_at", "sections", "style", "template"]);
    expect(koperta!.style).toEqual(MOTYW);

    const [row] = await sql!`select style_published from public.sites where id = ${siteAId}`;
    expect(row!.style_published).toEqual(MOTYW);
  });

  it("odczyt publiczny nie czyta kolumny SZKICU stylu", async () => {
    // Strażnik STRUKTURALNY: gdyby ktoś w przyszłości podmienił źródło koperty
    // na `style_draft`, wszystkie testy wyżej dalej by przeszły dla strony,
    // której szkic równa się publikacji — a wyciek byłby pełny.
    //
    // Skan idzie po OBU definicjach naraz, bo od 0074 (ADR-158) rdzeń odczytu
    // siedzi w app.get_published_page, a app.get_published_site jest jego
    // wywołaniem dla strony głównej. Skan po samej sygnaturze zastanej
    // przechodziłby przez pustkę — dokładnie ta klasa fałszywej zieleni.
    const [row] = await sql!`
      select pg_get_functiondef('app.get_published_site(uuid)'::regprocedure)
        || pg_get_functiondef('app.get_published_page(uuid,text)'::regprocedure) as def
    `;
    expect(String(row!.def).length, "puste definicje — czujnik po pustym zbiorze").toBeGreaterThan(
      500,
    );
    expect(String(row!.def)).not.toContain("style_draft");
    expect(String(row!.def)).toContain("style_published");
  });

  it("izolacja: właściciel A nie zapisze stylu strony tenanta B (RLS: zero wierszy)", async () => {
    const { data, error } = await a.ownerClient
      .from("sites")
      .update({ style_draft: MOTYW })
      .eq("id", siteBId)
      .select("id");
    expect(error).toBeNull();
    expect(data ?? []).toEqual([]);

    const [row] = await sql!`select style_draft from public.sites where id = ${siteBId}`;
    expect(row!.style_draft).toEqual({});
  });
});
