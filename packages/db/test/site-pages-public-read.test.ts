/**
 * Odczyt publiczny po ADRESIE i rejestr stron — migracja 0074, ADR-158.
 *
 * Cztery osie:
 *
 *   1. ODCZYT PO ADRESIE. `app.get_published_page` oddaje stronę spod
 *      wskazanego sluga i NIC innego; pusty slug to strona główna, a
 *      `app.get_published_site` jest dokładnie jej wywołaniem (koperta co do
 *      bajtu ta sama — storefront parsuje ją schematem `.strict()`).
 *
 *   2. IZOLACJA POZA RLS. Obie funkcje są SECURITY DEFINER, więc RLS ich NIE
 *      DOTYCZY: jedyną bramką są jawne filtry `tenant_id`. Adres najemcy A
 *      podany z identyfikatorem najemcy B nie oddaje strony A — i ten dowód
 *      idzie ścieżką ANON, czyli tam, gdzie żadnej sesji ani polityki nie ma.
 *      To jest sonda, o którą prosi brief: „udowodnij, że dowód nie wisi
 *      wyłącznie na RLS".
 *
 *   3. REJESTR ADRESÓW. `app.get_tenant_pages` niesie WYŁĄCZNIE żywe adresy
 *      pytanego najemcy, w kopercie `{pages, redirects}`. Klucz `redirects`
 *      istnieje od 0074 (pusty) — historia adresów z 0075 ma jechać TYM SAMYM
 *      torem, bez drugiej podróży do bazy.
 *
 *   4. OKNO HANDLOWE. Najemca poza oknem gaśnie w OBU funkcjach naraz —
 *      inaczej rejestr adresów mówiłby, że sklep istnieje, a odczyt strony
 *      oddawałby pustkę.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HOME_PAGE_SLUG } from "@avably/core/site";

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

const TEST_PASSWORD = "PagesReadTest!12345678";

interface PublishedPage {
  template: string;
  published_at: string;
  sections: { id: string; type: string; position: number; content: Record<string, unknown> }[];
}

interface PageRegistry {
  pages: string[];
  redirects: { from: string; to: string }[];
}

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

const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 1 }) : null;

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

describe.skipIf(!hasEnv)("odczyt publiczny po adresie — 0074 (ADR-158)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  let tenantA: string;
  let tenantB: string;

  async function seedTenant(label: string): Promise<string> {
    const slug = `pgr-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Strony read ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta ${label}: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(tenantId: string): Promise<SupabaseClient> {
    const email = `pgr-owner-${randomUUID().slice(0, 8)}@test.local`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      app_metadata: { tenant_id: tenantId, role: "owner" },
    });
    if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
    createdUserIds.push(data.user.id);
    const { error: memberError } = await admin
      .from("members")
      .insert({ tenant_id: tenantId, user_id: data.user.id, role: "owner" });
    if (memberError) throw new Error(`members: ${memberError.message}`);
    const client = anonClient();
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (signInError) throw new Error(`signIn: ${signInError.message}`);
    return client;
  }

  /** Strona z jedną sekcją, opublikowana pod wskazanym adresem. */
  async function publishPage(
    owner: SupabaseClient,
    tenantId: string,
    slug: string,
    heading: string,
  ): Promise<string> {
    const { data, error } = await owner
      .from("sites")
      .insert({ tenant_id: tenantId, name: `Strona ${heading}`, slug })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert sites (${slug}): ${error?.message}`);
    const siteId = data.id as string;
    const { error: sectionError } = await owner.from("site_sections").insert({
      tenant_id: tenantId,
      site_id: siteId,
      type: "hero",
      position: 0,
      content_draft: { heading },
    });
    if (sectionError) throw new Error(`insert site_sections: ${sectionError.message}`);
    const { error: publishError } = await owner
      .schema("app")
      .rpc("publish_site", { p_site_id: siteId });
    if (publishError) throw new Error(`publish_site (${slug}): ${publishError.message}`);
    return siteId;
  }

  async function page(tenantId: string, slug: string): Promise<PublishedPage | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });
    if (error) throw new Error(`get_published_page: ${error.message}`);
    return data as PublishedPage | null;
  }

  async function registry(tenantId: string): Promise<PageRegistry | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_tenant_pages", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_tenant_pages: ${error.message}`);
    return data as PageRegistry | null;
  }

  beforeAll(async () => {
    if (!hasEnv) return;
    tenantA = await seedTenant("a");
    tenantB = await seedTenant("b");
    const ownerA = await ownerClient(tenantA);
    const ownerB = await ownerClient(tenantB);

    await publishPage(ownerA, tenantA, HOME_PAGE_SLUG, "Sklep A");
    await publishPage(ownerA, tenantA, "kontakt", "Kontakt A");
    // Szkic — nie ma prawa pojawić się ani w rejestrze, ani w odczycie.
    await ownerA.from("sites").insert({ tenant_id: tenantA, name: "Szkic", slug: "cennik" });

    await publishPage(ownerB, tenantB, HOME_PAGE_SLUG, "Sklep B");
  }, 120_000);

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Odczyt po adresie
  // -------------------------------------------------------------------
  describe("odczyt po adresie", () => {
    it("pusty slug oddaje stronę GŁÓWNĄ, a slug treściowy — swoją stronę", async () => {
      const glowna = await page(tenantA, HOME_PAGE_SLUG);
      const kontakt = await page(tenantA, "kontakt");
      expect(glowna?.sections[0]?.content.heading).toBe("Sklep A");
      expect(kontakt?.sections[0]?.content.heading).toBe("Kontakt A");
    });

    it("app.get_published_site jest DOKŁADNIE odczytem strony głównej", async () => {
      const [row] = await sql!<{ zgodne: boolean }[]>`
        select app.get_published_site(${tenantA}::uuid)
             is not distinct from app.get_published_page(${tenantA}::uuid, '') as zgodne
      `;
      expect(row!.zgodne, "sygnatura zastana rozjechała się z rdzeniem odczytu").toBe(true);
    });

    it("adres nieistniejący i adres SZKICU oddają NULL, nie cudzą stronę", async () => {
      expect(await page(tenantA, "nie-ma-takiej")).toBeNull();
      // `cennik` istnieje jako wiersz, ale nigdy nie był publikowany.
      expect(await page(tenantA, "cennik"), "szkic wyciekł do sklepu").toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 2. Izolacja POZA RLS (sonda bezpieczeństwa)
  // -------------------------------------------------------------------
  describe("izolacja najemców poza RLS", () => {
    it("adres najemcy A z identyfikatorem najemcy B NIE oddaje strony A", async () => {
      // Obie funkcje są SECURITY DEFINER — RLS ich nie dotyczy, więc jedyną
      // bramką jest jawny filtr tenant_id. Gdyby zniknął, `kontakt` najemcy A
      // wyświetliłby się pod hostem najemcy B.
      expect(await page(tenantB, "kontakt"), "strona najemcy A na hoście najemcy B").toBeNull();
    });

    it("KONTROLA POZYTYWNA: ten sam adres pytany o WŁAŚCIWEGO najemcę oddaje stronę", async () => {
      // Bez tego „null zawsze" (np. przez literówkę w warunku) wyglądałby jak
      // działająca izolacja.
      expect(await page(tenantA, "kontakt")).not.toBeNull();
    });

    it("rejestr adresów najemcy B nie niesie ANI JEDNEGO adresu najemcy A", async () => {
      const rejestrB = await registry(tenantB);
      expect(rejestrB?.pages, "rejestr B jest pusty — czujnik po pustym zbiorze").toContain(
        HOME_PAGE_SLUG,
      );
      expect(rejestrB?.pages, "adres najemcy A w rejestrze najemcy B").not.toContain("kontakt");
    });
  });

  // -------------------------------------------------------------------
  // 3. Rejestr adresów
  // -------------------------------------------------------------------
  describe("rejestr adresów", () => {
    it("niesie komplet ŻYWYCH adresów i nic poza nimi", async () => {
      const rejestr = await registry(tenantA);
      expect([...(rejestr?.pages ?? [])].sort()).toEqual([HOME_PAGE_SLUG, "kontakt"]);
    });

    it("koperta ma KLUCZ redirects od 0074 — w 0075 nie zmienia kształtu", async () => {
      // Middleware czyta tę kopertę na KAŻDE żądanie sklepu; gdyby klucz
      // dochodził dopiero z 0075, okno wdrożeniowe byłoby oknem awarii.
      const rejestr = await registry(tenantA);
      expect(Object.keys(rejestr ?? {}).sort()).toEqual(["pages", "redirects"]);
      expect(rejestr?.redirects).toEqual([]);
    });

    it("najemca bez ani jednej żywej strony oddaje PUSTĄ listę, nie NULL", async () => {
      // Rozróżnienie „nie ma stron" od „nie ma najemcy" jest tym, po czym
      // proxy decyduje między 404 sklepu a 404 hosta.
      const pusty = await seedTenant("pusty");
      const rejestr = await registry(pusty);
      expect(rejestr).toEqual({ pages: [], redirects: [] });
    });
  });

  // -------------------------------------------------------------------
  // 4. Okno handlowe gasi OBIE funkcje naraz
  // -------------------------------------------------------------------
  it("najemca poza oknem handlowym gaśnie i w rejestrze, i w odczycie strony", async () => {
    const zawieszony = await seedTenant("zawieszony");
    const owner = await ownerClient(zawieszony);
    await publishPage(owner, zawieszony, HOME_PAGE_SLUG, "Sklep zawieszony");

    expect(await page(zawieszony, HOME_PAGE_SLUG), "kontrola pozytywna przed zawieszeniem")
      .not.toBeNull();

    await admin.from("tenants").update({ status: "suspended" }).eq("id", zawieszony);

    expect(await page(zawieszony, HOME_PAGE_SLUG)).toBeNull();
    expect(await registry(zawieszony)).toBeNull();
  }, 120_000);
});
