/**
 * BILET ZAUFANEJ GRANICY CHECKOUTU — strona WERYFIKUJĄCA (R13, audyt H-02,
 * migracja 0059, ADR-125).
 *
 * To jest dowód na naprawę znaleziska KRYTYCZNEGO. Znalezisko brzmiało: rola
 * `anon` ma EXECUTE na `app.public_checkout`, więc bot woła ją wprost,
 * z pominięciem Server Action — a więc i honeypotu, limitu per IP i Turnstile
 * — i produkuje trwałe zamówienia `pending`, które zdejmują egzemplarze
 * z dostępności. Dlatego wszystkie sondy jadą PRAWDZIWĄ ROLĄ `anon` na żywej
 * bazie, a nie przez zaślepkę: mierzymy dokładnie ten wektor, który zgłosił
 * audyt.
 *
 * ==================== JAK TE SONDY SĄ IZOLOWANE ====================
 *
 * `app.checkout_ticket_keys` jest tabelą GLOBALNĄ — jeden aktywny klucz
 * przełącza bramkę dla CAŁEJ bazy. Lokalny Supabase jest współdzielony przez
 * równoległe sesje, a pliki testowe vitest jadą równolegle, więc zasianie
 * klucza „na chwilę" wywróciłoby cudze checkouty (i cudze suity) w losowym
 * momencie.
 *
 * Dlatego każda sonda mieści się w JEDNEJ TRANSAKCJI: klucz jest wstawiany
 * i nigdy nie commitowany. Niezacommitowany wiersz jest niewidoczny dla
 * wszystkich innych połączeń, więc bramka jest włączona WYŁĄCZNIE wewnątrz
 * naszej transakcji i wyłącznie na czas sondy. Skutki uboczne (zamówienia,
 * klienci, nonce) znikają razem z ROLLBACK-iem — mierzymy je PRZED nim, więc
 * dowód jest pełny mimo braku śladu w bazie.
 *
 * Konsekwencja dla reszty repo: baza bez zasianego klucza stoi na DEV-SKIPIE,
 * więc pozostałe suity checkoutu (public-checkout, custom-fields-checkout,
 * customer-bans, orders-currency…) działają bez zmian i BEZ biletu. To ta sama
 * decyzja co przy Turnstile — i ta sama cena, opisana wprost w nagłówku 0059:
 * produkcja bez zasianego klucza jedzie z bramką otwartą.
 *
 * ==================== WEKTOR WZORCOWY (KONTRAKT Node↔SQL) ====================
 *
 * Podpis liczy Node (`apps/storefront/lib/checkout/ticket.ts`), a sprawdza SQL
 * — dwie różne implementacje HMAC nad tym samym komunikatem. Rozjazd
 * kanonizacji nie byłby luką, byłby AWARIĄ SPRZEDAŻY: baza odrzucałaby każdy
 * prawdziwy checkout. Te same literały siedzą w
 * `apps/storefront/test/checkout-ticket.test.ts`; jednostronna zmiana formatu
 * zapala jedną z dwóch suit.
 */
import { createHmac, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import postgres from "postgres";
import WebSocket from "ws";
import { afterAll, describe, expect, it } from "vitest";

import { integrationEnv } from "./helpers/integration-env";

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

const realtimeTransport = {
  realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
};

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

/** Sekret sondy — istnieje wyłącznie wewnątrz wycofywanych transakcji. */
const SECRET = "test-secret-000000000000000000000000";
const KEY_VERSION = 90_059;

/** Wektor wzorcowy — te same literały co w apps/storefront/test/checkout-ticket.test.ts. */
const VECTOR = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  exp: 2_000_000_000,
  nonce: "abc123",
  sig: "1497a45f52997a0249184349e1bca0c24bb320b8ec9802329a1bfe354e178aca",
} as const;

/** Kanonizacja — LUSTRO `checkoutTicketMessage` z Node i `v_message` z 0059. */
function sign(tenantId: string, exp: number, nonce: string, secret = SECRET): string {
  return createHmac("sha256", secret)
    .update(`${tenantId.trim().toLowerCase()}.${exp}.${nonce}`)
    .digest("hex");
}

interface Ticket {
  exp: number | null;
  nonce: string | null;
  sig: string | null;
}

/** Bilet ważny dla tego tenanta, wystawiony „teraz". */
function goodTicket(tenantId: string, overrides: Partial<Ticket> = {}): Ticket {
  const exp = Math.floor(Date.now() / 1000) + 900;
  const nonce = randomUUID();
  return { exp, nonce, sig: sign(tenantId, exp, nonce), ...overrides };
}

const PUSTY: Ticket = { exp: null, nonce: null, sig: null };

class Rollback extends Error {}

type Sql = ReturnType<typeof postgres>;

interface ProbeResult {
  /** Czy wywołanie przeszło (zamówienie powstało). */
  ok: boolean;
  /** SQLSTATE odmowy, gdy nie przeszło. */
  code?: string;
  /** Liczby wierszy policzone PRZED wycofaniem transakcji. */
  orders: number;
  customers: number;
  items: number;
}

interface Seed {
  tenantId: string;
  productId: string;
  pickupId: string;
}

/**
 * Jedna sonda = jedna transakcja. Opcjonalnie zasiewa klucz (bramka włączona),
 * przełącza się na PRAWDZIWĄ rolę `anon`, woła `app.public_checkout` biletem
 * z argumentu, mierzy skutki i wycofuje wszystko.
 *
 * Kolejność wywołań w `tickets` jest istotna dla sondy REPLAY: drugi element
 * dostaje bazę w stanie po pierwszym, wewnątrz tej samej transakcji.
 */
async function probe(
  sql: Sql,
  seed: Seed,
  tickets: Ticket[],
  opts: {
    seedKey: boolean;
    tenantOverride?: string;
    /**
     * Indeks (0-based) w `tickets`, PO którym ten sam klucz (KEY_VERSION)
     * dostaje `active = false` — w tej samej transakcji, więc kolejne
     * wywołanie widzi bazę w stanie „był aktywny klucz, teraz go nie ma"
     * (rotacja/dezaktywacja), a nie „nigdy nie było klucza" (brak seeda).
     * Używane do pinowania kontraktu: dezaktywacja JEDYNEGO klucza otwiera
     * bramkę (dev-skip), nie zamyka checkoutu.
     */
    deactivateKeyAfterIndex?: number;
  } = { seedKey: true },
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  try {
    await sql.begin(async (tx) => {
      if (opts.seedKey) {
        await tx`
          insert into app.checkout_ticket_keys (key_version, secret, active)
          values (${KEY_VERSION}, ${SECRET}, true)
        `;
      }

      for (const [index, ticket] of tickets.entries()) {
        let ok = true;
        let code: string | undefined;
        try {
          // Savepoint, bo odmowa przerywa transakcję — bez niego kolejne
          // zapytania (w tym samo liczenie skutków) padłyby na „aborted".
          await tx.savepoint(async (sp) => {
            await sp`set local role anon`;
            await sp`
              select app.public_checkout(
                ${opts.tenantOverride ?? seed.tenantId}::uuid,
                ${`bilet-${randomUUID().slice(0, 8)}@test.local`},
                'Kupujący', null,
                '2026-11-02'::date, '2026-11-04'::date, 'pickup', ${seed.pickupId}::uuid,
                ${sp.json([{ product_id: seed.productId, quantity: 1 }])}::jsonb,
                'v1', 'pl',
                null, null, null, null, null, null,
                'transfer', '{}'::jsonb, '{}'::jsonb,
                ${ticket.exp}::bigint, ${ticket.nonce}::text, ${ticket.sig}::text
              )
            `;
            await sp`reset role`;
          });
        } catch (error) {
          ok = false;
          code = (error as { code?: string }).code;
        }

        // Liczymy jako superuser (RLS omijane), wewnątrz transakcji — czyli
        // widzimy WSZYSTKO, co sonda zdążyła utrwalić, także to, co zaraz
        // zniknie w ROLLBACK-u.
        await tx`reset role`;
        const [{ orders }] = await tx<{ orders: number }[]>`
          select count(*)::int as orders from public.orders where tenant_id = ${seed.tenantId}
        `;
        const [{ customers }] = await tx<{ customers: number }[]>`
          select count(*)::int as customers from public.customers where tenant_id = ${seed.tenantId}
        `;
        const [{ items }] = await tx<{ items: number }[]>`
          select count(*)::int as items from public.order_items where tenant_id = ${seed.tenantId}
        `;
        results.push({ ok, code, orders, customers, items });

        if (opts.deactivateKeyAfterIndex === index) {
          await tx`
            update app.checkout_ticket_keys set active = false where key_version = ${KEY_VERSION}
          `;
        }
      }

      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
  return results;
}

const createdTenantIds: string[] = [];

async function seedAll(admin: SupabaseClient): Promise<Seed> {
  const slug = `bilet-${randomUUID().slice(0, 12)}`.slice(0, 39);
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ slug, name: "Bilet checkoutu", status: "active", locale: "pl" })
    .select("id")
    .single();
  if (tenantError || !tenant) throw new Error(`Tenant: ${tenantError?.message}`);
  const tenantId = tenant.id as string;
  createdTenantIds.push(tenantId);

  const { data: product, error: productError } = await admin
    .from("products")
    .insert({
      tenant_id: tenantId,
      name: `Produkt ${randomUUID().slice(0, 8)}`,
      base_price_day_grosze: 10_000,
      deposit_grosze: 5_000,
    })
    .select("id")
    .single();
  if (productError || !product) throw new Error(`Produkt: ${productError?.message}`);

  const { data: pickup, error: pickupError } = await admin
    .from("pickup_locations")
    .insert({ tenant_id: tenantId, name: "Magazyn", address_city: "Warszawa" })
    .select("id")
    .single();
  if (pickupError || !pickup) throw new Error(`Punkt odbioru: ${pickupError?.message}`);

  const { error: unitsError } = await admin.from("product_units").insert(
    Array.from({ length: 5 }, () => ({
      tenant_id: tenantId,
      product_id: product.id as string,
      serial_number: `SN-${randomUUID().slice(0, 8)}`,
    })),
  );
  if (unitsError) throw new Error(`Egzemplarze: ${unitsError.message}`);

  return { tenantId, productId: product.id as string, pickupId: pickup.id as string };
}

describe.skipIf(!hasEnv)("app.assert_checkout_ticket / app.public_checkout — bilet 0059", () => {
  const admin = hasEnv ? adminClient() : (null as unknown as SupabaseClient);
  const sql = hasEnv ? postgres(env("SUPABASE_LOCAL_URL"), { max: 4 }) : (null as unknown as Sql);

  afterAll(async () => {
    if (!hasEnv) return;
    if (createdTenantIds.length > 0) {
      await admin.from("tenants").delete().in("id", createdTenantIds);
      createdTenantIds.length = 0;
    }
    await sql.end({ timeout: 5 });
    // Zapadka higieny: gdyby jakakolwiek sonda zacommitowała klucz, zdejmujemy
    // go — inaczej współdzielona baza lokalna zostałaby z włączoną bramką
    // i wywracała checkout wszystkim innym sesjom.
    const guard = postgres(env("SUPABASE_LOCAL_URL"), { max: 1 });
    await guard`delete from app.checkout_ticket_keys where key_version = ${KEY_VERSION}`;
    await guard.end({ timeout: 5 });
  });

  // -------------------------------------------------------------------
  // 1. SEDNO H-02: anon bez biletu nie tworzy NICZEGO
  // -------------------------------------------------------------------
  it("H-02: anon woła public_checkout BEZ biletu → 22023 i zero klientów, zamówień, pozycji", async () => {
    const seed = await seedAll(admin);
    const [bez] = await probe(sql, seed, [PUSTY], { seedKey: true });

    expect(bez.ok, "wywołanie bez biletu przeszło — H-02 nadal otwarte").toBe(false);
    expect(bez.code, "odmowa musi być nierozróżnialna (22023)").toBe("22023");
    // To jest zdanie z audytu, zmierzone wynikiem: „nie tworzy klienta,
    // zamówienia ani pozycji".
    expect(bez.orders).toBe(0);
    expect(bez.customers).toBe(0);
    expect(bez.items).toBe(0);
  });

  it("KONTROLA POZYTYWNA: ta sama sonda BEZ zasianego klucza (dev-skip) tworzy zamówienie", async () => {
    const seed = await seedAll(admin);
    // Bez tej kontroli sonda wyżej nie dowodziłaby niczego: mogłaby być
    // czerwona z powodu złego seeda, nieaktywnego tenanta albo literówki
    // w wywołaniu. Tu ten sam kod, te same dane, jedyna różnica to obecność
    // klucza — i wynik jest odwrotny.
    const [devSkip] = await probe(sql, seed, [PUSTY], { seedKey: false });

    expect(devSkip.ok, "dev-skip nie przepuścił checkoutu bez biletu").toBe(true);
    expect(devSkip.orders).toBe(1);
    expect(devSkip.customers).toBe(1);
    expect(devSkip.items).toBe(1);
  });

  it("ROTACJA: dezaktywacja JEDYNEGO klucza (active=false) OTWIERA bramkę, nie ZAMYKA checkoutu", async () => {
    // Sonda wyżej pokrywa dev-skip w wariancie „nigdy nie było klucza".
    // Ten test pokrywa DRUGIE wejście w ten sam stan bramki: klucz ISTNIAŁ
    // i BLOKOWAŁ, potem ktoś zrobił `update ... set active = false` — czyli
    // dokładnie krok drugi klasycznej (błędnej) rotacji.
    //
    // KONTRAKT, NIE PRZYPADEK. `active=false` na jedynym kluczu nie wyłącza
    // checkoutu — otwiera H-02 na oścież, cicho: jedynym sygnałem jest
    // `raise warning` w logach bazy (app.assert_checkout_ticket, 0059), a nie
    // błąd czy odmowa, których ktokolwiek by pilnował. Dlatego POPRAWNA
    // rotacja (nagłówek 0059, komentarz „Rotacja") idzie w kolejności
    // „najpierw wstaw NOWY aktywny klucz, POTEM dezaktywuj STARY" — w każdej
    // chwili istnieje przynajmniej jeden aktywny wiersz. Odwrotna kolejność
    // (dezaktywacja przed wstawieniem nowego) przechodzi przez dokładnie ten
    // stan, który ten test pinuje jako świadomy, przetestowany kontrakt —
    // żeby regres w tym zachowaniu (np. gdyby ktoś kiedyś zmienił bramkę na
    // fail-closed przy braku klucza) zapalił czerwony test, a nie czekał na
    // audyt.
    const seed = await seedAll(admin);

    // Jedna transakcja, dwa wywołania tym samym pustym biletem: pierwsze przy
    // active=true (kontrola pozytywna — bramka MUSI blokować, inaczej wynik
    // drugiego wywołania nic by nie dowodził), drugie PO `update ... set
    // active = false` na tym samym kluczu (wykonanym przez `probe` między
    // wywołaniami — patrz opts.deactivateKeyAfterIndex).
    const [zAktywnymKluczem, poDezaktywacji] = await probe(sql, seed, [PUSTY, PUSTY], {
      seedKey: true,
      deactivateKeyAfterIndex: 0,
    });

    // A) Kontrola pozytywna: klucz active=true blokuje pusty bilet jak
    // w sondzie H-02 wyżej.
    expect(
      zAktywnymKluczem.ok,
      "klucz active=true nie zablokował pustego biletu — kontrola pozytywna sondy nie działa",
    ).toBe(false);
    expect(zAktywnymKluczem.code).toBe("22023");
    expect(zAktywnymKluczem.orders).toBe(0);

    // B) Ten sam klucz, `active=false`: bramka wraca w dev-skip i PRZEPUSZCZA
    // dokładnie ten sam (pusty) bilet, który przed chwilą blokowała.
    expect(
      poDezaktywacji.ok,
      "active=false na jedynym kluczu NIE otworzyło bramki — kontrakt się zmienił: " +
        "zaktualizuj nagłówek 0059 („DEV-SKIP I JEGO CENA”) i notę w ADR-125, bo opis " +
        "ryzyka rotacji przestał być prawdziwy",
    ).toBe(true);
    expect(poDezaktywacji.orders, "dev-skip po dezaktywacji nie utworzył zamówienia").toBe(1);
  });

  it("KONTROLA POZYTYWNA: bilet WAŻNY przy włączonej bramce tworzy zamówienie", async () => {
    const seed = await seedAll(admin);
    const [ok] = await probe(sql, seed, [goodTicket(seed.tenantId)], { seedKey: true });

    expect(ok.ok, "ważny bilet został odrzucony — bramka odcina prawdziwych klientów").toBe(true);
    expect(ok.orders).toBe(1);
    expect(ok.items).toBe(1);
  });

  // -------------------------------------------------------------------
  // 2. WARIANTY ODMOWY: zły podpis, wygasły, replay, cross-tenant
  // -------------------------------------------------------------------
  it("ZŁY PODPIS: bilet podpisany innym sekretem → 22023, zero wierszy", async () => {
    const seed = await seedAll(admin);
    const exp = Math.floor(Date.now() / 1000) + 900;
    const nonce = randomUUID();
    const podrobiony: Ticket = {
      exp,
      nonce,
      sig: sign(seed.tenantId, exp, nonce, "sekret-atakujacego-00000000000000"),
    };

    const [zly] = await probe(sql, seed, [podrobiony], { seedKey: true });
    expect(zly.ok).toBe(false);
    expect(zly.code).toBe("22023");
    expect(zly.orders).toBe(0);
  });

  it("PODMIANA POLA: przedłużenie exp przy zachowanym podpisie → 22023", async () => {
    const seed = await seedAll(admin);
    const bazowy = goodTicket(seed.tenantId);
    // Klasyczna próba: weź ważny bilet, przesuń termin, zostaw podpis.
    const przedluzony: Ticket = { ...bazowy, exp: (bazowy.exp as number) + 100_000 };

    const [wynik] = await probe(sql, seed, [przedluzony], { seedKey: true });
    expect(wynik.ok).toBe(false);
    expect(wynik.code).toBe("22023");
    expect(wynik.orders).toBe(0);
  });

  it("WYGASŁY: poprawnie podpisany bilet sprzed godziny → 22023, zero wierszy", async () => {
    const seed = await seedAll(admin);
    const exp = Math.floor(Date.now() / 1000) - 3600;
    const nonce = randomUUID();
    const wygasly: Ticket = { exp, nonce, sig: sign(seed.tenantId, exp, nonce) };

    const [wynik] = await probe(sql, seed, [wygasly], { seedKey: true });
    expect(wynik.ok, "wygasły bilet przeszedł").toBe(false);
    expect(wynik.code).toBe("22023");
    expect(wynik.orders).toBe(0);
  });

  it("TOLERANCJA ZEGARA: bilet przeterminowany o 5 s wciąż przechodzi (DB≠Vercel)", async () => {
    const seed = await seedAll(admin);
    const exp = Math.floor(Date.now() / 1000) - 5;
    const nonce = randomUUID();
    const ledwo: Ticket = { exp, nonce, sig: sign(seed.tenantId, exp, nonce) };

    // Bez marginesu rozjazd zegarów o sekundę odrzucałby prawdziwe checkouty.
    const [wynik] = await probe(sql, seed, [ledwo], { seedKey: true });
    expect(wynik.ok, "margines tolerancji zegara nie działa").toBe(true);
  });

  it("BILET Z PRZYSZŁOŚCI: exp o 3 h do przodu → 22023 (górna granica ważności)", async () => {
    const seed = await seedAll(admin);
    const exp = Math.floor(Date.now() / 1000) + 3 * 3600;
    const nonce = randomUUID();
    const zPrzyszlosci: Ticket = { exp, nonce, sig: sign(seed.tenantId, exp, nonce) };

    const [wynik] = await probe(sql, seed, [zPrzyszlosci], { seedKey: true });
    expect(wynik.ok).toBe(false);
    expect(wynik.code).toBe("22023");
  });

  it("REPLAY: ten sam bilet użyty DRUGI raz → 22023 i nadal dokładnie jedno zamówienie", async () => {
    const seed = await seedAll(admin);
    const bilet = goodTicket(seed.tenantId);

    // Oba wywołania w JEDNEJ transakcji, więc drugie widzi nonce zużyty przez
    // pierwsze — dokładnie tak, jak dwa żądania bota po sobie na produkcji.
    const [pierwsze, drugie] = await probe(sql, seed, [bilet, bilet], { seedKey: true });

    expect(pierwsze.ok, "pierwsze użycie ważnego biletu odrzucone").toBe(true);
    expect(pierwsze.orders).toBe(1);
    expect(drugie.ok, "POWTÓRZONY bilet przeszedł — jednorazowość nie działa").toBe(false);
    expect(drugie.code).toBe("22023");
    // Kluczowy pomiar: powtórka NIE dołożyła drugiego zamówienia.
    expect(drugie.orders, "replay utworzył kolejne zamówienie").toBe(1);
  });

  it("CROSS-TENANT: bilet wystawiony dla sklepu A nie działa na sklepie B", async () => {
    const a = await seedAll(admin);
    const b = await seedAll(admin);

    // Podpis liczony dla TENANTA A, wywołanie kierowane na TENANTA B.
    const exp = Math.floor(Date.now() / 1000) + 900;
    const nonce = randomUUID();
    const biletA: Ticket = { exp, nonce, sig: sign(a.tenantId, exp, nonce) };

    const [wynik] = await probe(sql, b, [biletA], { seedKey: true });
    expect(wynik.ok, "bilet cudzego sklepu otworzył zapis — wiązanie tenanta nie działa").toBe(
      false,
    );
    expect(wynik.code).toBe("22023");
    expect(wynik.orders).toBe(0);
  });

  it("JEDNOLITOŚĆ ODMÓW: brak / zły / wygasły / zużyty dają IDENTYCZNY komunikat i kod", async () => {
    const seed = await seedAll(admin);
    const zuzyty = goodTicket(seed.tenantId);
    const exp = Math.floor(Date.now() / 1000);
    const komunikaty: string[] = [];

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.checkout_ticket_keys (key_version, secret, active)
          values (${KEY_VERSION}, ${SECRET}, true)
        `;
        // Zużywamy nonce, żeby czwarty wariant („powtórzony") był realny.
        await tx`select app.assert_checkout_ticket(${seed.tenantId}::uuid, ${zuzyty.exp}::bigint, ${zuzyty.nonce}::text, ${zuzyty.sig}::text)`;

        const warianty: Ticket[] = [
          PUSTY,
          { exp: exp + 900, nonce: "n1", sig: "0".repeat(64) },
          { exp: exp - 7200, nonce: "n2", sig: sign(seed.tenantId, exp - 7200, "n2") },
          zuzyty,
        ];

        for (const w of warianty) {
          try {
            await tx.savepoint(
              async (sp) =>
                void (await sp`select app.assert_checkout_ticket(${seed.tenantId}::uuid, ${w.exp}::bigint, ${w.nonce}::text, ${w.sig}::text)`),
            );
            komunikaty.push("PRZESZŁO");
          } catch (error) {
            komunikaty.push(`${(error as { code?: string }).code}|${(error as Error).message}`);
          }
        }
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    // Cztery różne przyczyny, JEDEN komunikat. Rozróżnienie byłoby wyrocznią:
    // „ten podpis był poprawny, ale bilet wygasł" mówi atakującemu, że trafił
    // w sekret.
    expect(komunikaty).toHaveLength(4);
    expect(new Set(komunikaty).size, `odmowy się różnią: ${komunikaty.join(" // ")}`).toBe(1);
    expect(komunikaty[0]).toContain("22023");
  });

  // -------------------------------------------------------------------
  // 3. KONTRAKT Node↔SQL
  // -------------------------------------------------------------------
  it("WEKTOR WZORCOWY: baza przyjmuje podpis policzony przez Node co do znaku", async () => {
    // Ten sam literał podpisu leży w apps/storefront/test/checkout-ticket.test.ts
    // jako oczekiwane WYJŚCIE issueCheckoutTicket. Zgodność obu stron jest tu
    // jedyną rzeczą pod testem — dlatego wołamy samą bramkę, bez checkoutu.
    expect(sign(VECTOR.tenantId, VECTOR.exp, VECTOR.nonce)).toBe(VECTOR.sig);

    let przeszlo = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.checkout_ticket_keys (key_version, secret, active)
          values (${KEY_VERSION}, ${SECRET}, true)
        `;
        // Zamrożony exp z wektora dawno minął, więc podmieniamy sam termin na
        // świeży i liczymy podpis TĄ SAMĄ funkcją — a niezmienność samego
        // podpisu wektora sprawdza assert wyżej.
        const exp = Math.floor(Date.now() / 1000) + 600;
        await tx`select app.assert_checkout_ticket(${VECTOR.tenantId}::uuid, ${exp}::bigint, ${VECTOR.nonce}::text, ${sign(VECTOR.tenantId, exp, VECTOR.nonce)}::text)`;
        przeszlo = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(przeszlo, "baza odrzuciła podpis policzony przez Node").toBe(true);
  });

  // -------------------------------------------------------------------
  // 4. IZOLACJA SEKRETU: nikt poza właścicielem nie czyta tabel biletu
  // -------------------------------------------------------------------
  it("SEKRET NIEDOSTĘPNY: anon, authenticated i service_role nie czytają tabel biletu", async () => {
    const role = ["anon", "authenticated", "service_role"] as const;
    const tabele = ["checkout_ticket_keys", "checkout_ticket_nonces"] as const;

    for (const r of role) {
      for (const t of tabele) {
        // Najpierw ODCZYT KATALOGU: czy rola W OGÓLE ma prawo SELECT.
        const [{ ma }] = await sql<{ ma: boolean }[]>`
          select has_table_privilege(${r}, ${`app.${t}`}, 'SELECT') as ma
        `;
        expect(ma, `${r} ma grant SELECT na app.${t}`).toBe(false);

        // Potem SONDA ŻYWA: samo prawo w katalogu bywa mylące (default
        // privileges, dziedziczenie po PUBLIC), więc próbujemy naprawdę czytać.
        let odmowa: string | undefined;
        try {
          await sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${r}`);
            await tx.unsafe(`select * from app.${t} limit 1`);
            throw new Rollback();
          });
        } catch (error) {
          if (error instanceof Rollback) odmowa = "BRAK ODMOWY";
          else odmowa = (error as { code?: string }).code;
        }
        expect(odmowa, `${r} odczytał app.${t}`).toBe("42501");
      }
    }
  });

  it("SEKRET NIEDOSTĘPNY PRZEZ POSTGREST: anon key nie wyciąga klucza po HTTP", async () => {
    // Schemat `app` jest wystawiony w PostgREST (RPC checkoutu jedzie przez
    // .schema("app")), więc to nie jest sonda teoretyczna — bez rewokacji
    // tabela byłaby czytelna zwykłym GET-em kluczem z kodu strony.
    const { data, error } = await anonClient()
      .schema("app")
      .from("checkout_ticket_keys")
      .select("secret");

    expect(error, "PostgREST oddał sekret podpisu bez błędu").not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("SEKRET NIEDOSTĘPNY PRZEZ POSTGREST: service_role też nie czyta tabel biletu", async () => {
    // service_role omija RLS, ale NIE omija braku grantu — i to jest tu
    // jedyna linia obrony, więc mierzymy ją osobno.
    const { data, error } = await adminClient()
      .schema("app")
      .from("checkout_ticket_keys")
      .select("secret");

    expect(error, "service_role oddał sekret podpisu").not.toBeNull();
    expect(data ?? []).toEqual([]);
  });

  it("BRAMKA JEST WEWNĘTRZNA: anon nie może zawołać assert_checkout_ticket wprost", async () => {
    // Wystawienie bramki anonowi zamieniłoby ją w wyrocznię „czy ten bilet
    // jest ważny" — darmowe stanowisko do testowania podrobionych podpisów.
    const { error } = await anonClient()
      .schema("app")
      .rpc("assert_checkout_ticket", {
        p_tenant_id: VECTOR.tenantId,
        p_exp: VECTOR.exp,
        p_nonce: VECTOR.nonce,
        p_sig: VECTOR.sig,
      });
    expect(error, "anon zawołał wewnętrzną bramkę biletu").not.toBeNull();
  });

  // -------------------------------------------------------------------
  // 5. HIGIENA TABELI NONCE
  // -------------------------------------------------------------------
  it("NONCE TRZYMANY JAKO HASH — surowa wartość nie leży w bazie", async () => {
    const seed = await seedAll(admin);
    const bilet = goodTicket(seed.tenantId);
    let wiersz: { nonce_hash: string; tenant_id: string } | undefined;

    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.checkout_ticket_keys (key_version, secret, active)
          values (${KEY_VERSION}, ${SECRET}, true)
        `;
        await tx`select app.assert_checkout_ticket(${seed.tenantId}::uuid, ${bilet.exp}::bigint, ${bilet.nonce}::text, ${bilet.sig}::text)`;
        const rows = await tx<{ nonce_hash: string; tenant_id: string }[]>`
          select nonce_hash, tenant_id from app.checkout_ticket_nonces
          where tenant_id = ${seed.tenantId}
        `;
        wiersz = rows[0];
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect(wiersz, "konsumpcja nonce nie zostawiła wiersza").toBeDefined();
    expect(wiersz?.nonce_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(wiersz?.nonce_hash, "w tabeli leży SUROWY nonce, nie hash").not.toBe(bilet.nonce);
    expect(
      createHmac("sha256", "x").update("x").digest("hex").length,
      "sanity: długość hexa sha256",
    ).toBe(64);
  });

  it("SPRZĄTANIE: purge kasuje nonce dawno wygasłe, a ŚWIEŻE zostawia", async () => {
    let stareZnikly = false;
    let swiezeZostaly = false;
    try {
      await sql.begin(async (tx) => {
        await tx`
          insert into app.checkout_ticket_nonces (nonce_hash, tenant_id, expires_at)
          values (${"a".repeat(64)}, ${VECTOR.tenantId}::uuid, now() - interval '30 days'),
                 (${"b".repeat(64)}, ${VECTOR.tenantId}::uuid, now() + interval '10 minutes')
        `;
        await tx`select app.purge_checkout_ticket_nonces()`;
        const [{ stare }] = await tx<{ stare: number }[]>`
          select count(*)::int as stare from app.checkout_ticket_nonces where nonce_hash = ${"a".repeat(64)}
        `;
        const [{ swieze }] = await tx<{ swieze: number }[]>`
          select count(*)::int as swieze from app.checkout_ticket_nonces where nonce_hash = ${"b".repeat(64)}
        `;
        stareZnikly = stare === 0;
        // Skasowanie WCIĄŻ WAŻNEGO nonce przywróciłoby możliwość replayu —
        // to jest jedyna rzecz, której purge zrobić nie wolno.
        swiezeZostaly = swieze === 1;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }

    expect(stareZnikly, "purge nie skasował wygasłego nonce").toBe(true);
    expect(swiezeZostaly, "purge skasował WAŻNY nonce — otwiera replay").toBe(true);
  });
});
