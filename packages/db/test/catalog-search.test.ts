/**
 * WYSZUKIWARKA KATALOGU — migracja 0107, ADR-263 (domknięcie B1).
 *
 * Pięć osi, każda mierząca SKUTEK, nie obecność argumentu:
 *
 *   1. FILTR NAPRAWDĘ ZAWĘŻA — po NAZWIE i po OPISIE. Zapytanie trafiające
 *      raz w nazwę, raz w opis wnosi OBIE pozycje i NIE wnosi trzeciej, która
 *      nie pasuje nigdzie. Asercja „zapytanie zwróciło coś" przeszłaby też dla
 *      funkcji, która ignoruje `p_query` i oddaje cały katalog.
 *
 *   2. PUSTE ZAPYTANIE = KATALOG ZASTANY CO DO BAJTU. NULL, pusty łańcuch i
 *      sama spacja dają dokładnie tę samą kopertę, co wywołanie 3-argumentowe
 *      bez `p_query` — to warunek okna wdrożeniowego (migracja jedzie PRZED
 *      kodem, stary czytnik woła bez argumentu).
 *
 *   3. IZOLACJA Z ZAPYTANIEM. Fraza pasująca do pozycji OBU najemców, zadana u
 *      jednego, nie wynosi ani jednej pozycji drugiego. `p_query` jest
 *      dodatkowym `AND` po zawężeniu tenanta, nie furtką wokół niego. Kontrola
 *      pozytywna pilnuje, żeby „nic nie wyciekło" nie znaczyło „nic nie wróciło".
 *
 *   4. SORT I PAGINACJA DZIAŁAJĄ NA PRZEFILTROWANYM ZBIORZE. Strony wyników
 *      frazy nie zachodzą na siebie, składają się w cały zbiór dopasowań bez
 *      ubytków, idą w porządku `name, id`, a `total` liczy DOPASOWANIA, nie
 *      cały katalog — inaczej nawigacja obiecywałaby strony, których nie ma.
 *
 *   5. METAZNAKI LIKE SĄ ESKEJPOWANE. Zapytanie „%" trafia WYŁĄCZNIE pozycję z
 *      literalnym znakiem procentu, a nie cały katalog — dowód, że `p_query`
 *      jest wartością związaną z eskejpowaniem, a nie dziką kartą.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { catalogPageCount, catalogPageOffset } from "@avably/core";

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

const createdTenantIds: string[] = [];

/** Znacznik przebiegu — lokalna baza bywa współdzielona z równoległymi sesjami. */
const BIEG = randomUUID().slice(0, 8);

describe.skipIf(!hasEnv)("wyszukiwarka katalogu — 0107 (ADR-263)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string, status = "active"): Promise<string> {
    const slug = `cs-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Szukaj ${label}`, status, locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  /** Wstawia pozycje z jawnie podaną nazwą/opisem; zwraca id w kolejności wstawiania. */
  async function seedProducts(
    tenantId: string,
    rows: { name: string; description: string | null }[],
  ): Promise<string[]> {
    const wiersze = rows.map((r, k) => ({
      tenant_id: tenantId,
      name: r.name,
      description: r.description,
      base_price_day_grosze: 10_000 + k,
      deposit_grosze: 20_000 + k,
    }));
    const { data, error } = await admin.from("products").insert(wiersze).select("id, name");
    if (error || !data) throw new Error(`seed pozycji: ${error?.message}`);
    return (data as { id: string; name: string }[]).map((p) => p.id);
  }

  async function readPage(
    tenantId: string,
    offset: number,
    limit: number,
    query?: string | null,
  ): Promise<CatalogPageEnvelope | null> {
    const args: Record<string, unknown> = {
      p_tenant_id: tenantId,
      p_offset: offset,
      p_limit: limit,
    };
    // `undefined` = nie wysyłaj argumentu wcale (stary czytnik 3-argumentowy);
    // `null` = wyślij p_query jawnie NULL. Oba muszą dać pełny katalog.
    if (query !== undefined) args.p_query = query;
    const { data, error } = await anon.schema("app").rpc("get_public_catalog_page", args);
    if (error) throw new Error(`get_public_catalog_page: ${error.message}`);
    return data as CatalogPageEnvelope | null;
  }

  afterAll(async () => {
    if (!hasEnv) return;
    for (const id of createdTenantIds) await admin.from("tenants").delete().eq("id", id);
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Filtr po nazwie I po opisie
  // -------------------------------------------------------------------
  it("zapytanie filtruje po NAZWIE i po OPISIE, a pomija to, co nie pasuje nigdzie", async () => {
    const tenantId = await seedTenant("pola");
    const [idNazwa, idOpis, idZaden] = await seedProducts(tenantId, [
      { name: `Wiertarka ${BIEG} udarowa`, description: "zwykły opis" },
      { name: `Szlifierka ${BIEG}`, description: `w opisie stoi wiertarka ${BIEG}` },
      { name: `Młot ${BIEG}`, description: "nic wspólnego z frazą" },
    ]);

    const okno = await readPage(tenantId, 0, 24, `wiertarka ${BIEG}`);
    const ids = (okno!.products.map((p) => p.id as string)).sort();

    expect(okno!.total, "total nie policzył dopasowań").toBe(2);
    expect(ids, "filtr nie wniósł dokładnie dopasowań name+description").toEqual(
      [idNazwa, idOpis].sort(),
    );
    expect(ids, "pozycja bez dopasowania weszła do wyników").not.toContain(idZaden);
  });

  it("dopasowanie jest NIEZALEŻNE od wielkości liter (ILIKE)", async () => {
    const tenantId = await seedTenant("wielkosc");
    await seedProducts(tenantId, [{ name: `Kamera ${BIEG} GoPro`, description: null }]);

    const male = await readPage(tenantId, 0, 24, `kamera ${BIEG.toLowerCase()}`);
    const duze = await readPage(tenantId, 0, 24, `KAMERA ${BIEG.toUpperCase()}`);
    expect(male!.total, "małe litery nie dopasowały").toBe(1);
    expect(duze!.total, "wielkie litery nie dopasowały").toBe(1);
  });

  // -------------------------------------------------------------------
  // 2. Puste zapytanie = katalog zastany co do bajtu
  // -------------------------------------------------------------------
  it("NULL / pusty / spacja dają DOKŁADNIE tę samą kopertę, co brak argumentu", async () => {
    const tenantId = await seedTenant("puste");
    await seedProducts(tenantId, [
      { name: `Aaa ${BIEG}`, description: "x" },
      { name: `Bbb ${BIEG}`, description: "y" },
      { name: `Ccc ${BIEG}`, description: "z" },
    ]);

    const bezArg = await readPage(tenantId, 0, 24); // stary czytnik 3-argumentowy
    const nullArg = await readPage(tenantId, 0, 24, null);
    const pusty = await readPage(tenantId, 0, 24, "");
    const spacja = await readPage(tenantId, 0, 24, "   ");

    expect(bezArg!.total, "kontrola: katalog nie ma trzech pozycji").toBe(3);
    // CO DO BAJTU: nie tylko `total`, cała koperta — inaczej „puste = pełny"
    // przeszłoby dla funkcji, która przy pustym gubi np. adresy albo projekcję.
    expect(nullArg, "p_query NULL rozjechał się z brakiem argumentu").toEqual(bezArg);
    expect(pusty, "pusty łańcuch nie zszedł do pełnego katalogu").toEqual(bezArg);
    expect(spacja, "sama spacja nie zeszła do pełnego katalogu").toEqual(bezArg);
  });

  // -------------------------------------------------------------------
  // 3. Izolacja z zapytaniem
  // -------------------------------------------------------------------
  it("fraza pasująca u OBU najemców nie wynosi z jednego pozycji drugiego", async () => {
    const najemcaA = await seedTenant("iza");
    const najemcaB = await seedTenant("izb");
    const [idA] = await seedProducts(najemcaA, [
      { name: `Projektor ${BIEG} alfa`, description: null },
    ]);
    const [idB] = await seedProducts(najemcaB, [
      { name: `Projektor ${BIEG} beta`, description: null },
    ]);

    const oknoA = await readPage(najemcaA, 0, 24, `projektor ${BIEG}`);
    const ids = oknoA!.products.map((p) => p.id as string);

    // KONTROLA POZYTYWNA: bez niej „nie ma cudzych" byłoby zielone dla funkcji,
    // która nie oddaje niczego.
    expect(ids, "wynik najemcy A pusty — nie ma czego bronić").toEqual([idA]);
    expect(ids, "WYCIEK: fraza u A wyniosła pozycję B").not.toContain(idB);
    expect(oknoA!.total, "total policzył dopasowania obu najemców").toBe(1);
  });

  // -------------------------------------------------------------------
  // 4. Sort i paginacja na przefiltrowanym zbiorze
  // -------------------------------------------------------------------
  it("strony wyników frazy nie zachodzą, składają się w całość i idą po nazwie", async () => {
    const tenantId = await seedTenant("strony");
    const TOKEN = `match${BIEG}`;
    // Sześć dopasowań (nazwy ponumerowane → porządek name,id przewidywalny) plus
    // trzy pozycje, które do frazy NIE pasują i nie mają prawa wejść.
    const dopasowane = await seedProducts(
      tenantId,
      Array.from({ length: 6 }, (_, k) => ({
        name: `${TOKEN} ${String(k + 1).padStart(3, "0")}`,
        description: null,
      })),
    );
    await seedProducts(tenantId, [
      { name: `Inny ${BIEG} 1`, description: null },
      { name: `Inny ${BIEG} 2`, description: null },
      { name: `Inny ${BIEG} 3`, description: null },
    ]);

    const zebrane: string[] = [];
    for (let strona = 1; strona <= catalogPageCount(6, 2); strona += 1) {
      const okno = await readPage(tenantId, catalogPageOffset(strona, 2), 2, TOKEN);
      expect(okno!.total, "total nie policzył samych dopasowań").toBe(6);
      zebrane.push(...okno!.products.map((p) => p.id as string));
    }

    expect(zebrane, "liczba zebranych dopasowań ≠ 6").toHaveLength(6);
    expect(new Set(zebrane).size, "pozycja powtórzona między stronami wyników").toBe(6);
    expect(zebrane, "kolejność stron wyników rozjechała się z porządkiem name,id").toEqual(
      dopasowane,
    );
  });

  // -------------------------------------------------------------------
  // 5. Eskejpowanie metaznaków LIKE
  // -------------------------------------------------------------------
  it("metaznak `%` jest LITERALNY — zapytanie „%” nie wynosi całego katalogu", async () => {
    const tenantId = await seedTenant("escape");
    const [idProcent] = await seedProducts(tenantId, [
      { name: `Rabat 50% ${BIEG}`, description: null },
      { name: `Zestaw ${BIEG} A`, description: null },
      { name: `Zestaw ${BIEG} B`, description: null },
    ]);

    const okno = await readPage(tenantId, 0, 24, "%");
    const ids = okno!.products.map((p) => p.id as string);

    expect(okno!.total, "„%” zadziałało jak dzika karta i wzięło cały katalog").toBe(1);
    expect(ids, "„%” nie trafiło pozycji z literalnym procentem").toEqual([idProcent]);
  });

  // -------------------------------------------------------------------
  // Zakres publiczny — najemca poza oknem handlowym nie ma wyszukiwarki
  // -------------------------------------------------------------------
  it("najemca poza oknem handlowym oddaje NULL także z zapytaniem", async () => {
    const tenantId = await seedTenant("zawieszony", "suspended");
    await seedProducts(tenantId, [{ name: `Cokolwiek ${BIEG}`, description: null }]);
    expect(await readPage(tenantId, 0, 24, BIEG)).toBeNull();
  });
});
