/**
 * WYJĄTEK STRONY PRODUKTU — migracja 0088, ADR-199 (faza 6A).
 *
 * Faza 6 architektury kreatora daje najemcy WYJĄTEK: osobny wiersz `sites`
 * przypięty do produktu PO ID, który opublikowany wygrywa z szablonem-matką
 * na stronie tego jednego produktu. Ten plik mierzy KOMPLET niezmienników
 * fazy A — schemat i rozstrzyganie; kreator forka i panel to faza B.
 *
 * Siedem osi, każda mierzona TYM, CO WIDZI KLIENT (koperta
 * `app.get_published_product_template` kluczem anona) albo tym, co baza
 * ODMAWIA (SQLSTATE), a nie stanem wiersza:
 *
 *   1. REPREZENTOWALNOŚĆ. Wyjątek istnieje wyłącznie w roli `product`
 *      (CHECK, 23514) i wyłącznie dla produktu WŁASNEGO najemcy (FK złożony,
 *      23503) — cudzy produkt jest niereprezentowalny na poziomie
 *      constraintu, zanim jakakolwiek polityka się wypowie.
 *
 *   2. ROZSTRZYGANIE: WYJĄTEK > MATKA > NULL. Plus okno wdrożeniowe:
 *      wywołanie BEZ `p_product_id` (stary kod co do bajta) oddaje matkę
 *      i NIGDY wyjątek — stary sklep nie ma prawa zobaczyć nowej treści.
 *
 *   3. GRANICA PO PUBLIKACJI. Wyjątek-szkic nie wygrywa z niczym; wyjątek
 *      opublikowany bez matki nie robi z siebie matki.
 *
 *   4. NIEZMIENNOŚĆ `product_id` — druga połowa tożsamości wiersza (0080 dał
 *      pierwszą): przypięcia nie zmienia nikt, w żadną stronę (42501),
 *      a patch NIEDOTYKAJĄCY przypięcia przechodzi — inaczej publikacja
 *      umarłaby na pierwszym UPDATE (pułapka z 0080).
 *
 *   5. LIMIT 5 NA NAJEMCĘ (trigger — CHECK nie policzy wierszy): szósty
 *      PRODUKT z wyjątkiem odbity PT409 z hintem-tokenem, piąty przechodzi;
 *      drugi szkic produktu już policzonego limitu nie zjada.
 *
 *   6. UNIKATY ŻYWYCH: matka i wyjątek współistnieją żywe (zawężenie
 *      indeksu matki), dwa wyjątki różnych produktów współistnieją żywe,
 *      drugi żywy wyjątek TEGO SAMEGO produktu pada 23505.
 *
 *   7. LOS PO USUNIĘCIU PRODUKTU (model zaobserwowany: hard delete istnieje
 *      w bazie — grant + polityka tenant_delete z 0007/0060): wyjątek
 *      kaskaduje razem z produktem, TAKŻE żywy — kaskada wykonuje się
 *      w kontekście właściciela tabeli, czyli przepustką serwisową
 *      guard_live_site_delete (ten sam kanał, co kaskada z tenants);
 *      produkt zdezaktywowany (`active=false`) zostawia wyjątek
 *      nieszkodliwie osierocony, bo trasa sklepu nie pyta o szablon
 *      pozycji, której nie ma w katalogu publicznym.
 *
 *   Izolacja najemców ma osobny opis (sekcja 8): wyjątek najemcy A nie
 *   wychodzi na sklep najemcy B ani jednym bajtem, z kontrolą pozytywną.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PAGE_SITE_KIND, PRODUCT_TEMPLATE_SITE_KIND } from "@avably/core/site";

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

/** 23503 = foreign_key_violation. */
const PG_FOREIGN_KEY_VIOLATION = "23503";
/** 23505 = unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 = check_violation. */
const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — odmowa RLS, grantu albo strażnika. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";
/**
 * PT409 = limit produktów z własną stroną (0088). Konwencja PTnnn
 * PostgREST-a, bo zmierzone: kody P0xxx poza P0001 wychodzą przez PostgREST
 * jako zamaskowane 500 „Something went wrong" — bez kodu i bez komunikatu.
 */
const PG_EXCEPTION_LIMIT = "PT409";
/** Token maszynowy odmowy limitu — panel fazy B dopasowuje po nim, nie po zdaniu. */
const EXCEPTION_LIMIT_HINT = "sites_product_exception_limit";

const TEST_PASSWORD = "ProductException!12345678";

interface Envelope {
  template: string;
  published_at: string;
  sections: { id: string; type: string; position: number; content: unknown }[];
  style?: unknown;
  logo?: unknown;
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

describe.skipIf(!hasEnv)("wyjątek strony produktu — 0088 (ADR-199)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `wyj-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Wyjątek ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(tenantId: string): Promise<SupabaseClient> {
    const email = `wyj-${randomUUID().slice(0, 8)}@test.local`;
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

  /** Pozycja katalogu — rodzic wyjątku. Slug generuje trigger z nazwy (0083). */
  async function createProduct(tenantId: string): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name: `Sprzęt ${randomUUID().slice(0, 8)}`,
        base_price_day_grosze: 10_000,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert products: ${error?.message}`);
    return data.id as string;
  }

  /**
   * Wiersz `sites` w dowolnej roli — z przypięciem do produktu albo bez.
   * `heading` jedzie do treści sekcji, żeby koperty miały czym się różnić:
   * asercja „to wyjątek, a nie matka" porównuje TREŚĆ, nie kształt.
   */
  async function createSite(
    owner: SupabaseClient,
    tenantId: string,
    options: {
      kind?: string;
      slug?: string;
      productId?: string | null;
      heading?: string;
      sections?: boolean;
    } = {},
  ): Promise<string> {
    const kind = options.kind ?? PRODUCT_TEMPLATE_SITE_KIND;
    const { data, error } = await owner
      .from("sites")
      .insert({
        tenant_id: tenantId,
        name: `Wiersz ${kind} ${randomUUID().slice(0, 6)}`,
        slug: options.slug ?? "",
        kind,
        product_id: options.productId ?? null,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`insert sites (${kind}): ${error?.message}`);

    if (options.sections !== false) {
      const { error: sectionError } = await admin.from("site_sections").insert({
        tenant_id: tenantId,
        site_id: data.id as string,
        type: "hero",
        position: 0,
        content_draft: { heading: options.heading ?? `Nagłówek ${kind}` },
      });
      if (sectionError) throw new Error(`insert site_sections: ${sectionError.message}`);
    }
    return data.id as string;
  }

  async function publish(owner: SupabaseClient, siteId: string): Promise<void> {
    const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: siteId });
    if (error) throw new Error(`publish_site: ${error.message}`);
  }

  /**
   * To, co widzi KLIENT na stronie sprzętu — kluczem anona, drogą sklepu.
   * `productId` pominięty = wywołanie STAREGO kodu co do bajta (okno
   * wdrożeniowe): PostgREST uzupełnia `p_product_id` domyślką z bazy.
   */
  async function publicTemplate(tenantId: string, productId?: string): Promise<Envelope | null> {
    const args: Record<string, string> =
      productId === undefined
        ? { p_tenant_id: tenantId }
        : { p_tenant_id: tenantId, p_product_id: productId };
    const { data, error } = await anon
      .schema("app")
      .rpc("get_published_product_template", args);
    if (error) throw new Error(`get_published_product_template: ${error.message}`);
    return (data as Envelope | null) ?? null;
  }

  /** Nagłówki sekcji koperty — najkrótsze zdanie o TREŚCI, którą klient dostał. */
  function headings(envelope: Envelope | null): string[] {
    return (envelope?.sections ?? []).map(
      (section) => (section.content as { heading?: string } | null)?.heading ?? "",
    );
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Reprezentowalność wyjątku
  // -------------------------------------------------------------------
  describe("wyjątek istnieje tylko w roli `product` i tylko dla własnego produktu", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("repr");
      owner = await ownerClient(tenantId);
      productId = await createProduct(tenantId);
    }, 60_000);

    it("strona treściowa z przypiętym produktem pada na CHECK-u (23514)", async () => {
      const { error } = await owner.from("sites").insert({
        tenant_id: tenantId,
        name: "Strona z produktem",
        slug: "nie-wyjatek",
        kind: PAGE_SITE_KIND,
        product_id: productId,
      });
      expect(error?.code).toBe(PG_CHECK_VIOLATION);
    });

    it("KONTROLA POZYTYWNA: ta sama para w roli `product` przechodzi", async () => {
      const siteId = await createSite(owner, tenantId, { productId, sections: false });
      expect(siteId).toBeTruthy();
      await admin.from("sites").delete().eq("id", siteId);
    });

    it("wyjątek wskazujący CUDZY produkt jest niereprezentowalny (23503, constraint — nie polityka)", async () => {
      // Wstawka rolą SERWISOWĄ świadomie: service_role omija RLS i przepustki
      // strażników, więc jedyną bramką, która tu zostaje, jest FK złożony
      // (tenant_id, product_id) — dokładnie ta, którą mierzymy.
      const obcy = await seedTenant("repr-obcy");
      const cudzyProdukt = await createProduct(obcy);
      const { error } = await admin.from("sites").insert({
        tenant_id: tenantId,
        name: "Wyjątek cudzego produktu",
        slug: "",
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        product_id: cudzyProdukt,
      });
      expect(error?.code).toBe(PG_FOREIGN_KEY_VIOLATION);
    });
  });

  // -------------------------------------------------------------------
  // 2 + 3. Rozstrzyganie i granica publikacji
  // -------------------------------------------------------------------
  describe("rozstrzyganie: wyjątek > szablon-matka > null, granica po publikacji", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productX: string;
    let productY: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("drabina");
      owner = await ownerClient(tenantId);
      productX = await createProduct(tenantId);
      productY = await createProduct(tenantId);

      const matka = await createSite(owner, tenantId, { heading: "MATKA" });
      await publish(owner, matka);
    }, 60_000);

    it("brak wyjątku → każda pozycja dostaje matkę (stan zastany fazy 5)", async () => {
      expect(headings(await publicTemplate(tenantId, productX))).toEqual(["MATKA"]);
      expect(headings(await publicTemplate(tenantId, productY))).toEqual(["MATKA"]);
    });

    it("wyjątek-SZKIC nie wygrywa z niczym (granica po publikacji, nie po istnieniu)", async () => {
      const szkic = await createSite(owner, tenantId, {
        productId: productX,
        heading: "WYJĄTEK-SZKIC",
      });
      expect(headings(await publicTemplate(tenantId, productX))).toEqual(["MATKA"]);
      await admin.from("sites").delete().eq("id", szkic);
    });

    it("opublikowany wyjątek wygrywa DLA SWOJEGO produktu, matka zostaje dla reszty", async () => {
      const wyjatek = await createSite(owner, tenantId, {
        productId: productX,
        heading: "WYJĄTEK-X",
      });
      await publish(owner, wyjatek);

      expect(headings(await publicTemplate(tenantId, productX))).toEqual(["WYJĄTEK-X"]);
      expect(headings(await publicTemplate(tenantId, productY))).toEqual(["MATKA"]);
    });

    it("OKNO WDROŻENIOWE: wywołanie bez p_product_id oddaje matkę i NIGDY wyjątek", async () => {
      // Stary kod woła po staremu i nie ma prawa zobaczyć nowej treści —
      // ani jako wyniku, ani jako niedeterministycznego wyboru z dwóch.
      const envelope = await publicTemplate(tenantId);
      expect(headings(envelope)).toEqual(["MATKA"]);
      expect(JSON.stringify(envelope)).not.toContain("WYJĄTEK-X");
    });

    it("najemca bez matki i bez wyjątku → null (sklep oddaje stronę wbudowaną)", async () => {
      const pusty = await seedTenant("drabina-pusty");
      const pustyProdukt = await createProduct(pusty);
      expect(await publicTemplate(pusty, pustyProdukt)).toBeNull();
    });

    it("wyjątek bez matki: swój produkt dostaje wyjątek, KAŻDY inny null — a stary kod null", async () => {
      // Wyjątek nie robi z siebie matki: `product_id` nie wchodzi w gałąź
      // `is null`, więc pozycje bez wyjątku spadają na stronę wbudowaną.
      const sam = await seedTenant("drabina-sam");
      const samOwner = await ownerClient(sam);
      const samX = await createProduct(sam);
      const samY = await createProduct(sam);
      const wyjatek = await createSite(samOwner, sam, {
        productId: samX,
        heading: "SAM-WYJĄTEK",
      });
      await publish(samOwner, wyjatek);

      expect(headings(await publicTemplate(sam, samX))).toEqual(["SAM-WYJĄTEK"]);
      expect(await publicTemplate(sam, samY)).toBeNull();
      expect(await publicTemplate(sam)).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 4. Niezmienność product_id
  // -------------------------------------------------------------------
  describe("przypięcia do produktu nie da się zmienić po utworzeniu", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productA: string;
    let productB: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("niezmienna");
      owner = await ownerClient(tenantId);
      productA = await createProduct(tenantId);
      productB = await createProduct(tenantId);
    }, 60_000);

    it("przepięcie wyjątku pod inny produkt pada 42501", async () => {
      const siteId = await createSite(owner, tenantId, { productId: productA, sections: false });
      const { error } = await owner
        .from("sites")
        .update({ product_id: productB })
        .eq("id", siteId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      await admin.from("sites").delete().eq("id", siteId);
    });

    it("zdjęcie przypięcia (wyjątek → matka) pada 42501", async () => {
      // NULL zrobiłby z wyjątku DRUGĄ matkę — czyli podmianę treści KAŻDEJ
      // strony sprzętu jednym UPDATE, bez zdarzenia publikacji.
      const siteId = await createSite(owner, tenantId, { productId: productA, sections: false });
      const { error } = await owner.from("sites").update({ product_id: null }).eq("id", siteId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      await admin.from("sites").delete().eq("id", siteId);
    });

    it("dopięcie produktu do MATKI (matka → wyjątek) pada 42501, nie na CHECK-u", async () => {
      // CHECK tej pary nie zatrzymuje (rola się zgadza) — bez gałęzi
      // strażnika żywa matka dawałaby się „zwinąć" do wyjątku jednym UPDATE.
      const siteId = await createSite(owner, tenantId, { sections: false });
      const { error } = await owner
        .from("sites")
        .update({ product_id: productA })
        .eq("id", siteId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
      await admin.from("sites").delete().eq("id", siteId);
    });

    it("KONTROLA POZYTYWNA: patch niedotykający przypięcia przechodzi, publikacja też", async () => {
      // Pułapka z 0080: strażnik porównujący przez gołe `<>` zamiast
      // IS DISTINCT FROM zabiłby każdy UPDATE wiersza — z publikacją włącznie.
      const siteId = await createSite(owner, tenantId, {
        productId: productA,
        heading: "Przed publikacją",
      });
      const { data, error } = await owner
        .from("sites")
        .update({ name: "Nazwa po zmianie" })
        .eq("id", siteId)
        .select("id");
      expect(error).toBeNull();
      expect(data ?? []).toHaveLength(1);

      await publish(owner, siteId);
      expect(headings(await publicTemplate(tenantId, productA))).toEqual(["Przed publikacją"]);
    });
  });

  // -------------------------------------------------------------------
  // 5. Limit 5 produktów z własną stroną
  // -------------------------------------------------------------------
  describe("limit 5 wyjątków egzekwuje baza, nie interfejs", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    const productIds: string[] = [];

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("limit");
      owner = await ownerClient(tenantId);
      for (let i = 0; i < 6; i += 1) productIds.push(await createProduct(tenantId));
    }, 60_000);

    it("pięć wyjątków przechodzi (granica NALEŻY do najemcy), szósty PRODUKT pada PT409", async () => {
      for (let i = 0; i < 5; i += 1) {
        await createSite(owner, tenantId, { productId: productIds[i], sections: false });
      }

      const { error } = await owner.from("sites").insert({
        tenant_id: tenantId,
        name: "Szósty wyjątek",
        slug: "",
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        product_id: productIds[5],
      });
      expect(error?.code).toBe(PG_EXCEPTION_LIMIT);
      // Hint jest kontraktem panelu fazy B — dopasowanie po tokenie, nie po
      // treści polskiego zdania, które ma prawo się zmieniać.
      expect(error?.hint).toBe(EXCEPTION_LIMIT_HINT);
    });

    it("drugi szkic produktu JUŻ policzonego limitu nie zjada (limit liczy produkty, nie wiersze)", async () => {
      const siteId = await createSite(owner, tenantId, {
        productId: productIds[0],
        sections: false,
      });
      expect(siteId).toBeTruthy();
      await admin.from("sites").delete().eq("id", siteId);
    });

    it("rola serwisowa przechodzi ponad limit (seedy i sprzątanie — limit to reguła produktu)", async () => {
      const { data, error } = await admin
        .from("sites")
        .insert({
          tenant_id: tenantId,
          name: "Serwisowy ponad limit",
          slug: "",
          kind: PRODUCT_TEMPLATE_SITE_KIND,
          product_id: productIds[5],
        })
        .select("id")
        .single();
      expect(error).toBeNull();
      if (data) await admin.from("sites").delete().eq("id", data.id as string);
    });

    it("matka i strony treściowe nie zjadają limitu (bramka mierzy wyłącznie wyjątki)", async () => {
      // Najemca z kompletem 5 wyjątków dalej może założyć matkę i stronę —
      // bez tej nogi limit „5 wyjątków" mógłby po cichu być limitem „5 stron".
      const matka = await createSite(owner, tenantId, { sections: false });
      const strona = await createSite(owner, tenantId, {
        kind: PAGE_SITE_KIND,
        slug: "strona-poza-limitem",
        sections: false,
      });
      expect(matka).toBeTruthy();
      expect(strona).toBeTruthy();
      await admin.from("sites").delete().eq("id", matka);
      await admin.from("sites").delete().eq("id", strona);
    });
  });

  // -------------------------------------------------------------------
  // 6. Unikaty żywych wierszy
  // -------------------------------------------------------------------
  describe("niezmienniki żywych: matka obok wyjątków, wyjątek na produkt jeden", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productX: string;
    let productY: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("unikaty");
      owner = await ownerClient(tenantId);
      productX = await createProduct(tenantId);
      productY = await createProduct(tenantId);
    }, 60_000);

    it("żywa MATKA i żywe WYJĄTKI dwóch produktów współistnieją (zawężenie indeksu matki)", async () => {
      // Gdyby indeks matki nie dostał `product_id is null`, TA sekwencja
      // padłaby 23505 na drugiej publikacji — klucz to sam najemca.
      const matka = await createSite(owner, tenantId, { heading: "MATKA" });
      await publish(owner, matka);

      const wx = await createSite(owner, tenantId, { productId: productX, heading: "WX" });
      await publish(owner, wx);

      const wy = await createSite(owner, tenantId, { productId: productY, heading: "WY" });
      await publish(owner, wy);

      expect(headings(await publicTemplate(tenantId, productX))).toEqual(["WX"]);
      expect(headings(await publicTemplate(tenantId, productY))).toEqual(["WY"]);
      expect(headings(await publicTemplate(tenantId))).toEqual(["MATKA"]);
    });

    it("DRUGI żywy wyjątek tego samego produktu pada 23505, a klient dalej dostaje pierwszy", async () => {
      const drugi = await createSite(owner, tenantId, {
        productId: productX,
        heading: "WX-DRUGI",
      });
      const { error } = await owner.schema("app").rpc("publish_site", { p_site_id: drugi });
      expect(error?.code).toBe(PG_UNIQUE_VIOLATION);

      // SKUTEK, nie tylko odmowa: wybór wiersza pozostaje deterministyczny.
      expect(headings(await publicTemplate(tenantId, productX))).toEqual(["WX"]);
      await admin.from("sites").delete().eq("id", drugi);
    });
  });

  // -------------------------------------------------------------------
  // 7. Los wyjątku po usunięciu produktu
  // -------------------------------------------------------------------
  describe("usunięcie produktu zabiera jego stronę; dezaktywacja osieroca ją nieszkodliwie", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("kasowanie");
      owner = await ownerClient(tenantId);
    }, 60_000);

    it("wyjątek-SZKIC znika razem z produktem (on delete cascade)", async () => {
      const productId = await createProduct(tenantId);
      const siteId = await createSite(owner, tenantId, { productId, sections: false });

      const { error } = await owner.from("products").delete().eq("id", productId);
      expect(error).toBeNull();

      const rows = await sql!`select id from public.sites where id = ${siteId}`;
      expect(rows).toHaveLength(0);
    });

    it("produkt z ŻYWYM wyjątkiem znika RAZEM ze stroną — kaskada jedzie kanałem serwisowym", async () => {
      /*
        ZMIERZONE, nie założone: trigger więzów referencyjnych wykonuje
        kaskadowy DELETE w kontekście WŁAŚCICIELA tabeli (postgres, członek
        service_role) — czyli przepustką, którą guard_live_site_delete
        przepuszcza Z NAZWY od 0048 („kaskada z tenants"). Strona żyje
        wyłącznie pod adresem produktu, więc po jego zniknięciu nie ma ani
        adresu, ani treści do ochrony — odmowa robiłaby z usunięcia produktu
        operację dwustopniową bez zysku.
      */
      const productId = await createProduct(tenantId);
      const siteId = await createSite(owner, tenantId, { productId, heading: "ŻYWY" });
      await publish(owner, siteId);
      expect(headings(await publicTemplate(tenantId, productId))).toEqual(["ŻYWY"]);

      const { error } = await owner.from("products").delete().eq("id", productId);
      expect(error).toBeNull();

      // SKUTEK: wiersz strony zniknął razem z produktem, sklep oddaje null
      // (stronę wbudowaną pod adresem, którego i tak już nie ma).
      const rows = await sql!`select id from public.sites where id = ${siteId}`;
      expect(rows).toHaveLength(0);
      expect(await publicTemplate(tenantId, productId)).toBeNull();
    });

    it("produkt ZDEZAKTYWOWANY osieroca wyjątek nieszkodliwie — katalog publiczny pozycji nie zna", async () => {
      // Panel „usuwa" dziś przez active=false. Wiersz wyjątku zostaje, ale
      // trasa sklepu pyta o szablon dopiero PO rozstrzygnięciu adresu pozycji
      // (app.get_public_product), a to dla pozycji nieaktywnej oddaje
      // match='none' → 404. Wyjątek bez trasy nie ma jak wyjść do klienta.
      const productId = await createProduct(tenantId);
      const siteId = await createSite(owner, tenantId, { productId, heading: "OSIEROCONY" });
      await publish(owner, siteId);

      await admin.from("products").update({ active: false }).eq("id", productId);

      const { data: koperta, error } = await anon.schema("app").rpc("get_public_product", {
        p_tenant_id: tenantId,
        p_slug: null,
        p_product_id: productId,
      });
      expect(error).toBeNull();
      expect((koperta as { match?: string } | null)?.match).toBe("none");
    });
  });

  // -------------------------------------------------------------------
  // 8. Izolacja najemców
  // -------------------------------------------------------------------
  describe("izolacja: wyjątek najemcy A nie wychodzi na sklep najemcy B", () => {
    let tenantA: string;
    let tenantB: string;
    let ownerA: SupabaseClient;
    let ownerB: SupabaseClient;
    let productA: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantA = await seedTenant("izo-a");
      tenantB = await seedTenant("izo-b");
      ownerA = await ownerClient(tenantA);
      ownerB = await ownerClient(tenantB);
      productA = await createProduct(tenantA);

      const wyjatekA = await createSite(ownerA, tenantA, {
        productId: productA,
        heading: "WYJĄTEK-NAJEMCY-A",
      });
      await publish(ownerA, wyjatekA);

      const matkaB = await createSite(ownerB, tenantB, { heading: "MATKA-NAJEMCY-B" });
      await publish(ownerB, matkaB);
    }, 90_000);

    it("sklep B pytający o PRODUKT A dostaje własną matkę — ani jednego bajtu wyjątku A", async () => {
      // Najostrzejsza asercja pliku: identyfikator produktu przychodzi
      // z adresu, więc jest w pełni pod kontrolą odwiedzającego. Tenant
      // przychodzi z proxy — i to ON musi rozstrzygać.
      const envelope = await publicTemplate(tenantB, productA);
      expect(headings(envelope)).toEqual(["MATKA-NAJEMCY-B"]);
      expect(JSON.stringify(envelope)).not.toContain("WYJĄTEK-NAJEMCY-A");
    });

    it("KONTROLA POZYTYWNA: skan wykrywa treść A, gdy pyta sklep A", async () => {
      // Bez tej nogi asercja wyżej byłaby spełniona także przez funkcję,
      // która nie oddaje niczego nikomu — czyli przez pustkę.
      expect(JSON.stringify(await publicTemplate(tenantA, productA))).toContain(
        "WYJĄTEK-NAJEMCY-A",
      );
    });

    it("sklep B BEZ matki pytający o produkt A dostaje null, nie cudzy wyjątek", async () => {
      const tenantC = await seedTenant("izo-c");
      expect(await publicTemplate(tenantC, productA)).toBeNull();
    });

    it("właściciel B nie odczyta wiersza wyjątku A przez PostgREST (RLS)", async () => {
      const { data, error } = await ownerB
        .from("sites")
        .select("id, product_id")
        .eq("tenant_id", tenantA)
        .not("product_id", "is", null);
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });

    it("właściciel B nie założy wyjątku na produkcie A — FK złożony tnie przed czymkolwiek (23503)", async () => {
      const { error } = await ownerB.from("sites").insert({
        tenant_id: tenantB,
        name: "Wyjątek na cudzym produkcie",
        slug: "",
        kind: PRODUCT_TEMPLATE_SITE_KIND,
        product_id: productA,
      });
      expect(error?.code).toBe(PG_FOREIGN_KEY_VIOLATION);
    });

    it("najemca poza oknem handlowym nie oddaje wyjątku w ogóle", async () => {
      await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantA);
      expect(await publicTemplate(tenantA, productA)).toBeNull();
      await admin.from("tenants").update({ status: "active" }).eq("id", tenantA);
      expect(await publicTemplate(tenantA, productA)).not.toBeNull();
    });
  });
});
