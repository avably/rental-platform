/**
 * ZDJĘCIE STRONY ZE SKLEPU — migracja 0078, ADR-170.
 *
 * Do 0078 czasownika zdjęcia NIE BYŁO: `published_at` zerowało wyłącznie zdanie
 * gaszące w `app.publish_site`, usunięte przez 0074. Strona opublikowana przez
 * pomyłkę zostawała w sklepie na zawsze, bo usunięcia żywej strony (słusznie)
 * broni trigger, a jego rada „najpierw opublikuj inną" od 0074 nie zmienia
 * w statusie tej strony ani jednego bitu.
 *
 * Sześć osi, każda mierzona TYM, CO WIDZI KLIENT (koperta `app.get_published_page`
 * i rejestr `app.get_tenant_pages` kluczem anona), a nie stanem wiersza:
 *
 *   1. ZDJĘCIE DZIAŁA I WIDAĆ JE W SKLEPIE. Strona znika z koperty i z rejestru
 *      adresów; wiersz i jego bliźniaki `*_published` ZOSTAJĄ (ADR-093 D2),
 *      więc ponowna publikacja przywraca stronę bez odbudowy treści.
 *
 *   2. PRZEKIEROWANIA GASNĄ RAZEM ZE STRONĄ. 308 pod adres oddający 404 jest
 *      gorsze niż jego brak (ADR-159) — a od 0078 ten stan osiąga się
 *      CZASOWNIKIEM, nie surowym UPDATE-em udającym go w teście.
 *
 *   3. BRAMKĄ ZOSTAJE BAZA. Ręczne `update sites set published_at = null`
 *      członkiem odbija się o strażnika kolumn opublikowanych (42501). RPC nie
 *      jest wygodą, tylko jedyną drogą.
 *
 *   4. ZDJĘCIE WYMAGA TEGO SAMEGO UPRAWNIENIA, CO PUBLIKACJA — żywego
 *      członkostwa. Konto z ważnym tokenem, ale bez wiersza w `members`, nie
 *      zdejmie własnej strony.
 *
 *   5. IZOLACJA STOI W CIELE CZASOWNIKA. Funkcja jest SECURITY DEFINER, więc
 *      RLS w niej nie uczestniczy: jedyną bramką jest jawne zawężenie
 *      `tenant_id = app.tenant_id()`. Najemca B nie zdejmie strony najemcy A.
 *
 *   6. ZDJĘCIE ODBLOKOWUJE USUNIĘCIE — i to jest cała droga wyjścia ze stanu
 *      „strona opublikowana przez pomyłkę". Odmowa usunięcia żywej strony
 *      wskazuje odtąd ten czasownik, a nie czynność, która nic nie robi.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const PG_INVALID_PARAMETER = "22023";
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "Unpublish!12345678";

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

const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

describe.skipIf(!hasEnv)("zdjęcie strony ze sklepu — 0078 (ADR-170)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `unpub-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Zdjęcie ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(
    tenantId: string,
  ): Promise<{ client: SupabaseClient; userId: string }> {
    const email = `unpub-${randomUUID().slice(0, 8)}@test.local`;
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
    return { client, userId: data.user.id };
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
    // Sekcja jest po to, żeby koperta miała czym się różnić od pustej.
    const { error: sectionError } = await admin.from("site_sections").insert({
      tenant_id: tenantId,
      site_id: data.id as string,
      type: "hero",
      position: 0,
      content_draft: { heading: `Nagłówek ${slug || "glownej"}` },
    });
    if (sectionError) throw new Error(`insert site_sections: ${sectionError.message}`);
    return data.id as string;
  }

  async function publish(owner: SupabaseClient, siteId: string): Promise<void> {
    const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: siteId });
    if (error) throw new Error(`publish_site: ${error.message}`);
  }

  async function unpublish(
    owner: SupabaseClient,
    siteId: string,
  ): Promise<{ code?: string; message: string } | null> {
    const { error } = await owner.schema("app").rpc("unpublish_site", { p_site_id: siteId });
    return error ? { code: error.code, message: error.message } : null;
  }

  /** To, co widzi KLIENT pod adresem — kluczem anona, drogą storefrontu. */
  async function publicPage(tenantId: string, slug: string): Promise<unknown | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_page", { p_tenant_id: tenantId, p_slug: slug });
    if (error) throw new Error(`get_published_page: ${error.message}`);
    return data ?? null;
  }

  async function registry(tenantId: string): Promise<PageRegistry | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_tenant_pages", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_tenant_pages: ${error.message}`);
    return (data as PageRegistry | null) ?? null;
  }

  async function siteRow(siteId: string) {
    const { data, error } = await admin
      .from("sites")
      .select("published_at, slug, slug_published")
      .eq("id", siteId)
      .single();
    if (error || !data) throw new Error(`odczyt wiersza strony: ${error?.message}`);
    return data as { published_at: string | null; slug: string; slug_published: string | null };
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Zdjęcie działa i widać je w sklepie
  // -------------------------------------------------------------------
  describe("strona przestaje być dostępna pod swoim adresem", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("sklep");
      owner = (await ownerClient(tenantId)).client;
      siteId = await createPage(owner, tenantId, "kontakt");
      await publish(owner, siteId);
    }, 120_000);

    it("PRZED zdjęciem klient widzi stronę pod jej adresem", async () => {
      // Kontrola pozytywna: bez niej „klient nic nie widzi" niżej mogłoby
      // znaczyć „nigdy nic nie widział".
      expect(await publicPage(tenantId, "kontakt")).not.toBeNull();
      expect((await registry(tenantId))?.pages).toContain("kontakt");
    });

    it("PO zdjęciu adres nie oddaje już strony, a rejestr proxy jej nie zna", async () => {
      expect(await unpublish(owner, siteId)).toBeNull();

      expect(await publicPage(tenantId, "kontakt"), "klient dalej widzi zdjętą stronę").toBeNull();
      expect((await registry(tenantId))?.pages).not.toContain("kontakt");
    });

    it("bliźniaki ZOSTAJĄ — zdjęcie to nie usunięcie (ADR-093 D2)", async () => {
      const row = await siteRow(siteId);
      expect(row.published_at, "published_at nie zgasło").toBeNull();
      // Zerowanie slug_published wyzwoliłoby sites_record_slug_history i wpisało
      // dawny adres do historii — czyli ZABLOKOWAŁO go dla każdej innej strony
      // najemcy, mimo że sam oddaje 404.
      expect(row.slug_published, "zdjęcie skasowało opublikowany adres").toBe("kontakt");

      const { count } = await admin
        .from("site_sections")
        .select("id", { count: "exact", head: true })
        .eq("site_id", siteId)
        .not("content_published", "is", null);
      expect(count, "zdjęcie skasowało opublikowaną treść sekcji").toBe(1);
    });

    it("zdjęcie jest IDEMPOTENTNE — drugie wywołanie nie jest błędem", async () => {
      expect(await unpublish(owner, siteId)).toBeNull();
      expect(await publicPage(tenantId, "kontakt")).toBeNull();
    });

    it("ponowna publikacja przywraca stronę klientowi", async () => {
      await publish(owner, siteId);
      expect(await publicPage(tenantId, "kontakt")).not.toBeNull();
      expect((await registry(tenantId))?.pages).toContain("kontakt");
    });
  });

  // -------------------------------------------------------------------
  // 2. Przekierowania gasną razem ze stroną
  // -------------------------------------------------------------------
  describe("historia adresów zostaje spójna", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("historia");
      owner = (await ownerClient(tenantId)).client;
      siteId = await createPage(owner, tenantId, "cennik");
      await publish(owner, siteId);
      // Przeprowadzka zostawia 308 ze starego adresu (0075).
      const { error } = await owner
        .from("sites")
        .update({ slug: "cennik-2026" })
        .eq("tenant_id", tenantId)
        .eq("id", siteId);
      if (error) throw new Error(`zmiana adresu: ${error.message}`);
      await publish(owner, siteId);
    }, 120_000);

    it("PRZED zdjęciem stary adres prowadzi 308 do strony", async () => {
      expect((await registry(tenantId))?.redirects).toEqual([
        { from: "cennik", to: "cennik-2026" },
      ]);
    });

    it("zdjęcie gasi 308 — nie zostaje przekierowanie do strony spoza sklepu", async () => {
      expect(await unpublish(owner, siteId)).toBeNull();

      const po = await registry(tenantId);
      expect(po?.pages, "adres zdjętej strony został w rejestrze").not.toContain("cennik-2026");
      expect(po?.redirects, "308 prowadzi do strony, której nie ma w sklepie").toEqual([]);
    });

    it("wpis historii ZOSTAJE — ponowna publikacja wskrzesza przekierowanie", async () => {
      // Kasowanie historii przy zdjęciu byłoby utratą danych za jedno
      // odświeżenie rejestru: adres nie przekierowuje, dopóki cel nie jest żywy.
      await publish(owner, siteId);
      expect((await registry(tenantId))?.redirects).toEqual([
        { from: "cennik", to: "cennik-2026" },
      ]);
    });
  });

  // -------------------------------------------------------------------
  // 3-4. Bramką zostaje baza; zdjęcie wymaga żywego członkostwa
  // -------------------------------------------------------------------
  describe("bramka i uprawnienie", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let userId: string;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("bramka");
      const created = await ownerClient(tenantId);
      owner = created.client;
      userId = created.userId;
      siteId = await createPage(owner, tenantId, "regulamin-wynajmu");
      await publish(owner, siteId);
    }, 120_000);

    it("ręczne zerowanie published_at odbija się o strażnika (42501)", async () => {
      const { error } = await owner
        .from("sites")
        .update({ published_at: null })
        .eq("tenant_id", tenantId)
        .eq("id", siteId);
      expect(error?.code, "członek zgasił stronę z pominięciem czasownika").toBe(
        PG_INSUFFICIENT_PRIVILEGE,
      );
      expect((await siteRow(siteId)).published_at).not.toBeNull();
    });

    it("konto BEZ żywego członkostwa nie zdejmie strony (22023)", async () => {
      // Organizacja musi zostać z właścicielem (CHECK z 0061), więc najpierw
      // wchodzi drugi — inaczej mierzylibyśmy tamten więz, a nie uprawnienie.
      await ownerClient(tenantId);

      // Token dalej niesie claim tenanta — znika wyłącznie wiersz w `members`,
      // czyli dokładnie to uprawnienie, którego wymaga publikacja.
      const { error: removeError } = await admin
        .from("members")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("user_id", userId);
      expect(removeError).toBeNull();

      const denial = await unpublish(owner, siteId);
      expect(denial?.code, "były członek zdjął stronę ze sklepu").toBe(PG_INVALID_PARAMETER);
      expect((await siteRow(siteId)).published_at).not.toBeNull();
      expect(await publicPage(tenantId, "regulamin-wynajmu")).not.toBeNull();

      // Przywrócenie członkostwa: ta sama operacja przechodzi — czyli odmowa
      // wyżej padła z powodu uprawnienia, a nie z powodu stanu strony.
      const { error: restoreError } = await admin
        .from("members")
        .insert({ tenant_id: tenantId, user_id: userId, role: "owner" });
      expect(restoreError).toBeNull();
      expect(await unpublish(owner, siteId)).toBeNull();
      expect(await publicPage(tenantId, "regulamin-wynajmu")).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 5. Izolacja stoi w CIELE czasownika
  // -------------------------------------------------------------------
  describe("izolacja najemców", () => {
    let tenantA: string;
    let tenantB: string;
    let ownerB: SupabaseClient;
    let siteA: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantA = await seedTenant("a");
      tenantB = await seedTenant("b");
      const a = await ownerClient(tenantA);
      ownerB = (await ownerClient(tenantB)).client;
      siteA = await createPage(a.client, tenantA, "oferta");
      await publish(a.client, siteA);
    }, 120_000);

    it("najemca B nie zdejmie strony najemcy A", async () => {
      const denial = await unpublish(ownerB, siteA);
      expect(denial?.code, "cudza strona zdjęta ze sklepu").toBe(PG_INVALID_PARAMETER);
      expect(
        await publicPage(tenantA, "oferta"),
        "strona najemcy A zniknęła klientom przez cudze wywołanie",
      ).not.toBeNull();
      expect((await siteRow(siteA)).published_at).not.toBeNull();
    });

    it("odmowa nie zdradza, czy taka strona istnieje", async () => {
      const nieistniejaca = await unpublish(ownerB, randomUUID());
      const cudza = await unpublish(ownerB, siteA);
      expect(nieistniejaca?.code).toBe(cudza?.code);
      expect(nieistniejaca?.message).toBe(cudza?.message);
    });

    it("rejestr najemcy B nie zmienił się ani o wpis", async () => {
      expect((await registry(tenantB))?.pages).toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // 6. Zdjęcie odblokowuje usunięcie
  // -------------------------------------------------------------------
  describe("droga wyjścia ze strony opublikowanej przez pomyłkę", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let siteId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("pomylka");
      owner = (await ownerClient(tenantId)).client;
      siteId = await createPage(owner, tenantId, "pomylka");
      await publish(owner, siteId);
    }, 120_000);

    it("usunięcia ŻYWEJ strony dalej broni trigger — i wskazuje czasownik, który istnieje", async () => {
      const { error } = await owner
        .from("sites")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", siteId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      expect(error?.message).toContain("zdejmij ją ze sklepu");
      // Rada, która od 0074 nic nie robi, ma zniknąć z bazy, a nie tylko
      // z panelu: to jest ten sam tekst, który operator zobaczy przez PostgREST.
      expect(error?.message, "baza dalej radzi czynność, która nic nie zmienia").not.toContain(
        "opublikuj inną",
      );
    });

    it("po zdjęciu ze sklepu ta sama strona daje się usunąć", async () => {
      expect(await unpublish(owner, siteId)).toBeNull();

      const { error } = await owner
        .from("sites")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", siteId);
      expect(error, `usunięcie zdjętej strony: ${error?.message}`).toBeNull();

      const { count } = await admin
        .from("sites")
        .select("id", { count: "exact", head: true })
        .eq("id", siteId);
      expect(count).toBe(0);
    });
  });
});
