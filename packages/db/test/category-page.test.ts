/**
 * STRONA KATEGORII — migracja 0101, ADR-244 (Faza A: fundament danych).
 *
 * Osie, każda mierząca SKUTEK, nie obecność funkcji:
 *
 *   1. META KATEGORII. Koperta niesie id/name/slug/description/image_path
 *      DOKŁADNIE tej kategorii — z banerem, gdy jest ustawiony (kontrola
 *      pozytywna na NIEpustym image_path, żeby „pole jest" nie znaczyło „pole
 *      zawsze NULL").
 *
 *   2. ROZRÓŻNIALNE STANY. Trzy różne wyniki na trzy różne widoki trasy:
 *      najemca poza oknem handlowym => cała koperta NULL; slug nieznany =>
 *      koperta jest, ale category=NULL (trasa: 404); kategoria pusta =>
 *      category={meta}, products=[], total=0 (trasa: pusty widok, nie 404).
 *      Sama pusta lista pozycji NIE rozstrzyga 404 — rozstrzyga obecność
 *      obiektu `category`.
 *
 *   3. STRONICOWANIE NAPRAWDĘ TNIE. Druga strona ma INNE pozycje niż pierwsza
 *      i nie zawiera żadnej z nich; suma stron pokrywa kategorię bez powtórzeń
 *      i ubytków; `total` mówi o CAŁEJ kategorii, nie o oknie ani o katalogu.
 *
 *   4. RÓWNOŚĆ PROJEKCJI Z KATALOGIEM — warunek sensu fazy. Pozycja na stronie
 *      kategorii jest CO DO OBIEKTU identyczna z pozycją w kopercie katalogu,
 *      więc klient nie zobaczy tu innej ceny/zdjęcia niż w katalogu obok.
 *
 *   5. ZAKRES = TYLKO TA KATEGORIA. Pozycja z innej kategorii i pozycja bez
 *      kategorii są nieosiągalne tą drogą i nie liczą się do `total`; pozycja
 *      wyłączona też nie.
 *
 *   6. IZOLACJA (warunek zamknięcia). Kategoria i pozycje najemcy A po jego
 *      identyfikatorze nie niosą ani bajtu najemcy B; slug kategorii B pod
 *      najemcą A => category NULL. Kontrola pozytywna pilnuje, żeby „nic nie
 *      wyszło" nie udawało izolacji.
 *
 *   7. SORTOWANIE. p_sort steruje porządkiem (cena rosnąco/malejąco, najnowsze),
 *      domyślnie i dla nieznanej wartości — porządek katalogu (name,id).
 *
 *   8. ZACISKI WEJŚCIA. p_page_size ponad sufit nie zamienia strony w pełny
 *      odczyt (lustro CATALOG_PAGE_MAX_SIZE), p_page < 1 nie wywraca odczytu.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_*.
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { CATALOG_PAGE_MAX_SIZE } from "@avably/core";

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

interface CategoryMeta {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  image_path: string | null;
}

interface CategoryPageEnvelope {
  category: CategoryMeta | null;
  tenant: { name: string; locale: string; currency: string };
  page: number;
  page_size: number;
  total: number;
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

describe.skipIf(!hasEnv)("strona kategorii — 0101 (ADR-244)", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

  async function seedTenant(label: string, status = "active"): Promise<string> {
    const slug = `kp-${label}-${randomUUID().slice(0, 12)}`.slice(0, 39);
    const { data, error } = await admin
      .from("tenants")
      .insert({ slug, name: `Kategoria ${label}`, status, locale: "pl" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`seed tenanta: ${error?.message}`);
    createdTenantIds.push(data.id as string);
    return data.id as string;
  }

  async function seedCategory(
    tenantId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; slug: string }> {
    const unique = randomUUID().slice(0, 8);
    const { data, error } = await admin
      .from("catalog_categories")
      .insert({
        tenant_id: tenantId,
        name: `Kat ${BIEG} ${unique}`,
        slug: `kat-${unique}`,
        ...overrides,
      })
      .select("id, slug")
      .single();
    if (error || !data) throw new Error(`seed kategorii: ${error?.message}`);
    return { id: data.id as string, slug: data.slug as string };
  }

  /**
   * Pozycje BOGATE (zdjęcia + progi cenowe), żeby równość projekcji z katalogiem
   * naprawdę coś sprawdzała. Nazwy ponumerowane z wyrównaniem — porządek
   * katalogu (name,id) jest tu przewidywalny. Zwraca pozycje w kolejności
   * katalogu; opcjonalnie przypina je do kategorii.
   */
  async function seedProducts(
    tenantId: string,
    etykieta: string,
    ile: number,
    opts: { categoryId?: string; priceBase?: number } = {},
  ): Promise<{ id: string; name: string }[]> {
    const base = opts.priceBase ?? 10_000;
    const wiersze = Array.from({ length: ile }, (_, k) => ({
      tenant_id: tenantId,
      name: `${etykieta} ${BIEG} ${String(k + 1).padStart(3, "0")}`,
      description: `Opis ${k + 1}`,
      base_price_day_grosze: base + k,
      deposit_grosze: 20_000 + k,
    }));
    const { data, error } = await admin.from("products").insert(wiersze).select("id, name");
    if (error || !data) throw new Error(`seed pozycji: ${error?.message}`);
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
    ]);
    const [{ error: e1 }, { error: e2 }] = await Promise.all([
      admin.from("product_images").insert(zdjecia),
      admin.from("pricing_tiers").insert(progi),
    ]);
    if (e1) throw new Error(`seed zdjęć: ${e1.message}`);
    if (e2) throw new Error(`seed progów: ${e2.message}`);

    if (opts.categoryId) await assign(tenantId, opts.categoryId, pozycje);

    return pozycje.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function assign(
    tenantId: string,
    categoryId: string,
    products: { id: string }[],
  ): Promise<void> {
    const { error } = await admin
      .from("product_categories")
      .insert(products.map((p) => ({ tenant_id: tenantId, product_id: p.id, category_id: categoryId })));
    if (error) throw new Error(`przypisanie do kategorii: ${error.message}`);
  }

  async function readPage(
    tenantId: string,
    slug: string,
    page = 1,
    pageSize: number | null = null,
    sort = "catalog",
  ): Promise<CategoryPageEnvelope | null> {
    const { data, error } = await anon.schema("app").rpc("get_public_category_page", {
      p_tenant_id: tenantId,
      p_slug: slug,
      p_page: page,
      p_page_size: pageSize,
      p_sort: sort,
    });
    if (error) throw new Error(`get_public_category_page: ${error.message}`);
    return data as CategoryPageEnvelope | null;
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
  }, 60_000);

  // -------------------------------------------------------------------
  // 1. Meta kategorii
  // -------------------------------------------------------------------
  it("koperta niesie META kategorii — z banerem, gdy jest ustawiony", async () => {
    const tenantId = await seedTenant("meta");
    // Segment `category` (nie `kategoria`) i prefiks własnego tenanta — wzorzec
    // wymagany przez CHECK catalog_categories_image_path_tenant_scope (0108/ADR-264).
    const banner = `${tenantId}/category/${randomUUID()}.webp`;
    const cat = await seedCategory(tenantId, {
      description: "Opis kategorii",
      image_path: banner,
    });
    await seedProducts(tenantId, "Meta", 2, { categoryId: cat.id });

    const okno = await readPage(tenantId, cat.slug);
    expect(okno!.category).toEqual({
      id: cat.id,
      name: expect.stringContaining("Kat "),
      slug: cat.slug,
      description: "Opis kategorii",
      // KONTROLA POZYTYWNA image_path: „pole jest" nie może znaczyć „zawsze NULL".
      image_path: banner,
    });
    expect(okno!.tenant).toEqual({ name: "Kategoria meta", locale: "pl", currency: "PLN" });
  });

  // -------------------------------------------------------------------
  // 2. Rozróżnialne stany
  // -------------------------------------------------------------------
  describe("rozróżnialne stany", () => {
    it("slug NIEZNANY => koperta jest, ale category=NULL i products=[] (trasa: 404)", async () => {
      const tenantId = await seedTenant("nieznany");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Nieznany", 2, { categoryId: cat.id });

      const okno = await readPage(tenantId, "slug-ktorego-nie-ma");
      expect(okno).not.toBeNull();
      expect(okno!.category, "nieznany slug musi dać category=NULL").toBeNull();
      expect(okno!.products).toEqual([]);
      expect(okno!.total).toBe(0);
    });

    it("kategoria PUSTA => category={meta}, products=[], total=0 (trasa: pusty widok, NIE 404)", async () => {
      const tenantId = await seedTenant("pusta");
      const cat = await seedCategory(tenantId);

      const okno = await readPage(tenantId, cat.slug);
      // Rozróżnienie brak-vs-pusta stoi WYŁĄCZNIE na obecności obiektu category:
      // pusta lista pozycji jest wspólna dla obu stanów.
      expect(okno!.category, "pusta kategoria musi NIEŚĆ meta (inaczej trasa da 404)").not.toBeNull();
      expect(okno!.category!.slug).toBe(cat.slug);
      expect(okno!.products).toEqual([]);
      expect(okno!.total).toBe(0);
    });

    it("najemca poza oknem handlowym => CAŁA koperta NULL", async () => {
      const tenantId = await seedTenant("zawieszony", "suspended");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Zawieszony", 2, { categoryId: cat.id });

      expect(await readPage(tenantId, cat.slug)).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // 3. Stronicowanie
  // -------------------------------------------------------------------
  describe("okno wyników", () => {
    it("druga strona ma INNE pozycje niż pierwsza i nie zawiera żadnej z nich", async () => {
      const tenantId = await seedTenant("okno");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Okno", 10, { categoryId: cat.id });

      const pierwsza = await readPage(tenantId, cat.slug, 1, 4);
      const druga = await readPage(tenantId, cat.slug, 2, 4);

      const idP = pierwsza!.products.map((p) => p.id as string);
      const idD = druga!.products.map((p) => p.id as string);
      expect(idP, "pierwsza strona pusta — nie ma czego porównywać").toHaveLength(4);
      expect(idD, "druga strona pusta — nie ma czego porównywać").toHaveLength(4);
      expect(idD.filter((id) => idP.includes(id)), "ta sama pozycja na dwóch stronach").toEqual([]);
    });

    it("sumę stron da się posklejać w całą kategorię — bez powtórzeń i ubytków", async () => {
      const tenantId = await seedTenant("suma");
      const cat = await seedCategory(tenantId);
      const oczekiwane = await seedProducts(tenantId, "Suma", 10, { categoryId: cat.id });

      const zebrane: string[] = [];
      for (let strona = 1; strona <= 3; strona += 1) {
        const okno = await readPage(tenantId, cat.slug, strona, 4);
        zebrane.push(...okno!.products.map((p) => p.id as string));
      }
      expect(zebrane).toHaveLength(10);
      expect(new Set(zebrane).size, "pozycja powtórzona między stronami").toBe(10);
      expect(zebrane, "kolejność stron rozjechała się z porządkiem katalogu").toEqual(
        oczekiwane.map((p) => p.id),
      );
    });

    it("`total` mówi o CAŁEJ kategorii; strona za końcem oddaje ZERO, ale nadal `total`", async () => {
      const tenantId = await seedTenant("total");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Total", 7, { categoryId: cat.id });

      const s1 = await readPage(tenantId, cat.slug, 1, 3);
      expect(s1!.products).toHaveLength(3);
      expect(s1!.total, "total policzył okno zamiast kategorii").toBe(7);

      const zaKoncem = await readPage(tenantId, cat.slug, 100, 4);
      expect(zaKoncem!.products).toEqual([]);
      expect(zaKoncem!.total).toBe(7);
    });

    it("adresy pozycji jadą RAZEM ze stroną i dotyczą DOKŁADNIE jej pozycji", async () => {
      const tenantId = await seedTenant("adresy");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Adresy", 6, { categoryId: cat.id });

      const okno = await readPage(tenantId, cat.slug, 2, 3);
      const idPoz = okno!.products.map((p) => p.id as string).sort();
      const idAdr = okno!.slugs.map((s) => s.id).sort();
      expect(idAdr, "adres bez pozycji albo pozycja bez adresu na tej stronie").toEqual(idPoz);
      expect(okno!.slugs.every((s) => s.slug.length > 0), "pusty adres w kopercie").toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // 4. Równość projekcji z katalogiem
  // -------------------------------------------------------------------
  it("pozycja w oknie kategorii jest IDENTYCZNA z pozycją w kopercie katalogu", async () => {
    const tenantId = await seedTenant("projekcja");
    const cat = await seedCategory(tenantId);
    await seedProducts(tenantId, "Projekcja", 4, { categoryId: cat.id });

    const okno = await readPage(tenantId, cat.slug);
    const katalog = await readCatalog(tenantId);
    expect(okno!.products, "okno puste — porównanie po pustym zbiorze").toHaveLength(4);

    for (const pozycja of okno!.products) {
      const zKatalogu = katalog.products.find((p) => p.id === pozycja.id);
      expect(zKatalogu, `pozycji ${String(pozycja.id)} nie ma w katalogu publicznym`).toBeTruthy();
      // CAŁE obiekty, nie wybrane pola — asercja na name/cenie przeszłaby też
      // dla koperty, która zgubiła progi cenowe albo zdjęcia.
      expect(pozycja).toEqual(zKatalogu);
    }
  });

  // -------------------------------------------------------------------
  // 5. Zakres = tylko ta kategoria
  // -------------------------------------------------------------------
  it("strona NIESIE tylko pozycje TEJ kategorii — inna kategoria, brak kategorii i wyłączona są poza", async () => {
    const tenantId = await seedTenant("zakres");
    const catA = await seedCategory(tenantId);
    const catB = await seedCategory(tenantId);

    const wA = await seedProducts(tenantId, "Wewnatrz", 3, { categoryId: catA.id });
    const wB = await seedProducts(tenantId, "InnaKat", 2, { categoryId: catB.id });
    const bezKat = await seedProducts(tenantId, "BezKat", 2); // nieprzypisane

    // Jedna pozycja kategorii A wyłączona — nie liczy się ani do okna, ani total.
    const { error } = await admin.from("products").update({ active: false }).eq("id", wA[0]!.id);
    if (error) throw new Error(`wyłączenie pozycji: ${error.message}`);

    const okno = await readPage(tenantId, catA.slug, 1, 48);
    const widoczne = okno!.products.map((p) => p.id as string);

    expect(okno!.total, "total policzył pozycje spoza kategorii albo wyłączone").toBe(2);
    expect(widoczne).toHaveLength(2);
    expect(widoczne, "wyciekła pozycja wyłączona").not.toContain(wA[0]!.id);
    for (const p of [...wB, ...bezKat]) {
      expect(widoczne, "wyciekła pozycja spoza kategorii").not.toContain(p.id);
    }
  });

  // -------------------------------------------------------------------
  // 6. Izolacja między najemcami
  // -------------------------------------------------------------------
  it("strona kategorii najemcy A nie niesie ani bajtu najemcy B", async () => {
    const najemcaA = await seedTenant("iza");
    const najemcaB = await seedTenant("izb");
    const catA = await seedCategory(najemcaA);
    const catB = await seedCategory(najemcaB);
    const pozA = await seedProducts(najemcaA, "Alfa", 4, { categoryId: catA.id });
    const pozB = await seedProducts(najemcaB, "Beta", 4, { categoryId: catB.id });

    const okno = await readPage(najemcaA, catA.slug, 1, 48);
    const idA = okno!.products.map((p) => p.id as string);
    // KONTROLA POZYTYWNA: bez niej „brak cudzych" byłoby zielone także dla
    // funkcji, która nie oddaje niczego.
    expect(idA, "okno A puste — nie ma czego bronić").toHaveLength(4);
    expect(idA.every((id) => pozA.some((p) => p.id === id))).toBe(true);
    expect(idA.filter((id) => pozB.some((p) => p.id === id)), "WYCIEK: okno A niesie pozycje B").toEqual([]);
    expect(okno!.total, "total policzył kategorie obu najemców").toBe(4);

    // Slug kategorii B pod najemcą A => category NULL (kategoria B jest cudza).
    const podA = await readPage(najemcaA, catB.slug);
    expect(podA!.category, "slug kategorii B rozpoznany pod hostem A — WYCIEK").toBeNull();
    expect(podA!.products).toEqual([]);
  });

  // -------------------------------------------------------------------
  // 7. Sortowanie
  // -------------------------------------------------------------------
  it("p_sort steruje porządkiem; nieznana wartość schodzi do porządku katalogu", async () => {
    const tenantId = await seedTenant("sort");
    const cat = await seedCategory(tenantId);
    // Ceny rosną razem z indeksem, więc porządek katalogu (name,id) pokrywa się
    // z cena-rosnąco; price_desc musi go ODWRÓCIĆ, co odróżnia sortowanie od
    // przypadkowej zgodności.
    const poz = await seedProducts(tenantId, "Sort", 5, { categoryId: cat.id, priceBase: 30_000 });

    const domyslnie = await readPage(tenantId, cat.slug, 1, 48, "catalog");
    const nieznane = await readPage(tenantId, cat.slug, 1, 48, "cokolwiek-czego-nie-ma");
    const rosnaco = await readPage(tenantId, cat.slug, 1, 48, "price_asc");
    const malejaco = await readPage(tenantId, cat.slug, 1, 48, "price_desc");

    const katalogOrder = poz.map((p) => p.id);
    expect(domyslnie!.products.map((p) => p.id)).toEqual(katalogOrder);
    expect(nieznane!.products.map((p) => p.id), "nieznany p_sort nie zszedł do katalogu").toEqual(
      katalogOrder,
    );
    expect(rosnaco!.products.map((p) => p.id)).toEqual(katalogOrder);
    expect(
      malejaco!.products.map((p) => p.id),
      "price_desc nie odwrócił porządku",
    ).toEqual([...katalogOrder].reverse());
  });

  // -------------------------------------------------------------------
  // 8. Zaciski wejścia
  // -------------------------------------------------------------------
  describe("zaciski wejścia", () => {
    it("sufit p_page_size DZIAŁA i jest LUSTREM CATALOG_PAGE_MAX_SIZE", async () => {
      const tenantId = await seedTenant("sufit");
      const cat = await seedCategory(tenantId);
      await seedProducts(tenantId, "Sufit", CATALOG_PAGE_MAX_SIZE + 5, { categoryId: cat.id });

      const okno = await readPage(tenantId, cat.slug, 1, 100_000);
      expect(okno!.total, "kontrola: kategoria większa od sufitu").toBe(CATALOG_PAGE_MAX_SIZE + 5);
      expect(
        okno!.products.length,
        "zacisk p_page_size rozjechał się z CATALOG_PAGE_MAX_SIZE (albo zniknął)",
      ).toBe(CATALOG_PAGE_MAX_SIZE);
      expect(okno!.page_size).toBe(CATALOG_PAGE_MAX_SIZE);
    }, 60_000);

    it("p_page < 1 nie wywraca odczytu — zaciska się do pierwszej strony", async () => {
      const tenantId = await seedTenant("minus");
      const cat = await seedCategory(tenantId);
      const poz = await seedProducts(tenantId, "Minus", 4, { categoryId: cat.id });

      const okno = await readPage(tenantId, cat.slug, -10, 2);
      expect(okno!.page).toBe(1);
      expect(okno!.products.map((p) => p.id)).toEqual(poz.slice(0, 2).map((p) => p.id));
    });
  });
});
