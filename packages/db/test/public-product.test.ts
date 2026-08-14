/**
 * WĄSKI ODCZYT JEDNEJ POZYCJI KATALOGU — migracja 0084, ADR-185.
 *
 * Pięć osi, każda mierząca SKUTEK, nie obecność funkcji:
 *
 *   1. TRZY ODPOWIEDZI. Adres bieżący oddaje pozycję, adres stary oddaje cel
 *      przekierowania BEZ pozycji, adres nieznany nie oddaje ani jednego,
 *      ani drugiego. Trasa sprzętu buduje na tym render / 308 / 404 (ADR-182),
 *      więc pomylenie dwóch z tych stanów to albo utrata ruchu, albo pętla
 *      przekierowań.
 *
 *   2. RÓWNOŚĆ PROJEKCJI Z KATALOGIEM — i to jest warunek, od którego zależy
 *      cały ADR-185. Strona sprzętu przestała czytać katalog, więc gdyby wąska
 *      koperta opisywała pozycję choćby o jeden klucz inaczej, klient
 *      zobaczyłby na stronie sprzętu inną cenę niż na kaflu katalogu obok.
 *      Porównujemy CAŁE obiekty na prawdziwej bazie, a nie wybrane pola:
 *      asercja na `name` i `price` przeszłaby też wtedy, gdyby wąska koperta
 *      zgubiła progi cenowe albo zdjęcia.
 *
 *   3. IZOLACJA. Dwaj najemcy o IDENTYCZNYM adresie sprzętu — a to jest stan
 *      NORMALNY, nie brzegowy: „wiertarka-udarowa" nazywa się tak samo
 *      w każdej wypożyczalni w kraju. Każdy dostaje własną pozycję, a historia
 *      adresów jednego nie rozstrzyga adresu drugiego.
 *
 *   4. ZAKRES PUBLICZNY. Pozycja wyłączona i najemca poza oknem handlowym są
 *      nieosiągalni tą drogą — inaczej nowa funkcja byłaby obejściem bramki,
 *      którą trzyma `app.get_public_catalog`.
 *
 *   5. OKNO WDROŻENIOWE. `app.get_public_catalog` nie zmienia ani jednego
 *      bajtu koperty. To jest cała treść zdania „sklep sprzed tej zmiany
 *      przeżywa nową bazę": stary sklep parsuje kopertę schematem, który
 *      nowego klucza nie zna, a migracja wchodzi na produkcję PRZED kodem.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

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

interface ProductEnvelope {
  match: "current" | "redirect" | "none";
  slug: string | null;
  tenant: { name: string; locale: string; currency: string };
  custom_fields: unknown[];
  product: Record<string, unknown> | null;
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

describe.skipIf(!hasEnv)("wąski odczyt pozycji — 0084 (ADR-185)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string): Promise<string> {
    const slug = `pp-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Wąski odczyt ${label}`, status: "active", locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /**
   * Pozycja BOGATA, nie minimalna: ze zdjęciami i progami cenowymi. Równość
   * projekcji sprawdzana na pozycji bez nich przeszłaby także dla koperty,
   * która obu tych list nie buduje wcale.
   */
  async function seedProduct(tenantId: string, name: string, slug: string): Promise<string> {
    const { data, error } = await admin
      .from("products")
      .insert({
        tenant_id: tenantId,
        name,
        slug,
        description: `Opis ${name}`,
        base_price_day_grosze: 12_345,
        deposit_grosze: 6_789,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed pozycji: ${error?.message}`);
    const productId = data.id as string;

    const { error: tiersError } = await admin.from("pricing_tiers").insert([
      { tenant_id: tenantId, product_id: productId, tier_days: 3, multiplier: 0.9, label: "Od 3 dni" },
      { tenant_id: tenantId, product_id: productId, tier_days: 7, multiplier: 0.8, label: "Od tygodnia" },
    ]);
    if (tiersError) throw new Error(`seed progów: ${tiersError.message}`);

    const { error: imagesError } = await admin.from("product_images").insert([
      {
        tenant_id: tenantId,
        product_id: productId,
        storage_path: `${tenantId}/${productId}/${randomUUID()}.webp`,
        sort_order: 0,
        alt_text: `Zdjęcie ${name}`,
      },
      {
        tenant_id: tenantId,
        product_id: productId,
        storage_path: `${tenantId}/${productId}/${randomUUID()}.webp`,
        sort_order: 1,
        alt_text: null,
      },
    ]);
    if (imagesError) throw new Error(`seed zdjęć: ${imagesError.message}`);
    return productId;
  }

  async function read(
    tenantId: string,
    target: { slug?: string; productId?: string },
  ): Promise<ProductEnvelope | null> {
    const { data, error } = await anon.schema("app").rpc("get_public_product", {
      p_tenant_id: tenantId,
      p_slug: target.slug ?? null,
      p_product_id: target.productId ?? null,
    });
    if (error) throw new Error(`get_public_product: ${error.message}`);
    return data as ProductEnvelope | null;
  }

  async function catalogEntry(tenantId: string, productId: string) {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_public_catalog: ${error.message}`);
    const products = (data as { products: Record<string, unknown>[] }).products;
    return products.find((p) => p.id === productId);
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
  });

  // -------------------------------------------------------------------
  // 1. Trzy odpowiedzi
  // -------------------------------------------------------------------
  it("adres BIEŻĄCY oddaje pozycję i jej adres", async () => {
    const tenantId = await seedTenant("biez");
    const productId = await seedProduct(tenantId, "Wiertarka udarowa", "wiertarka-udarowa");

    const envelope = await read(tenantId, { slug: "wiertarka-udarowa" });

    expect(envelope?.match).toBe("current");
    expect(envelope?.slug).toBe("wiertarka-udarowa");
    expect(envelope?.product?.id).toBe(productId);
    expect(envelope?.tenant.currency, "waluta najemcy nie doszła").toBe("PLN");
  });

  it("adres STARY oddaje CEL przekierowania i NIE oddaje pozycji", async () => {
    const tenantId = await seedTenant("stary");
    await seedProduct(tenantId, "Zagęszczarka", "zageszczarka");
    // Zmiana adresu rodzi wpis w historii (trigger 0083).
    await admin
      .from("products")
      .update({ slug: "zageszczarka-plytowa" })
      .eq("tenant_id", tenantId)
      .eq("slug", "zageszczarka");

    const envelope = await read(tenantId, { slug: "zageszczarka" });

    expect(envelope?.match).toBe("redirect");
    expect(envelope?.slug, "brak celu 308 — trasa nie ma dokąd przekierować").toBe(
      "zageszczarka-plytowa",
    );
    // Pozycja przy przekierowaniu jest ZBĘDNA i nie ma prawa jechać: 308 nie
    // niesie dokumentu, więc byłby to czysty koszt na każdym starym adresie.
    expect(envelope?.product).toBeNull();
  });

  it("adres NIEZNANY nie oddaje ani pozycji, ani celu", async () => {
    const tenantId = await seedTenant("nieznany");
    await seedProduct(tenantId, "Młot", "mlot");

    const envelope = await read(tenantId, { slug: "czego-tu-nie-ma" });

    expect(envelope?.match).toBe("none");
    expect(envelope?.product).toBeNull();
    expect(envelope?.slug).toBeNull();
  });

  it("wskazanie IDENTYFIKATOREM (trasa zastana) oddaje tę samą pozycję i jej adres", async () => {
    const tenantId = await seedTenant("id");
    const productId = await seedProduct(tenantId, "Piła", "pila");

    const envelope = await read(tenantId, { productId });

    expect(envelope?.match).toBe("current");
    expect(envelope?.slug, "trasa zastana nie ma dokąd oddać 308").toBe("pila");
    expect(envelope?.product?.id).toBe(productId);
  });

  // -------------------------------------------------------------------
  // 2. RÓWNOŚĆ PROJEKCJI — fundament ADR-185
  // -------------------------------------------------------------------
  it("pozycja z wąskiej koperty jest IDENTYCZNA z wpisem w katalogu", async () => {
    const tenantId = await seedTenant("rownosc");
    const productId = await seedProduct(tenantId, "Rusztowanie", "rusztowanie");

    const [envelope, entry] = await Promise.all([
      read(tenantId, { slug: "rusztowanie" }),
      catalogEntry(tenantId, productId),
    ]);

    // KONTROLA PRZYRZĄDU: obie strony porównania muszą istnieć, inaczej
    // `toEqual(undefined, undefined)` byłoby zieloną bramką po pustym zbiorze.
    expect(entry, "katalog nie zwrócił pozycji — nie ma z czym porównywać").toBeTruthy();
    expect(envelope?.product, "wąska koperta nie zwróciła pozycji").toBeTruthy();

    expect(
      envelope?.product,
      "ROZJAZD PROJEKCJI: strona sprzętu pokaże co innego niż kafel katalogu",
    ).toEqual(entry);

    // Progi i zdjęcia sprawdzamy jeszcze raz WPROST — równość wyżej byłaby
    // spełniona także wtedy, gdyby OBIE koperty zgubiły te listy naraz.
    expect((envelope?.product?.pricing_tiers as unknown[]).length).toBe(2);
    expect((envelope?.product?.images as unknown[]).length).toBe(2);
  });

  it("definicje pól własnych są te same, co w katalogu", async () => {
    const tenantId = await seedTenant("pola");
    await seedProduct(tenantId, "Agregat", "agregat");

    const envelope = await read(tenantId, { slug: "agregat" });
    const { data } = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: tenantId });

    expect(envelope?.custom_fields).toEqual(
      (data as { custom_fields: unknown[] }).custom_fields,
    );
  });

  // -------------------------------------------------------------------
  // 3. IZOLACJA — ten sam adres u dwóch najemców
  // -------------------------------------------------------------------
  it("ten sam adres u dwóch najemców oddaje KAŻDEMU jego własną pozycję", async () => {
    const [tenantA, tenantB] = await Promise.all([seedTenant("iza"), seedTenant("izb")]);
    const [idA, idB] = await Promise.all([
      seedProduct(tenantA, "Wiertarka A", "wiertarka-udarowa-sds"),
      seedProduct(tenantB, "Wiertarka B", "wiertarka-udarowa-sds"),
    ]);

    const [envA, envB] = await Promise.all([
      read(tenantA, { slug: "wiertarka-udarowa-sds" }),
      read(tenantB, { slug: "wiertarka-udarowa-sds" }),
    ]);

    expect(envA?.product?.id).toBe(idA);
    expect(envB?.product?.id).toBe(idB);
    expect(envA?.product?.name).toBe("Wiertarka A");
    expect(envB?.product?.name, "WYCIEK: najemca B dostał pozycję najemcy A").toBe("Wiertarka B");
  });

  it("identyfikator CUDZEJ pozycji jest nieosiągalny", async () => {
    const [tenantA, tenantB] = await Promise.all([seedTenant("cza"), seedTenant("czb")]);
    const idA = await seedProduct(tenantA, "Tylko u A", "tylko-u-a");
    await seedProduct(tenantB, "Tylko u B", "tylko-u-b");

    // Najemca B pyta identyfikatorem pozycji najemcy A — to jest dokładnie ten
    // wektor, przed którym broni jawny filtr tenant_id w SECURITY DEFINER.
    const envelope = await read(tenantB, { productId: idA });

    expect(envelope?.match).toBe("none");
    expect(envelope?.product).toBeNull();
  });

  it("historia adresów JEDNEGO najemcy nie rozstrzyga adresu DRUGIEGO", async () => {
    const [tenantA, tenantB] = await Promise.all([seedTenant("hia"), seedTenant("hib")]);
    await seedProduct(tenantA, "Stary adres A", "adres-wspolny");
    await seedProduct(tenantB, "Bieżący adres B", "adres-wspolny");
    // U najemcy A ten adres staje się STARY.
    await admin
      .from("products")
      .update({ slug: "adres-wspolny-nowy" })
      .eq("tenant_id", tenantA)
      .eq("slug", "adres-wspolny");

    const envB = await read(tenantB, { slug: "adres-wspolny" });

    // U B ten adres jest BIEŻĄCY — historia A nie ma prawa zamienić go w 308.
    expect(envB?.match, "historia najemcy A przekierowała adres najemcy B").toBe("current");
    expect(envB?.product?.name).toBe("Bieżący adres B");
  });

  // -------------------------------------------------------------------
  // 4. Zakres publiczny — ta sama bramka, co katalog
  // -------------------------------------------------------------------
  it("pozycja WYŁĄCZONA jest nieosiągalna", async () => {
    const tenantId = await seedTenant("wyl");
    await seedProduct(tenantId, "Wyłączona", "wylaczona");
    await admin.from("products").update({ active: false }).eq("tenant_id", tenantId);

    expect((await read(tenantId, { slug: "wylaczona" }))?.match).toBe("none");
  });

  it("najemca POZA oknem handlowym nie oddaje niczego", async () => {
    const tenantId = await seedTenant("zaw");
    await seedProduct(tenantId, "Zawieszony", "zawieszony");
    await admin.from("tenants").update({ status: "suspended" }).eq("id", tenantId);

    // NULL, nie „match: none" — nieodróżnialnie od najemcy, którego nie ma.
    expect(await read(tenantId, { slug: "zawieszony" })).toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. Okno wdrożeniowe
  // -------------------------------------------------------------------
  it("koperta app.get_public_catalog nie dostała ani jednego klucza", async () => {
    const tenantId = await seedTenant("okno");
    await seedProduct(tenantId, "Okno", "okno");

    const { data } = await anon.schema("app").rpc("get_public_catalog", { p_tenant_id: tenantId });
    const envelope = data as Record<string, unknown>;

    expect(Object.keys(envelope).sort()).toEqual([
      "categories",
      "custom_fields",
      "delivery_methods",
      "pickup_locations",
      "products",
      "tenant",
    ]);
    const product = (envelope.products as Record<string, unknown>[])[0]!;
    expect(Object.keys(product).sort()).toEqual([
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
  });
});
