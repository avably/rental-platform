/**
 * Historia adresów i przekierowania 308 — migracja 0075, ADR-159.
 *
 * Pięć osi:
 *
 *   1. ZAPIS. Publikacja zmieniająca adres zostawia stary adres w historii,
 *      a rejestr proxy niesie go jako przekierowanie — TĄ SAMĄ kopertą, którą
 *      rozstrzyga adres (bez drugiej podróży do bazy).
 *
 *   2. HISTORIA NIE JEST KANAŁEM PRZEJĘCIA ADRESU. `authenticated` NIE MA na
 *      tabeli ani INSERT-u, ani UPDATE-u, ani DELETE-u: gdyby miał, członek
 *      przekierowałby dowolny adres surowym PostgREST-em, z pominięciem
 *      publikacji. Jedyną drogą wpisu jest trigger uzbrojony zmianą
 *      `slug_published`, a tę kolumnę pisze wyłącznie `app.publish_site`.
 *
 *   3. BLOKADA PONOWNEGO UŻYCIA. Inna strona tego samego najemcy nie weźmie
 *      adresu, który historia trzyma jako przekierowanie — inaczej stary link
 *      zacząłby po cichu prowadzić pod inną treść. Strona, która ten adres
 *      ZOSTAWIŁA, może pod niego wrócić.
 *
 *   4. CHECKBOX. Wyłączone przekierowanie znaczy „nie zapisuj historii", a nie
 *      „zapisz i zignoruj".
 *
 *   5. IZOLACJA. Historia najemcy A nie wychodzi w rejestrze najemcy B i nie
 *      blokuje mu adresu — adresy są per najemca, bo per host.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const PG_INVALID_PARAMETER = "22023";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "SlugHistory!12345678";

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

describe.skipIf(!hasEnv)("historia adresów stron — 0075 (ADR-159)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `hist-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Historia ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(tenantId: string): Promise<SupabaseClient> {
    const email = `hist-${randomUUID().slice(0, 8)}@test.local`;
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

  async function createPage(
    owner: SupabaseClient,
    tenantId: string,
    slug: string,
  ): Promise<string> {
    const { data, error } = await owner
      .from("sites")
      .insert({ tenant_id: tenantId, name: `Strona ${slug || "glowna"}`, slug })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert sites (${slug}): ${error?.message}`);
    return data.id as string;
  }

  async function publish(owner: SupabaseClient, siteId: string): Promise<void> {
    const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: siteId });
    if (error) throw new Error(`publish_site: ${error.message}`);
  }

  async function moveTo(
    owner: SupabaseClient,
    tenantId: string,
    siteId: string,
    slug: string,
  ): Promise<void> {
    const { error } = await owner
      .from("sites")
      .update({ slug })
      .eq("tenant_id", tenantId)
      .eq("id", siteId);
    if (error) throw new Error(`zmiana adresu na ${slug}: ${error.message}`);
    await publish(owner, siteId);
  }

  async function registry(tenantId: string): Promise<PageRegistry | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_tenant_pages", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_tenant_pages: ${error.message}`);
    return data as PageRegistry | null;
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Zapis historii i przekierowanie w rejestrze
  // -------------------------------------------------------------------
  describe("publikacja zmieniająca adres zostawia przekierowanie", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("zapis");
      owner = await ownerClient(tenantId);
      siteId = await createPage(owner, tenantId, "kontakt");
      await publish(owner, siteId);
    }, 120_000);

    it("rejestr PRZED zmianą nie ma ani jednego przekierowania", async () => {
      // Kontrola po pustym zbiorze: bez niej „są przekierowania" niżej
      // mogłoby znaczyć „zawsze są".
      const przed = await registry(tenantId);
      expect(przed?.pages).toEqual(["kontakt"]);
      expect(przed?.redirects).toEqual([]);
    });

    it("po zmianie adresu stary prowadzi 308 na nowy — TĄ SAMĄ kopertą", async () => {
      await moveTo(owner, tenantId, siteId, "kontakt-nowy");

      const po = await registry(tenantId);
      expect(po?.pages).toEqual(["kontakt-nowy"]);
      expect(po?.redirects).toEqual([{ from: "kontakt", to: "kontakt-nowy" }]);
    });

    it("druga przeprowadzka zostawia OBA stare adresy", async () => {
      // Kolumna nie wystarczyłaby: strona przenoszona kilka razy zostawia N
      // starych adresów i każdy ma dalej prowadzić do bieżącego.
      await moveTo(owner, tenantId, siteId, "kontakt-2026");

      const po = await registry(tenantId);
      expect([...(po?.redirects ?? [])].sort((a, b) => a.from.localeCompare(b.from))).toEqual([
        { from: "kontakt", to: "kontakt-2026" },
        { from: "kontakt-nowy", to: "kontakt-2026" },
      ]);
    });

    it("przekierowanie GAŚNIE razem ze stroną — 308 na 404 jest gorsze niż brak", async () => {
      /*
       * CZASOWNIKIEM, nie surowym UPDATE-em (0078, ADR-170). Do tej migracji
       * ten przypadek musiał UDAWAĆ stan, którego nie dało się osiągnąć z żadnej
       * ścieżki produktu — zdjęcia strony ze sklepu po prostu nie było. Teraz
       * jedzie tą samą drogą, co operator, więc mierzy zachowanie, a nie
       * hipotezę o nim.
       */
      const { error } = await owner.schema("app").rpc("unpublish_site", { p_site_id: siteId });
      expect(error, `unpublish_site: ${error?.message}`).toBeNull();

      expect((await registry(tenantId))?.redirects).toEqual([]);
      await publish(owner, siteId);
    });

    it("strona MOŻE wrócić pod swój dawny adres — wtedy przestaje się na niego przekierowywać", async () => {
      await moveTo(owner, tenantId, siteId, "kontakt");

      const po = await registry(tenantId);
      expect(po?.pages).toEqual(["kontakt"]);
      expect(
        po?.redirects.map((entry) => entry.from),
        "adres przekierowuje sam do siebie",
      ).not.toContain("kontakt");
    });
  });

  // -------------------------------------------------------------------
  // 2. Historia nie jest kanałem przejęcia adresu
  // -------------------------------------------------------------------
  describe("historia nie jest kanałem przejęcia adresu", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("kanal");
      owner = await ownerClient(tenantId);
      siteId = await createPage(owner, tenantId, "oferta");
      await publish(owner, siteId);
      await moveTo(owner, tenantId, siteId, "oferta-2026");
    }, 120_000);

    it("członek WIDZI historię własnego najemcy (bramka sluga jej potrzebuje)", async () => {
      const { data, error } = await owner.from("site_slug_history").select("slug");
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.slug)).toEqual(["oferta"]);
    });

    it("członek NIE WSTAWI wiersza historii — brak grantu INSERT (42501)", async () => {
      const { error } = await owner
        .from("site_slug_history")
        .insert({ tenant_id: tenantId, site_id: siteId, slug: "przejete" });
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("członek NIE PRZESTAWI istniejącego wiersza na inną stronę (42501)", async () => {
      const inna = await createPage(owner, tenantId, "inna-strona");
      const { error } = await owner
        .from("site_slug_history")
        .update({ site_id: inna })
        .eq("tenant_id", tenantId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const rows = await sql!<{ site_id: string }[]>`
        select site_id from public.site_slug_history where tenant_id = ${tenantId}::uuid
      `;
      expect(rows[0]!.site_id, "przekierowanie zmieniło cel mimo odmowy").toBe(siteId);
    });

    it("członek NIE SKASUJE wiersza historii (42501)", async () => {
      const { error } = await owner.from("site_slug_history").delete().eq("tenant_id", tenantId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("anon nie czyta tabeli historii wprost — jedyną drogą jest rejestr", async () => {
      const { data, error } = await anon.from("site_slug_history").select("slug");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // 3. Blokada ponownego użycia
  // -------------------------------------------------------------------
  describe("blokada ponownego użycia starego adresu", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("reuse");
      owner = await ownerClient(tenantId);
      siteId = await createPage(owner, tenantId, "cennik");
      await publish(owner, siteId);
      await moveTo(owner, tenantId, siteId, "cennik-2026");
    }, 120_000);

    it("INNA strona nie weźmie adresu, który przekierowuje (22023, z uzasadnieniem)", async () => {
      const { error } = await owner
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Podszywacz", slug: "cennik" });
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
      expect(error?.message).toContain("przekierowuje");
    });

    it("blokada działa też na UPDATE istniejącej strony", async () => {
      const inna = await createPage(owner, tenantId, "wolny-adres");
      const { error } = await owner
        .from("sites")
        .update({ slug: "cennik" })
        .eq("tenant_id", tenantId)
        .eq("id", inna);
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
    });

    it("KONTROLA POZYTYWNA: strona, która ten adres zostawiła, może pod niego wrócić", async () => {
      // Bez tego „wszystko zablokowane" wyglądałoby jak działająca bramka,
      // a najemca nie miałby jak cofnąć własnej pomyłki.
      const { error } = await owner
        .from("sites")
        .update({ slug: "cennik" })
        .eq("tenant_id", tenantId)
        .eq("id", siteId);
      expect(error, `powrót pod dawny adres zablokowany: ${error?.message}`).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 4. Checkbox „przekieruj stary adres"
  // -------------------------------------------------------------------
  it("wyłączone przekierowanie NIE zapisuje historii i zwalnia adres", async () => {
    const tenantId = await seedTenant("bezprzekierowania");
    const owner = await ownerClient(tenantId);
    const siteId = await createPage(owner, tenantId, "pomylka");
    await publish(owner, siteId);

    const { error } = await owner
      .from("sites")
      .update({ slug: "wlasciwy", redirect_old_slug: false })
      .eq("tenant_id", tenantId)
      .eq("id", siteId);
    expect(error).toBeNull();
    await publish(owner, siteId);

    expect((await registry(tenantId))?.redirects).toEqual([]);

    // Adres bez wpisu w historii jest WOLNY — inna strona może go wziąć.
    const inna = await createPage(owner, tenantId, "pomylka");
    expect(inna).toBeTruthy();
  }, 120_000);

  // -------------------------------------------------------------------
  // 5. Izolacja: adresy są per NAJEMCA, bo per host
  // -------------------------------------------------------------------
  it("historia najemcy A nie wychodzi w rejestrze najemcy B ani nie blokuje mu adresu", async () => {
    const tenantA = await seedTenant("iz-a");
    const ownerA = await ownerClient(tenantA);
    const siteA = await createPage(ownerA, tenantA, "wynajem");
    await publish(ownerA, siteA);
    await moveTo(ownerA, tenantA, siteA, "wynajem-sprzetu");

    const tenantB = await seedTenant("iz-b");
    const ownerB = await ownerClient(tenantB);

    const rejestrB = await registry(tenantB);
    expect(rejestrB?.redirects, "przekierowanie najemcy A wyszło u najemcy B").toEqual([]);

    // Najemca B MOŻE wziąć adres, który u A jest przekierowaniem: sklepy stoją
    // na różnych hostach, więc adresy nie kolidują. Blokada dotyczy WYŁĄCZNIE
    // wnętrza jednego najemcy.
    const siteB = await createPage(ownerB, tenantB, "wynajem");
    await publish(ownerB, siteB);
    expect((await registry(tenantB))?.pages).toEqual(["wynajem"]);

    // KONTROLA POZYTYWNA: u najemcy A przekierowanie dalej stoi.
    expect((await registry(tenantA))?.redirects).toEqual([
      { from: "wynajem", to: "wynajem-sprzetu" },
    ]);
  }, 120_000);
});
