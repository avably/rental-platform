/**
 * STRONA KATALOGU — migracja 0085, ADR-186.
 *
 * Sześć osi, każda mierząca SKUTEK, nie obecność funkcji:
 *
 *   1. STRONICOWANIE NAPRAWDĘ TNIE ZAPYTANIE. Druga strona wyników zawiera
 *      INNE pozycje niż pierwsza i NIE ZAWIERA ani jednej z nich, suma stron
 *      pokrywa katalog bez powtórzeń i bez ubytków, a `total` mówi o CAŁYM
 *      katalogu, nie o oknie. Asercja „trasa oddaje 24 pozycje" przeszłaby
 *      także dla funkcji, która za każdym razem oddaje ten sam początek listy.
 *
 *   2. RÓWNOŚĆ PROJEKCJI Z KATALOGIEM — warunek, od którego zależy sens
 *      całej fazy. Strona katalogu przestaje czytać `app.get_public_catalog`,
 *      więc gdyby okno opisywało pozycję choćby o jeden klucz inaczej, klient
 *      zobaczyłby w katalogu inną cenę niż na stronie sprzętu obok.
 *      Porównujemy CAŁE obiekty na prawdziwej bazie.
 *
 *   3. IZOLACJA. Dwaj najemcy o katalogach tej samej wielkości; okno jednego
 *      nie wynosi ani jednej pozycji drugiego — także przy przesunięciu, które
 *      u sąsiada byłoby poprawne. Kontrola pozytywna pilnuje, żeby „nic nie
 *      wyszło" nie wyglądało jak izolacja.
 *
 *   4. ZAKRES PUBLICZNY. Pozycja wyłączona i najemca poza oknem handlowym są
 *      nieosiągalni tą drogą i nie liczą się do `total` — inaczej nowa funkcja
 *      byłaby obejściem bramki, którą trzyma `app.get_public_catalog`.
 *
 *   5. ZACISKI WEJŚCIA. `p_limit` ponad sufit nie zamienia stronicowania
 *      w pełny odczyt, a `p_offset` ujemny nie wywraca sklepu błędem 2201X.
 *      Sufit jest LUSTREM `CATALOG_PAGE_MAX_SIZE` z @avably/core.
 *
 *   6. OKNO WDROŻENIOWE. `app.get_public_catalog` nie zmienia ani jednego
 *      bajtu — stary sklep parsuje kopertę schematem, który nowego klucza nie
 *      zna, a migracja wchodzi na produkcję PRZED kodem.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { CATALOG_PAGE_MAX_SIZE, catalogPageCount, catalogPageOffset } from "@avably/core";

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

interface CatalogPageEnvelope {
  total: number;
  tenant: { name: string; locale: string; currency: string };
  custom_fields: unknown[];
  products: Record<string, unknown>[];
  slugs: { id: string; slug: string }[];
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

/** Znacznik przebiegu — lokalna baza bywa współdzielona z równoległymi sesjami. */
const BIEG = randomUUID().slice(0, 8);

describe.skipIf(!hasEnv)("strona katalogu — 0085 (ADR-186)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string, status = "active"): Promise<string> {
    const slug = `cp-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Katalog ${label}`, status, locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /**
   * Katalog BOGATY, nie minimalny: każda pozycja ze zdjęciami i progami
   * cenowymi. Równość projekcji sprawdzana na pozycjach bez nich przeszłaby
   * także dla koperty, która obu tych list nie buduje wcale.
   *
   * Nazwy są ponumerowane z wyrównaniem do trzech cyfr, więc porządek
   * `order by name, id` jest tu przewidywalny i można go sprawdzić WPROST.
   */
  async function seedCatalog(
    tenantId: string,
    etykieta: string,
    ile: number,
  ): Promise<{ id: string; name: string }[]> {
    const wiersze = Array.from({ length: ile }, (_, k) => ({
      tenant_id: tenantId,
      name: `${etykieta} ${BIEG} ${String(k + 1).padStart(3, "0")}`,
      description: `Opis pozycji ${k + 1}`,
      base_price_day_grosze: 10_000 + k,
      deposit_grosze: 20_000 + k,
    }));
    const { data, error } = await admin.from("products").insert(wiersze).select("id, name");
    if (error || !data) throw new Error(`seed katalogu: ${error?.message}`);

    const pozycje = data as { id: string; name: string }[];
    const zdjecia = pozycje.flatMap((p) =>
      [0, 1].map((n) => ({
        tenant_id: tenantId,
        product_id: p.id,
        storage_path: `${tenantId}/${p.id}/${randomUUID()}.webp`,
        sort_order: n,
        alt_text: n === 0 ? `Zdjęcie ${p.name}` : null,
      })),
    );
    const progi = pozycje.flatMap((p) => [
      { tenant_id: tenantId, product_id: p.id, tier_days: 3, multiplier: 0.9, label: "Od 3 dni" },
      { tenant_id: tenantId, product_id: p.id, tier_days: 7, multiplier: 0.8, label: "Od tygodnia" },
    ]);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      admin.from("product_images").insert(zdjecia),
      admin.from("pricing_tiers").insert(progi),
    ]);
    if (e1) throw new Error(`seed zdjęć: ${e1.message}`);
    if (e2) throw new Error(`seed progów: ${e2.message}`);

    return pozycje.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function readPage(
    tenantId: string,
    offset: number,
    limit: number,
  ): Promise<CatalogPageEnvelope | null> {
    const { data, error } = await anon.schema("app").rpc("get_public_catalog_page", {
      p_tenant_id: tenantId,
      p_offset: offset,
      p_limit: limit,
    });
    if (error) throw new Error(`get_public_catalog_page: ${error.message}`);
    return data as CatalogPageEnvelope | null;
  }

  async function readCatalog(tenantId: string): Promise<{ products: Record<string, unknown>[] }> {
    const { data, error } = await anon
      .schema("app")
      .rpc("get_public_catalog", { p_tenant_id: tenantId });
    if (error) throw new Error(`get_public_catalog: ${error.message}`);
    return data as { products: Record<string, unknown>[] };
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
    await sql?.end({ timeout: 5 });
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Stronicowanie naprawdę tnie zapytanie
  // -------------------------------------------------------------------
  describe("okno wyników", () => {
    it("druga strona ma INNE pozycje niż pierwsza i nie zawiera żadnej z nich", async () => {
      const tenantId = await seedTenant("okno");
      await seedCatalog(tenantId, "Okno", 10);

      const pierwsza = await readPage(tenantId, 0, 4);
      const druga = await readPage(tenantId, 4, 4);

      const idPierwszej = pierwsza!.products.map((p) => p.id as string);
      const idDrugiej = druga!.products.map((p) => p.id as string);

      // KONTROLA PO PUSTYM ZBIORZE: bez niej „brak części wspólnej" byłby
      // zielony także wtedy, gdyby obie strony wracały puste.
      expect(idPierwszej, "pierwsza strona pusta — nie ma czego porównywać").toHaveLength(4);
      expect(idDrugiej, "druga strona pusta — nie ma czego porównywać").toHaveLength(4);

      const wspolne = idDrugiej.filter((id) => idPierwszej.includes(id));
      expect(wspolne, "ta sama pozycja na dwóch stronach wyników").toEqual([]);
    });

    it("sumę stron da się posklejać w cały katalog — bez powtórzeń i bez ubytków", async () => {
      const tenantId = await seedTenant("suma");
      const oczekiwane = await seedCatalog(tenantId, "Suma", 10);

      const zebrane: string[] = [];
      for (let strona = 1; strona <= catalogPageCount(10, 4); strona += 1) {
        const okno = await readPage(tenantId, catalogPageOffset(strona, 4), 4);
        zebrane.push(...okno!.products.map((p) => p.id as string));
      }

      expect(zebrane).toHaveLength(10);
      expect(new Set(zebrane).size, "pozycja powtórzona między stronami").toBe(10);
      expect(
        zebrane,
        "kolejność stron rozjechała się z kolejnością katalogu (order by name, id)",
      ).toEqual(oczekiwane.map((p) => p.id));
    });

    it("`total` mówi o CAŁYM katalogu, a nie o oknie", async () => {
      const tenantId = await seedTenant("total");
      await seedCatalog(tenantId, "Total", 7);

      const okno = await readPage(tenantId, 0, 3);
      expect(okno!.products).toHaveLength(3);
      expect(okno!.total, "total policzył okno zamiast katalogu").toBe(7);
    });

    it("strona za końcem katalogu oddaje ZERO pozycji, ale dalej podaje `total`", async () => {
      // To jest dana, na której trasa buduje 404 dla numeru spoza zakresu:
      // pusta lista bez `total` byłaby nieodróżnialna od pustego katalogu.
      const tenantId = await seedTenant("koniec");
      await seedCatalog(tenantId, "Koniec", 5);

      const okno = await readPage(tenantId, 100, 4);
      expect(okno!.products).toEqual([]);
      expect(okno!.total).toBe(5);
    });

    it("adresy pozycji jadą RAZEM ze stroną i dotyczą DOKŁADNIE jej pozycji", async () => {
      const tenantId = await seedTenant("adresy");
      await seedCatalog(tenantId, "Adresy", 6);

      const okno = await readPage(tenantId, 3, 3);
      const idPozycji = okno!.products.map((p) => p.id as string).sort();
      const idAdresow = okno!.slugs.map((s) => s.id).sort();

      expect(idAdresow, "adres bez pozycji albo pozycja bez adresu na tej samej stronie").toEqual(
        idPozycji,
      );
      expect(okno!.slugs.every((s) => s.slug.length > 0), "pusty adres w kopercie").toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // 2. Równość projekcji z katalogiem
  // -------------------------------------------------------------------
  it("pozycja w oknie jest IDENTYCZNA z pozycją w kopercie katalogu", async () => {
    const tenantId = await seedTenant("projekcja");
    await seedCatalog(tenantId, "Projekcja", 4);

    const okno = await readPage(tenantId, 0, 4);
    const katalog = await readCatalog(tenantId);

    expect(okno!.products, "okno puste — porównanie po pustym zbiorze").toHaveLength(4);

    for (const pozycja of okno!.products) {
      const zKatalogu = katalog.products.find((p) => p.id === pozycja.id);
      expect(zKatalogu, `pozycji ${String(pozycja.id)} nie ma w katalogu publicznym`).toBeTruthy();
      // CAŁE obiekty, nie wybrane pola: asercja na `name` i cenie przeszłaby
      // także dla koperty, która zgubiła progi cenowe albo zdjęcia.
      expect(pozycja).toEqual(zKatalogu);
    }

    expect(okno!.tenant, "koperta najemcy rozjechała się z katalogiem").toEqual({
      name: `Katalog projekcja`,
      locale: "pl",
      currency: "PLN",
    });
  });

  // -------------------------------------------------------------------
  // 3. Izolacja
  // -------------------------------------------------------------------
  it("okno jednego najemcy nie wynosi ani jednej pozycji drugiego", async () => {
    const najemcaA = await seedTenant("iza");
    const najemcaB = await seedTenant("izb");
    const pozycjeA = await seedCatalog(najemcaA, "Alfa", 6);
    const pozycjeB = await seedCatalog(najemcaB, "Beta", 6);

    const oknoA = await readPage(najemcaA, 3, 3);
    const idA = oknoA!.products.map((p) => p.id as string);

    // KONTROLA POZYTYWNA: bez niej „nie ma cudzych pozycji" byłoby zielone
    // także dla funkcji, która nie oddaje niczego.
    expect(idA, "okno najemcy A puste — nie ma czego bronić").toHaveLength(3);
    expect(idA.every((id) => pozycjeA.some((p) => p.id === id))).toBe(true);

    const cudze = idA.filter((id) => pozycjeB.some((p) => p.id === id));
    expect(cudze, "WYCIEK MIĘDZY NAJEMCAMI: okno A zawiera pozycje B").toEqual([]);
    expect(oknoA!.total, "total policzył katalogi obu najemców").toBe(6);
  });

  // -------------------------------------------------------------------
  // 4. Zakres publiczny
  // -------------------------------------------------------------------
  it("pozycja WYŁĄCZONA nie wchodzi do okna ani do `total`", async () => {
    const tenantId = await seedTenant("aktywne");
    const pozycje = await seedCatalog(tenantId, "Aktywne", 5);
    const { error } = await admin.from("products").update({ active: false }).eq("id", pozycje[0]!.id);
    if (error) throw new Error(`wyłączenie pozycji: ${error.message}`);

    const okno = await readPage(tenantId, 0, 10);
    expect(okno!.total).toBe(4);
    expect(okno!.products.map((p) => p.id)).not.toContain(pozycje[0]!.id);
  });

  it("najemca poza oknem handlowym nie ma katalogu — koperta jest NULL", async () => {
    const tenantId = await seedTenant("zawieszony", "suspended");
    await seedCatalog(tenantId, "Zawieszony", 3);

    expect(await readPage(tenantId, 0, 10)).toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. Zaciski wejścia
  // -------------------------------------------------------------------
  describe("zaciski wejścia", () => {
    it("`p_limit` ponad sufit nie zamienia stronicowania w pełny odczyt", async () => {
      const tenantId = await seedTenant("sufit");
      await seedCatalog(tenantId, "Sufit", CATALOG_PAGE_MAX_SIZE + 5);

      const okno = await readPage(tenantId, 0, 100_000);
      expect(okno!.total).toBe(CATALOG_PAGE_MAX_SIZE + 5);
      expect(
        okno!.products.length,
        "zacisk p_limit zdjęty — jedno wywołanie ciągnie cały katalog",
      ).toBe(CATALOG_PAGE_MAX_SIZE);
    }, 60_000);

    it("sufit w bazie jest LUSTREM CATALOG_PAGE_MAX_SIZE z rdzenia", async () => {
      // Rozjazd znaczyłby stronę wyników krótszą, niż liczy sklep — czyli
      // pozycje, do których nawigacja prowadzi, a których strona nie pokazuje.
      const rows = await sql!<{ definicja: string }[]>`
        select pg_get_functiondef('app.get_public_catalog_page(uuid,integer,integer)'::regprocedure)
          as definicja
      `;
      expect(rows[0]!.definicja).toContain(`), ${CATALOG_PAGE_MAX_SIZE})`);
    });

    it("`p_offset` UJEMNY nie wywraca odczytu — zaciska się do zera", async () => {
      // OFFSET < 0 to w Postgresie błąd 2201X, czyli 500 na trasie sklepu za
      // wpisanie minusa w adresie. Kształt numeru strony rozstrzyga trasa.
      const tenantId = await seedTenant("minus");
      await seedCatalog(tenantId, "Minus", 4);

      const okno = await readPage(tenantId, -10, 2);
      expect(okno!.products).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------
  // 6. Okno wdrożeniowe
  // -------------------------------------------------------------------
  it("app.get_public_catalog nie dostaje ani jednego nowego klucza", async () => {
    const tenantId = await seedTenant("koperta");
    await seedCatalog(tenantId, "Koperta", 2);

    const katalog = (await readCatalog(tenantId)) as unknown as Record<string, unknown>;
    expect(Object.keys(katalog).sort()).toEqual([
      "categories",
      "custom_fields",
      "delivery_methods",
      "pickup_locations",
      "products",
      "tenant",
    ]);
  });
});
