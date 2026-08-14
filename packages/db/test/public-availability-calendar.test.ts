/**
 * Dostępność dla katalogu i dla kalendarza (migracja 0081, ADR-179).
 *
 * Bramka pilnuje CZTERECH osi. Przy każdej zapisano, co musiałoby się zepsuć,
 * żeby test spłonął — i dlaczego nic innego tego nie przykrywa.
 *
 *   1. JEDNA REGUŁA KOLIZJI. Wynik obu nowych funkcji jest porównywany
 *      z wynikiem `app.get_public_availability` NA TYCH SAMYCH danych, a nie
 *      z liczbą wpisaną w test. Test z oczekiwaniem „ma być 2" przeszedłby
 *      także wtedy, gdyby obie strony rozjechały się w tę samą stronę; ten
 *      pali się przy KAŻDYM rozjeździe reguły (bufory, okno serwisowe, lista
 *      statusów blokujących).
 *   2. IZOLACJA DWÓCH NAJEMCÓW. Sprzęt o tej samej nazwie u A i u B; żądanie
 *      w kontekście B nie dostaje ANI JEDNEJ liczby z A. Osobna mutacja na
 *      każdy z trzech warunków tenanckich w ciele funkcji.
 *   3. WYŁĄCZNIE LICZBY (ADR-042). Zamówienie blokujące ma DOWIEDZIONY wpływ
 *      na wynik (liczba spada), a mimo to ani jego identyfikator, ani nazwisko
 *      klienta, ani jego terminy nie wychodzą w odpowiedzi. Kontrola pozytywna
 *      jest tu warunkiem sensu: skan po odpowiedzi, na którą zamówienie nie
 *      wpłynęło, nie dowodziłby niczego.
 *   4. SUFIT OKNA. Szerokość liczona ZE STAŁEJ RDZENIA
 *      (`AVAILABILITY_WINDOW_MAX_DAYS`), nie z literału 90 przepisanego do
 *      testu — inaczej test byłby trzecią kopią tej liczby zamiast wiązaniem
 *      dwóch istniejących.
 *
 * Wymaga uruchomionego lokalnego Supabase i zmiennych SUPABASE_LOCAL_* — bez
 * nich plik jest pomijany (strażnik jawności, helpers/integration-env.ts).
 */
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { AVAILABILITY_WINDOW_MAX_DAYS, addDays } from "@avably/core";

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

/**
 * Klient ANON — realna ścieżka publiczna. Wołanie rolą serwisową dowodziłoby
 * wyłącznie tego, że zapytanie jest poprawne SQL-owo, i przeszłoby także dla
 * funkcji bez grantu dla anon.
 */
function anonClient(): SupabaseClient {
  return createClient(env("SUPABASE_LOCAL_API_URL"), env("SUPABASE_LOCAL_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...realtimeTransport,
  });
}

const createdTenantIds: string[] = [];

/** Termin bazowy testów — daleko w przyszłości, żeby nie zależeć od „dzisiaj". */
const START = "2027-05-10";
const END = "2027-05-14";

interface RangeAvailability {
  total_units: number;
  available_units: number;
}

interface DayAvailability {
  total_units: number;
  days: Record<string, number>;
}

interface CatalogAvailability {
  products: { product_id: string; total_units: number; available_units: number }[];
}

async function seedTenant(admin: SupabaseClient, status = "active"): Promise<string> {
  const slug = `avail-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data, error } = await admin
    .from("tenants")
    .insert({ slug, name: `Dostępność ${status}`, status, locale: "pl" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać najemcy (${status}): ${error?.message}`);
  createdTenantIds.push(data.id as string);
  return data.id as string;
}

async function seedProduct(
  admin: SupabaseClient,
  tenantId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Rower górski ${randomUUID().slice(0, 6)}`,
      base_price_day_grosze: 12_000,
      deposit_grosze: 40_000,
      buffer_before_days: 1,
      buffer_after_days: 1,
      ...overrides,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Nie udało się zasiać sprzętu: ${error?.message}`);
  return data.id as string;
}

async function seedUnits(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  count: number,
  overrides: Record<string, unknown> = {},
): Promise<string[]> {
  const rows = Array.from({ length: count }, () => ({
    tenant_id: tenantId,
    product_id: productId,
    serial_number: `SN-${randomUUID().slice(0, 8)}`,
    ...overrides,
  }));
  const { data, error } = await admin.from("product_units").insert(rows).select("id");
  if (error || !data) throw new Error(`Nie udało się zasiać egzemplarzy: ${error?.message}`);
  return data.map((row) => row.id as string);
}

/**
 * Zamówienie blokujące w kształcie, w jakim żyje na produkcji: wiersz `orders`
 * o statusie blokującym plus pozycja z PRZYPISANYM egzemplarzem. Przypisanie
 * nie jest szczegółem fikstury — bez `order_items.unit_id` reguła kolizji nie
 * ma czego znaleźć i cały dowód „liczba spadła" byłby dowodem na nic.
 *
 * Wiersze wstawiamy rolą serwisową, a nie przez `app.public_checkout`: tamta
 * droga wymaga biletu HMAC (0059) i nie ma grantu dla roli serwisowej, a tor
 * panelu (rezerwacja zakładana przez najemcę) pisze te same kolumny wprost.
 * Numer zamówienia i walutę nadają triggery, tak samo jak na produkcji.
 */
async function seedBlockingOrder(
  admin: SupabaseClient,
  tenantId: string,
  productId: string,
  /** Egzemplarz WSKAZANY JAWNIE — który dokładnie zajmuje najem, przesądza o wyniku. */
  unitId: string,
  startDate: string,
  endDate: string,
  fullName: string,
  /**
   * Status DOCELOWY. Zamówienie zawsze RODZI SIĘ jako `pending` (bramka
   * `app.orders_write_gate` nie zna innej drogi na świat), więc każdy inny
   * status osiągamy przejściem — dokładnie tak, jak dzieje się to w panelu.
   */
  orderStatus = "pending",
): Promise<{ orderId: string; email: string; fullName: string; unitId: string }> {
  const email = `blokada-${randomUUID().slice(0, 8)}@test.local`;

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .insert({ tenant_id: tenantId, email, full_name: fullName })
    .select("id")
    .single();
  if (customerError || !customer) {
    throw new Error(`Nie udało się zasiać klienta: ${customerError?.message}`);
  }

  // Punkt odbioru jest wymagany przez CHECK `orders_pickup_requires_location`
  // dla metody `pickup` — fikstura ma spełniać niezmienniki tabeli, a nie je
  // omijać wyborem metody, której sklep by nie użył.
  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (pickupError || !pickup) {
    throw new Error(`Nie udało się zasiać punktu odbioru: ${pickupError?.message}`);
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .insert({
      tenant_id: tenantId,
      customer_id: customer.id,
      start_date: startDate,
      end_date: endDate,
      order_status: "pending",
      delivery_method: "pickup",
      pickup_location_id: pickup.id,
    })
    .select("id")
    .single();
  if (orderError || !order) {
    throw new Error(`Nie udało się zasiać zamówienia: ${orderError?.message}`);
  }

  const { error: itemError } = await admin.from("order_items").insert({
    tenant_id: tenantId,
    order_id: order.id,
    product_id: productId,
    unit_id: unitId,
    rental_grosze: 12_000,
    deposit_grosze: 40_000,
  });
  if (itemError) throw new Error(`Nie udało się zasiać pozycji zamówienia: ${itemError.message}`);

  if (orderStatus !== "pending") {
    const { error: moveError } = await admin
      .from("orders")
      .update({ order_status: orderStatus })
      .eq("tenant_id", tenantId)
      .eq("id", order.id);
    if (moveError) {
      throw new Error(`Nie udało się przenieść zamówienia do ${orderStatus}: ${moveError.message}`);
    }
  }

  return { orderId: order.id as string, email, fullName, unitId };
}

async function rangeAvailability(
  anon: SupabaseClient,
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
): Promise<RangeAvailability | null> {
  const { data, error } = await anon.schema("app").rpc("get_public_availability", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(`get_public_availability: ${error.message}`);
  return (data as RangeAvailability | null) ?? null;
}

async function dayAvailability(
  anon: SupabaseClient,
  tenantId: string,
  productId: string,
  startDate: string,
  endDate: string,
): Promise<DayAvailability | null> {
  const { data, error } = await anon.schema("app").rpc("get_public_availability_days", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(`get_public_availability_days: ${error.message}`);
  return (data as DayAvailability | null) ?? null;
}

async function catalogAvailability(
  anon: SupabaseClient,
  tenantId: string,
  startDate: string,
  endDate: string,
): Promise<CatalogAvailability | null> {
  const { data, error } = await anon.schema("app").rpc("get_public_catalog_availability", {
    p_tenant_id: tenantId,
    p_start_date: startDate,
    p_end_date: endDate,
  });
  if (error) throw new Error(`get_public_catalog_availability: ${error.message}`);
  return (data as CatalogAvailability | null) ?? null;
}

/** Dni zakresu INCLUSIVE — lokalna arytmetyka testu, świadomie odrębna od SQL-a. */
function daysBetween(startDate: string, endDate: string): string[] {
  const days: string[] = [];
  for (let day = startDate; day <= endDate; day = addDays(day, 1)) days.push(day);
  return days;
}

describe.skipIf(!hasEnv)(
  "app.get_public_catalog_availability / app.get_public_availability_days — 0081",
  () => {
    const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
    const anon = hasEnv ? anonClient() : (null as unknown as SupabaseClient);

    afterAll(async () => {
      if (!hasEnv) return;
      if (createdTenantIds.length > 0) {
        await admin.from("tenants").delete().in("id", createdTenantIds);
        createdTenantIds.length = 0;
      }
    });

    // -----------------------------------------------------------------
    // 1. JEDNA REGUŁA KOLIZJI — obie nowe funkcje vs funkcja zakresowa
    // -----------------------------------------------------------------
    //
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: dowolny rozjazd reguły między funkcjami — inny
    // bufor, okno serwisowe liczone terminem rozszerzonym, wypadnięcie statusu
    // z listy blokujących. NIC INNEGO TEGO NIE PRZYKRYWA: przypadek jest tak
    // dobrany, że każdy z tych członów realnie uczestniczy w wyniku (jedna
    // sztuka w serwisie, jedna zajęta najmem, jedna wolna — trzy różne
    // odpowiedzi na trzech sztukach tego samego sprzętu).
    it("dzienna i katalogowa liczą TĄ SAMĄ regułą, co zakresowa (bufory + okno serwisowe)", async () => {
      const tenantId = await seedTenant(admin);
      const productId = await seedProduct(admin, tenantId, {
        buffer_before_days: 2,
        buffer_after_days: 2,
      });

      // Sztuka 1: w serwisie DOKŁADNIE przez środek zakresu.
      await seedUnits(admin, tenantId, productId, 1, {
        unavailable_from: "2027-05-12",
        unavailable_to: "2027-05-12",
      });
      // Sztuki 2 i 3: sprawne. Zamówienie blokujące dostaje WSKAZANĄ (drugą),
      // żeby stan magazynu nie zależał od kolejności zwróconej przez bazę —
      // trzy sztuki mają dać trzy RÓŻNE powody stanu, nie losowy rozkład.
      const [busyUnit] = await seedUnits(admin, tenantId, productId, 2);

      // Najem KOŃCZY SIĘ przed zakresem, ale bufor po najmie (2 dni) sięga
      // w zakres — to jest człon, który parafraza gubi najczęściej.
      await seedBlockingOrder(
        admin,
        tenantId,
        productId,
        busyUnit!,
        "2027-05-06",
        "2027-05-09",
        "Zajmujący Sprzęt",
      );

      const range = await rangeAvailability(anon, tenantId, productId, START, END);
      const days = await dayAvailability(anon, tenantId, productId, START, END);
      const catalog = await catalogAvailability(anon, tenantId, START, END);

      expect(range).not.toBeNull();
      expect(days).not.toBeNull();
      expect(catalog).not.toBeNull();

      // Katalogowa odpowiada CO DO LICZBY tej samej odpowiedzi, co zakresowa.
      const entry = catalog!.products.find((row) => row.product_id === productId);
      expect(entry, "sprzęt nie wszedł do odpowiedzi katalogowej").toBeDefined();
      expect(entry!.total_units).toBe(range!.total_units);
      expect(entry!.available_units).toBe(range!.available_units);

      // Dzienna: wynik zakresowy jest DOLNYM ograniczeniem każdego dnia
      // (sztuka wolna przez cały zakres jest wolna każdego dnia). Ta
      // nierówność jest jedyną, która wiąże obie funkcje NIEZALEŻNIE od
      // rozkładu zajętości — równość nie zachodzi i nie ma zachodzić.
      expect(days!.total_units).toBe(range!.total_units);
      for (const day of daysBetween(START, END)) {
        expect(days!.days[day], `brak dnia ${day} w mapie`).toBeTypeOf("number");
        expect(days!.days[day]!).toBeGreaterThanOrEqual(range!.available_units);
      }

      // Dzień po dniu: mapa musi zgadzać się CO DO LICZBY z zakresem
      // jednodniowym [d, d] — to jest właściwe porównanie, bo obie strony
      // odpowiadają wtedy na dokładnie to samo pytanie.
      for (const day of daysBetween(START, END)) {
        const single = await rangeAvailability(anon, tenantId, productId, day, day);
        expect(single, `zakres jednodniowy ${day} nieosiągalny`).not.toBeNull();
        expect(days!.days[day], `rozjazd reguły na dniu ${day}`).toBe(single!.available_units);
      }

      // Kontrola pozytywna przypadku: gdyby wszystkie sztuki były wolne przez
      // cały czas, powyższe równości zachodziłyby TRYWIALNIE. Zakres musi
      // realnie różnić się od stanu „wszystko wolne".
      expect(range!.total_units).toBe(3);
      expect(range!.available_units).toBeLessThan(range!.total_units);
      // Serwis stoi tylko 12 maja, więc mapa dzienna NIE jest stała —
      // dowód, że dni liczą się osobno, a nie jedną odpowiedzią zakresową.
      const distinct = new Set(daysBetween(START, END).map((day) => days!.days[day]));
      expect(distinct.size, "mapa dzienna jest stała — dni nie liczą się osobno").toBeGreaterThan(1);
    });

    // -----------------------------------------------------------------
    // 2. IZOLACJA DWÓCH NAJEMCÓW
    // -----------------------------------------------------------------
    //
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie któregokolwiek z trzech warunków
    // tenanckich w ciele — `pr.tenant_id = p_tenant_id` (wybór sprzętu),
    // `u.tenant_id = p.tenant_id` (zliczanie egzemplarzy),
    // `oi.tenant_id = p.tenant_id` (kolizje). Funkcje są SECURITY DEFINER,
    // więc RLS ich NIE przykrywa — te trzy warunki są całą izolacją.
    it("sprzęt najemcy A nie wychodzi ani jedną liczbą w kontekście najemcy B", async () => {
      const tenantA = await seedTenant(admin);
      const tenantB = await seedTenant(admin);

      // Ta sama nazwa u obu — gdyby wybór szedł po nazwie zamiast po najemcy,
      // test miałby czym to pokazać.
      const productA = await seedProduct(admin, tenantA, { name: "Przyczepka transportowa" });
      const productB = await seedProduct(admin, tenantB, { name: "Przyczepka transportowa" });
      await seedUnits(admin, tenantA, productA, 7);
      await seedUnits(admin, tenantB, productB, 2);

      // Katalog B widzi WYŁĄCZNIE swój sprzęt.
      const catalogB = await catalogAvailability(anon, tenantB, START, END);
      expect(catalogB).not.toBeNull();
      expect(catalogB!.products.map((row) => row.product_id)).toEqual([productB]);
      expect(catalogB!.products[0]!.total_units).toBe(2);

      // Liczba 7 (stan magazynu A) nie pojawia się w odpowiedzi B pod żadnym
      // kluczem — dowód, że nie przeciekła też jako suma czy total.
      expect(JSON.stringify(catalogB)).not.toContain('"total_units": 7');
      expect(catalogB!.products.some((row) => row.total_units === 7)).toBe(false);

      // Dostępność dzienna sprzętu A w kontekście B → NULL, nie zero i nie
      // pusta mapa: „nie ma o czym mówić" i „jest, ale zajęte" to dwa różne
      // zdania, a tylko pierwsze wolno tu powiedzieć.
      expect(await dayAvailability(anon, tenantB, productA, START, END)).toBeNull();
      // Ten sam sprzęt we WŁASNYM kontekście działa — kontrola pozytywna
      // dowodząca, że NULL wyżej to izolacja, a nie zepsuta fikstura.
      const ownA = await dayAvailability(anon, tenantA, productA, START, END);
      expect(ownA).not.toBeNull();
      expect(ownA!.total_units).toBe(7);

      // Najemca poza oknem handlowym: NULL obiema drogami.
      const dormant = await seedTenant(admin, "cancelled");
      const dormantProduct = await seedProduct(admin, dormant);
      await seedUnits(admin, dormant, dormantProduct, 3);
      expect(await catalogAvailability(anon, dormant, START, END)).toBeNull();
      expect(await dayAvailability(anon, dormant, dormantProduct, START, END)).toBeNull();
    });

    // -----------------------------------------------------------------
    // 3. WYŁĄCZNIE LICZBY (ADR-042) — z kontrolą pozytywną
    // -----------------------------------------------------------------
    //
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: dołożenie do koperty czegokolwiek, co pozwala
    // odtworzyć KTO i KIEDY zarezerwował — identyfikatora zamówienia,
    // identyfikatora egzemplarza, zakresu cudzego najmu.
    //
    // KONTROLA POZYTYWNA jest tu warunkiem sensu dowodu, a nie ozdobą: skan
    // odpowiedzi, na którą zamówienie nie wpłynęło, byłby skanem po pustym
    // zbiorze. Dlatego najpierw dowodzimy, że zamówienie ZMIENIŁO wynik.
    it("zamówienie blokujące zmienia liczbę, ale nie zostawia po sobie ani jednego śladu", async () => {
      const tenantId = await seedTenant(admin);
      const productId = await seedProduct(admin, tenantId, {
        buffer_before_days: 0,
        buffer_after_days: 0,
      });
      const [blockedUnit] = await seedUnits(admin, tenantId, productId, 2);

      const before = await dayAvailability(anon, tenantId, productId, START, END);
      expect(before!.days[START]).toBe(2);

      const blocking = await seedBlockingOrder(
        admin,
        tenantId,
        productId,
        blockedUnit!,
        START,
        END,
        "Katarzyna Zajmująca-Termin",
      );

      const after = await dayAvailability(anon, tenantId, productId, START, END);
      const afterCatalog = await catalogAvailability(anon, tenantId, START, END);

      // KONTROLA POZYTYWNA: zamówienie realnie uczestniczy w rachunku.
      expect(after!.days[START], "zamówienie nie wpłynęło na wynik — skan niżej nic nie dowodzi").toBe(1);
      expect(afterCatalog!.products[0]!.available_units).toBe(1);

      // Właściwy dowód: w odpowiedzi nie ma nic poza liczbami.
      const dayJson = JSON.stringify(after);
      const catalogJson = JSON.stringify(afterCatalog);
      for (const secret of [blocking.orderId, blocking.email, blocking.fullName]) {
        expect(dayJson, `wyciek '${secret}' w odpowiedzi dziennej`).not.toContain(secret);
        expect(catalogJson, `wyciek '${secret}' w odpowiedzi katalogowej`).not.toContain(secret);
      }

      // Klucze koperty wyliczone JAWNIE — dowód „nie ma nazwiska" jest słabszy
      // niż dowód „nie ma NICZEGO poza tym, co wymieniliśmy". Nowy klucz
      // w odpowiedzi wymaga świadomej zmiany tej listy.
      expect(Object.keys(after!).sort()).toEqual(["days", "total_units"]);
      expect(Object.keys(afterCatalog!)).toEqual(["products"]);
      expect(Object.keys(afterCatalog!.products[0]!).sort()).toEqual([
        "available_units",
        "product_id",
        "total_units",
      ]);

      // Wszystkie wartości mapy dziennej są LICZBAMI, a klucze — datami okna.
      for (const [day, units] of Object.entries(after!.days)) {
        expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(units).toBeTypeOf("number");
      }
      expect(Object.keys(after!.days).sort()).toEqual(daysBetween(START, END));
    });

    // -----------------------------------------------------------------
    // 4. SUFIT OKNA — egzekwowany przez BAZĘ, nie przez interfejs
    // -----------------------------------------------------------------
    //
    // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie warunku szerokości z ciała funkcji albo
    // rozjazd między literałem w SQL-u a stałą rdzenia. Szerokość liczy się
    // TUTAJ ze stałej rdzenia, więc test jest WIĄZANIEM dwóch miejsc, a nie
    // trzecią kopią liczby.
    //
    // NIC INNEGO TEGO NIE PRZYKRYWA: interfejs nie bierze udziału w tym
    // teście — wywołanie idzie rolą anon wprost do PostgREST-a, dokładnie tak,
    // jak zrobiłby to ktoś z curl-em.
    it("okno o szerokości sufitu przechodzi, o dzień szersze — NULL", async () => {
      const tenantId = await seedTenant(admin);
      const productId = await seedProduct(admin, tenantId);
      await seedUnits(admin, tenantId, productId, 1);

      const atCeiling = addDays(START, AVAILABILITY_WINDOW_MAX_DAYS - 1);
      const overCeiling = addDays(START, AVAILABILITY_WINDOW_MAX_DAYS);

      const ok = await dayAvailability(anon, tenantId, productId, START, atCeiling);
      expect(ok, "okno o szerokości dokładnie sufitu zostało odrzucone").not.toBeNull();
      expect(Object.keys(ok!.days)).toHaveLength(AVAILABILITY_WINDOW_MAX_DAYS);

      expect(
        await dayAvailability(anon, tenantId, productId, START, overCeiling),
        "okno szersze niż sufit NIE zostało odrzucone",
      ).toBeNull();

      // Sufit dotyczy WYŁĄCZNIE funkcji dziennej — katalogowa oddaje jeden
      // wiersz na pozycję niezależnie od szerokości okna, więc najem
      // półroczny musi przez nią przejść.
      const halfYear = addDays(START, 180);
      expect(await catalogAvailability(anon, tenantId, START, halfYear)).not.toBeNull();

      // Zakres odwrócony: NULL obiema drogami, nieodróżnialnie od braku sprzętu.
      expect(await dayAvailability(anon, tenantId, productId, END, START)).toBeNull();
      expect(await catalogAvailability(anon, tenantId, END, START)).toBeNull();
    });
  },
);
