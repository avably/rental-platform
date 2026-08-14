/**
 * Adres sprzętu, historia adresów i przekierowania 308 — migracja 0083, ADR-182.
 *
 * Siedem osi, każda mierząca SKUTEK, nie obecność:
 *
 *   1. ZGODNOŚĆ LIST (anty-rozjazd). Segment `produkt` jest zarezerwowany
 *      w OBU listach bazy i w ich lustrze w rdzeniu. Bez tego strona treściowa
 *      najemcy o adresie `produkt` zapisałaby się bez błędu i nigdy nie
 *      wyświetliła — statyczna trasa Next wygrywa z dynamiczną.
 *
 *   2. LUSTRO NORMALIZACJI. `app.slugify` oddaje dokładnie to, co
 *      `suggestProductSlug` z rdzenia. Rozjazd znaczyłby, że formularz
 *      podpowiada inny adres, niż nadaje baza.
 *
 *   3. ADRES RODZI SIĘ Z NAZWY — W BAZIE. Sprzęt wstawiony BEZ sluga (tak
 *      robi panel sprzed tej zmiany i import CSV) dostaje adres z nazwy,
 *      a kolizja nazw daje sufiks, nie odmowę.
 *
 *   4. KSZTAŁT ADRESU. CHECK `products_slug_shape` jest lustrem
 *      PRODUCT_SLUG_PATTERN, a unikat działa PER NAJEMCA.
 *
 *   5. HISTORIA + 308. Zmiana adresu zostawia stary w rejestrze; sprzęt
 *      przenoszony kilka razy zostawia N adresów i każdy prowadzi do
 *      bieżącego; stary adres jest zablokowany do ponownego użycia, ale sprzęt,
 *      który go zostawił, może pod niego wrócić.
 *
 *   6. HISTORIA NIE JEST KANAŁEM PRZEJĘCIA ADRESU. `authenticated` nie ma na
 *      tabeli ani INSERT-u, ani UPDATE-u, ani DELETE-u — inaczej członek
 *      przekierowałby dowolny adres surowym PostgREST-em, z pominięciem
 *      jedynej ścieżki, która ten adres nadaje.
 *
 *   7. IZOLACJA. Dwaj najemcy o IDENTYCZNYM adresie sprzętu: każdy w swoim
 *      rejestrze dostaje własny sprzęt, historia jednego nie wychodzi
 *      u drugiego i nie blokuje mu adresu.
 *
 * OSOBNO: OKNO WDROŻENIOWE. Koperta `app.get_public_catalog` nie dostaje ani
 * jednego klucza — ani na górze, ani przy pozycji. To jest cała treść zdania
 * „kod sprzed tej zmiany przeżywa nową bazę": stary sklep parsuje kopertę
 * schematem, który nowego klucza nie zna, a migracja wchodzi na produkcję
 * PRZED kodem.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RESERVED_CATEGORY_SLUGS, suggestProductSlug } from "@avably/core";
import { RESERVED_PAGE_SLUGS } from "@avably/core/site";

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

/** 22023 = invalid_parameter_value — konwencja odmów 0010/0020/0023/0072/0073. */
const PG_INVALID_PARAMETER = "22023";
/** 23505 = unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** 23514 = check_violation. */
const PG_CHECK_VIOLATION = "23514";
/** 42501 = insufficient_privilege — odmowa RLS, grantu albo strażnika. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

const TEST_PASSWORD = "ProductSlug!12345678";

interface SlugRegistry {
  products: { id: string; slug: string }[];
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

describe.skipIf(!hasEnv)("adres sprzętu — 0083 (ADR-182)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `psl-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Adres sprzętu ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function ownerClient(tenantId: string): Promise<SupabaseClient> {
    const email = `psl-${randomUUID().slice(0, 8)}@test.local`;
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

  /** Wstawia sprzęt DOKŁADNIE tak, jak robi to panel: bez pola `slug`. */
  async function createProduct(
    client: SupabaseClient,
    tenantId: string,
    name: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; slug: string }> {
    const { data, error } = await client
      .from("products")
      .insert({ tenant_id: tenantId, name, base_price_day_grosze: 10_000, ...overrides })
      .select("id, slug")
      .single();
    if (error || !data) throw new Error(`insert products (${name}): ${error?.message}`);
    return { id: data.id as string, slug: data.slug as string };
  }

  async function moveTo(
    client: SupabaseClient,
    tenantId: string,
    productId: string,
    slug: string,
  ): Promise<void> {
    const { error } = await client
      .from("products")
      .update({ slug })
      .eq("tenant_id", tenantId)
      .eq("id", productId);
    if (error) throw new Error(`zmiana adresu na ${slug}: ${error.message}`);
  }

  async function registry(tenantId: string): Promise<SlugRegistry | null> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_product_slugs", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_public_product_slugs: ${error.message}`);
    return data as SlugRegistry | null;
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Zgodność list — segment `produkt` jest zarezerwowany
  // -------------------------------------------------------------------
  describe("segment `produkt` jest zarezerwowany", () => {
    it("stoi w OBU listach bazy i w obu lustrach rdzenia", async () => {
      const rows = await sql!<{ pages: string[]; store: string[] }[]>`
        select app.reserved_page_slugs() as pages, app.reserved_store_paths() as store
      `;
      // Czujnik po pustym zbiorze: bez niego „jest na liście" mogłoby znaczyć
      // „lista jest pusta i nic nie sprawdzamy".
      expect(rows[0]!.pages.length).toBeGreaterThan(10);
      expect(rows[0]!.store.length).toBeGreaterThan(10);

      expect(rows[0]!.pages, "brak `produkt` w app.reserved_page_slugs()").toContain("produkt");
      expect(rows[0]!.store, "brak `produkt` w app.reserved_store_paths()").toContain("produkt");
      expect(RESERVED_PAGE_SLUGS).toContain("produkt");
      expect(RESERVED_CATEGORY_SLUGS).toContain("produkt");
    });

    it("angielskie `product` ZOSTAJE — stare adresy dalej mają trasę", async () => {
      const rows = await sql!<{ pages: string[] }[]>`select app.reserved_page_slugs() as pages`;
      expect(rows[0]!.pages).toContain("product");
    });

    it("strona treściowa NIE weźmie adresu `produkt` (22023, ścieżką service_role)", async () => {
      const tenantId = await seedTenant("rezerwacja");
      const { error } = await admin
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Strona zajmująca trasę", slug: "produkt" });
      expect(error?.code, "slug `produkt` przeszedł").toBe(PG_INVALID_PARAMETER);
      expect(error?.message).toContain("produkt");
    });

    it("KONTROLA POZYTYWNA: podobny adres spoza listy przechodzi", async () => {
      // Bez tego „wszystko odrzucone" wyglądałoby jak działająca bramka.
      const tenantId = await seedTenant("rezerwacja-poz");
      const { error } = await admin
        .from("sites")
        .insert({ tenant_id: tenantId, name: "Produkty", slug: "produkty" });
      expect(error, `adres spoza listy zablokowany: ${error?.message}`).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 2. Lustro normalizacji: app.slugify == suggestProductSlug
  // -------------------------------------------------------------------
  describe("lustro normalizacji nazwy", () => {
    const NAZWY = [
      "Rower górski",
      "ŁÓDŹ Motorowa",
      'Rower górski 26"',
      "  Namiot   4-osobowy  ",
      "Café & Bar",
      "???",
      `${"a".repeat(58)} bbb`,
    ];

    it("app.slugify oddaje to samo, co suggestProductSlug z rdzenia", async () => {
      const rows = await sql!<{ nazwa: string; z_bazy: string }[]>`
        select n.nazwa, app.slugify(n.nazwa) as z_bazy
          from unnest(${sql!.array(NAZWY)}::text[]) as n(nazwa)
      `;
      expect(rows.length, "pusty zbiór wejściowy").toBe(NAZWY.length);
      const rozjazdy = rows
        .filter((row) => row.z_bazy !== suggestProductSlug(row.nazwa))
        .map((row) => `${row.nazwa}: baza=${row.z_bazy} rdzeń=${suggestProductSlug(row.nazwa)}`);
      expect(rozjazdy, "app.slugify (0083) rozjechało się z packages/core/src/slug.ts").toEqual([]);
    });
  });

  // -------------------------------------------------------------------
  // 3. Adres rodzi się z nazwy — w bazie, nie w formularzu
  // -------------------------------------------------------------------
  describe("adres rodzi się z nazwy", () => {
    let tenantId: string;
    let owner: SupabaseClient;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("nadanie");
      owner = await ownerClient(tenantId);
    }, 120_000);

    it("sprzęt wstawiony BEZ sluga dostaje adres z nazwy", async () => {
      // Tak wstawia panel SPRZED tej zmiany i import CSV — gdyby adres
      // powstawał wyłącznie w formularzu, w oknie wdrożeniowym rodziłby się
      // sprzęt bez adresu.
      const product = await createProduct(owner, tenantId, "Rower górski");
      expect(product.slug).toBe("rower-gorski");
    });

    it("druga pozycja o TEJ SAMEJ nazwie dostaje sufiks, nie odmowę", async () => {
      const drugi = await createProduct(owner, tenantId, "Rower górski");
      expect(drugi.slug).toBe("rower-gorski-2");
    });

    it("nazwa bez ani jednego znaku adresowalnego dostaje adres rodzajowy", async () => {
      const product = await createProduct(owner, tenantId, "???");
      expect(product.slug).toBe("sprzet");
    });

    it("operator MOŻE nadpisać adres przy wstawieniu", async () => {
      const product = await createProduct(owner, tenantId, "Namiot 4-osobowy", {
        slug: "namiot-rodzinny",
      });
      expect(product.slug).toBe("namiot-rodzinny");
    });

    it("wyczyszczenie pola adresu ODTWARZA go z nazwy, a nie zostawia pustki", async () => {
      const product = await createProduct(owner, tenantId, "Kajak dwuosobowy", { slug: "kajak-x" });
      await moveTo(owner, tenantId, product.id, "");
      const rows = await sql!<{ slug: string }[]>`
        select slug from public.products where id = ${product.id}::uuid
      `;
      expect(rows[0]!.slug).toBe("kajak-dwuosobowy");
    });
  });

  // -------------------------------------------------------------------
  // 4. Kształt adresu i unikat per najemca
  // -------------------------------------------------------------------
  describe("kształt adresu i unikat", () => {
    let tenantId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("ksztalt");
    }, 60_000);

    it.each([
      "Rower",
      "rower gorski",
      "-rower",
      "rower-",
      "rower--gorski",
      "rower/gorski",
      "rower.html",
      "rower_2",
      "rowerą",
      "a".repeat(61),
    ])("adres `%s` odrzucony CHECK-iem 23514", async (slug) => {
      const { error } = await admin
        .from("products")
        .insert({ tenant_id: tenantId, name: "Zły adres", base_price_day_grosze: 10_000, slug });
      expect(error?.code, `slug ${slug} przeszedł`).toBe(PG_CHECK_VIOLATION);
    });

    it("KONTROLA POZYTYWNA: poprawny adres przechodzi", async () => {
      const product = await createProduct(admin, tenantId, "Poprawny", { slug: "rower-gorski-26" });
      expect(product.slug).toBe("rower-gorski-26");
    });

    it("dwa sprzęty JEDNEGO najemcy pod tym samym adresem to 23505", async () => {
      await createProduct(admin, tenantId, "Pierwszy", { slug: "duplikat" });
      const { error } = await admin.from("products").insert({
        tenant_id: tenantId,
        name: "Drugi",
        base_price_day_grosze: 10_000,
        slug: "duplikat",
      });
      expect(error?.code).toBe(PG_UNIQUE_VIOLATION);
      expect(error?.message).toContain("products_slug_unique_idx");
    });
  });

  // -------------------------------------------------------------------
  // 5. Historia adresów i przekierowania 308
  // -------------------------------------------------------------------
  describe("zmiana adresu zostawia przekierowanie", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("historia");
      owner = await ownerClient(tenantId);
      productId = (await createProduct(owner, tenantId, "Rower", { slug: "rower" })).id;
    }, 120_000);

    it("rejestr PRZED zmianą nie ma ani jednego przekierowania", async () => {
      // Kontrola po pustym zbiorze: bez niej „są przekierowania" niżej mogłoby
      // znaczyć „zawsze są".
      const przed = await registry(tenantId);
      expect(przed?.products.map((entry) => entry.slug)).toEqual(["rower"]);
      expect(przed?.redirects).toEqual([]);
    });

    it("po zmianie adresu stary prowadzi 308 na nowy — TĄ SAMĄ kopertą", async () => {
      await moveTo(owner, tenantId, productId, "rower-gorski");

      const po = await registry(tenantId);
      expect(po?.products.map((entry) => entry.slug)).toEqual(["rower-gorski"]);
      expect(po?.redirects).toEqual([{ from: "rower", to: "rower-gorski" }]);
    });

    it("druga przeprowadzka zostawia OBA stare adresy", async () => {
      // Kolumna nie wystarczyłaby: sprzęt przenoszony kilka razy zostawia N
      // starych adresów i każdy ma dalej prowadzić do bieżącego.
      await moveTo(owner, tenantId, productId, "rower-gorski-2026");

      const po = await registry(tenantId);
      expect([...(po?.redirects ?? [])].sort((a, b) => a.from.localeCompare(b.from))).toEqual([
        { from: "rower", to: "rower-gorski-2026" },
        { from: "rower-gorski", to: "rower-gorski-2026" },
      ]);
    });

    it("przekierowanie GAŚNIE razem z pozycją — 308 na 404 jest gorsze niż brak", async () => {
      const { error } = await owner
        .from("products")
        .update({ active: false })
        .eq("tenant_id", tenantId)
        .eq("id", productId);
      expect(error, `wyłączenie pozycji: ${error?.message}`).toBeNull();

      const po = await registry(tenantId);
      expect(po?.products).toEqual([]);
      expect(po?.redirects).toEqual([]);

      await owner
        .from("products")
        .update({ active: true })
        .eq("tenant_id", tenantId)
        .eq("id", productId);
    });

    it("INNY sprzęt nie weźmie adresu, który przekierowuje (22023, z uzasadnieniem)", async () => {
      const { error } = await owner.from("products").insert({
        tenant_id: tenantId,
        name: "Podszywacz",
        base_price_day_grosze: 10_000,
        slug: "rower",
      });
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
      expect(error?.message).toContain("przekierowuje");
    });

    it("blokada działa też na UPDATE istniejącej pozycji", async () => {
      const inny = await createProduct(owner, tenantId, "Wolny adres", { slug: "wolny-adres" });
      const { error } = await owner
        .from("products")
        .update({ slug: "rower" })
        .eq("tenant_id", tenantId)
        .eq("id", inny.id);
      expect(error?.code).toBe(PG_INVALID_PARAMETER);
    });

    it("generator adresu OMIJA adres trzymany przez historię", async () => {
      // Bez tego wstawienie sprzętu o nazwie „Rower" padałoby odmową, której
      // operator niczym nie wywołał — a adres nadaje mu baza, nie on.
      const nowy = await createProduct(owner, tenantId, "Rower");
      expect(nowy.slug).not.toBe("rower");
      expect(nowy.slug).toBe("rower-2");
    });

    it("KONTROLA POZYTYWNA: sprzęt, który adres ZOSTAWIŁ, może pod niego wrócić", async () => {
      // Bez tego „wszystko zablokowane" wyglądałoby jak działająca bramka,
      // a najemca nie miałby jak cofnąć własnej pomyłki.
      await moveTo(owner, tenantId, productId, "rower");

      const po = await registry(tenantId);
      expect(po?.products.map((entry) => entry.slug)).toContain("rower");
      expect(
        po?.redirects.map((entry) => entry.from),
        "adres przekierowuje sam do siebie",
      ).not.toContain("rower");
    });
  });

  // -------------------------------------------------------------------
  // 6. Historia nie jest kanałem przejęcia adresu
  // -------------------------------------------------------------------
  describe("historia nie jest kanałem przejęcia adresu", () => {
    let tenantId: string;
    let owner: SupabaseClient;
    let productId: string;

    beforeAll(async () => {
      if (!hasEnv) return;
      tenantId = await seedTenant("kanal");
      owner = await ownerClient(tenantId);
      productId = (await createProduct(owner, tenantId, "Oferta", { slug: "oferta" })).id;
      await moveTo(owner, tenantId, productId, "oferta-2026");
    }, 120_000);

    it("członek WIDZI historię własnego najemcy (bramka adresu jej potrzebuje)", async () => {
      const { data, error } = await owner.from("product_slug_history").select("slug");
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.slug)).toEqual(["oferta"]);
    });

    it("członek NIE WSTAWI wiersza historii — brak grantu INSERT (42501)", async () => {
      const { error } = await owner
        .from("product_slug_history")
        .insert({ tenant_id: tenantId, product_id: productId, slug: "przejete" });
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("członek NIE PRZESTAWI istniejącego wiersza na inny sprzęt (42501)", async () => {
      const inny = await createProduct(owner, tenantId, "Inny sprzęt");
      const { error } = await owner
        .from("product_slug_history")
        .update({ product_id: inny.id })
        .eq("tenant_id", tenantId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);

      const rows = await sql!<{ product_id: string }[]>`
        select product_id from public.product_slug_history where tenant_id = ${tenantId}::uuid
      `;
      expect(rows[0]!.product_id, "przekierowanie zmieniło cel mimo odmowy").toBe(productId);
    });

    it("członek NIE SKASUJE wiersza historii (42501)", async () => {
      const { error } = await owner
        .from("product_slug_history")
        .delete()
        .eq("tenant_id", tenantId);
      expect(error?.code).toBe(PG_INSUFFICIENT_PRIVILEGE);
    });

    it("anon nie czyta tabeli historii wprost — jedyną drogą jest rejestr", async () => {
      const { data, error } = await anon.from("product_slug_history").select("slug");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // 7. IZOLACJA: dwaj najemcy o IDENTYCZNYM adresie sprzętu
  // -------------------------------------------------------------------
  it("ten sam adres u dwóch najemców wskazuje DWA RÓŻNE sprzęty", async () => {
    const tenantA = await seedTenant("iz-a");
    const ownerA = await ownerClient(tenantA);
    const tenantB = await seedTenant("iz-b");
    const ownerB = await ownerClient(tenantB);

    // Ten sam adres, dwa różne sprzęty. Sklepy stoją na różnych hostach, więc
    // to są dwa różne adresy — i żaden nie ma prawa wskazać cudzej pozycji.
    const rowerA = await createProduct(ownerA, tenantA, "Rower A", { slug: "rower-gorski" });
    const rowerB = await createProduct(ownerB, tenantB, "Rower B", { slug: "rower-gorski" });
    expect(rowerA.id).not.toBe(rowerB.id);

    const rejestrA = await registry(tenantA);
    const rejestrB = await registry(tenantB);

    expect(rejestrA?.products, "rejestr najemcy A nie ma jego sprzętu").toEqual([
      { id: rowerA.id, slug: "rower-gorski" },
    ]);
    expect(rejestrB?.products, "rejestr najemcy B nie ma jego sprzętu").toEqual([
      { id: rowerB.id, slug: "rower-gorski" },
    ]);

    // Zdanie wprost: adres najemcy A NIE wskazuje sprzętu najemcy B.
    expect(
      rejestrA?.products.map((entry) => entry.id),
      "adres najemcy A wskazał sprzęt najemcy B",
    ).not.toContain(rowerB.id);
    expect(
      rejestrB?.products.map((entry) => entry.id),
      "adres najemcy B wskazał sprzęt najemcy A",
    ).not.toContain(rowerA.id);
  }, 120_000);

  it("historia najemcy A nie wychodzi w rejestrze najemcy B ani nie blokuje mu adresu", async () => {
    const tenantA = await seedTenant("iz-hist-a");
    const ownerA = await ownerClient(tenantA);
    const produktA = await createProduct(ownerA, tenantA, "Wynajem", { slug: "wynajem" });
    await moveTo(ownerA, tenantA, produktA.id, "wynajem-sprzetu");

    const tenantB = await seedTenant("iz-hist-b");
    const ownerB = await ownerClient(tenantB);

    expect(
      (await registry(tenantB))?.redirects,
      "przekierowanie najemcy A wyszło u najemcy B",
    ).toEqual([]);

    // Najemca B MOŻE wziąć adres, który u A jest przekierowaniem — blokada
    // dotyczy WYŁĄCZNIE wnętrza jednego najemcy.
    const produktB = await createProduct(ownerB, tenantB, "Wynajem B", { slug: "wynajem" });
    expect(produktB.slug).toBe("wynajem");

    // KONTROLA POZYTYWNA: u najemcy A przekierowanie dalej stoi.
    expect((await registry(tenantA))?.redirects).toEqual([
      { from: "wynajem", to: "wynajem-sprzetu" },
    ]);
  }, 120_000);

  it("rejestr najemcy poza oknem handlowym jest NULL — sklep gaśnie razem z odczytem", async () => {
    const tenantId = await seedTenant("okno-handlowe");
    const owner = await ownerClient(tenantId);
    await createProduct(owner, tenantId, "Rower", { slug: "rower" });
    expect((await registry(tenantId))?.products.length).toBe(1);

    await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantId);
    expect(await registry(tenantId)).toBeNull();
  }, 120_000);

  // -------------------------------------------------------------------
  // OKNO WDROŻENIOWE — koperta katalogu bez ani jednego nowego klucza
  // -------------------------------------------------------------------
  describe("okno wdrożeniowe", () => {
    it("app.get_public_catalog nie oddaje ani jednego nowego klucza", async () => {
      const tenantId = await seedTenant("okno");
      const owner = await ownerClient(tenantId);
      await createProduct(owner, tenantId, "Rower górski");

      const rows = await sql!<{ envelope: Record<string, unknown> }[]>`
        select app.get_public_catalog(${tenantId}::uuid) as envelope
      `;
      const envelope = rows[0]!.envelope;
      expect(envelope, "brak koperty — czujnik po pustym zbiorze").toBeTruthy();

      // Koperta storefrontu jest parsowana schematem, który nowego klucza nie
      // zna, a migracja wchodzi na produkcję PRZED kodem. Adres jedzie WŁASNĄ
      // funkcją (app.get_public_product_slugs), właśnie po to.
      expect(Object.keys(envelope).sort()).toEqual([
        "categories",
        "custom_fields",
        "delivery_methods",
        "pickup_locations",
        "products",
        "tenant",
      ]);

      const pozycje = envelope.products as Record<string, unknown>[];
      expect(pozycje.length, "brak pozycji — czujnik po pustym zbiorze").toBe(1);
      expect(Object.keys(pozycje[0]!).sort()).toEqual([
        "auto_increment_multiplier",
        "base_price_day_grosze",
        "buffer_after_days",
        "buffer_before_days",
        "category_ids",
        "custom_fields",
        "deposit_grosze",
        "description",
        "id",
        "images",
        "name",
        "pricing_tiers",
      ]);
      expect(
        Object.keys(pozycje[0]!),
        "klucz `slug` wszedł do koperty katalogu — stary sklep w oknie wdrożeniowym parsuje ją .strict()",
      ).not.toContain("slug");
    }, 120_000);
  });
});
