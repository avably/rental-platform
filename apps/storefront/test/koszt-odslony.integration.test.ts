/**
 * KOSZT ODSŁONY SKLEPU — ILE ZAPYTAŃ I ILE BAJTÓW (faza 4a, ADR-185).
 *
 * ==================== CO TEN PLIK MIERZY ====================
 *
 * Zadanie jest wydajnościowe, więc bramką nie jest „kod woła wąską funkcję",
 * tylko RACHUNEK ODSŁONY: ile żądań do PostgREST wychodzi przy renderze strony
 * i ile bajtów wraca. Licznik stoi na `globalThis.fetch`, czyli w miejscu,
 * w którym dane NAPRAWDĘ przekraczają granicę procesu — nie na wywołaniu
 * funkcji warstwy danych. Różnica jest cała: licznik wpięty w `getPublicCatalog`
 * pokazałby zero także wtedy, gdyby katalog przyjechał inną drogą.
 *
 * ==================== DLACZEGO 200 POZYCJI ====================
 *
 * Dokument architektury liczy koszt fazy 4 właśnie na tej skali („przy 200
 * produktach około 160 KB na żądanie"). Na katalogu pięciu pozycji różnica
 * między pełnym katalogiem a jedną pozycją mieści się w szumie i każda liczba
 * wygląda dobrze.
 *
 * ==================== JAK TO POWTÓRZYĆ ====================
 *
 *   1. `supabase start` w `packages/db`
 *   2. `SUPABASE_LOCAL_API_URL=… SUPABASE_LOCAL_ANON_KEY=… SUPABASE_LOCAL_SERVICE_ROLE_KEY=… \
 *       FAZA4A_RAPORT=/tmp/raport.txt \
 *       corepack pnpm --filter storefront exec vitest run test/koszt-odslony.integration.test.ts`
 *
 * FIKSTURA ZAKŁADA SIĘ SAMA i po sobie sprząta. Pierwsza wersja tego pliku
 * wymagała wgrania `docs/pomiary/faza4a-fikstura.sql` ręcznie — i przez to
 * padła w CI, gdzie zmienne `SUPABASE_LOCAL_*` SĄ, a fikstury nie ma. Skoro
 * suita i tak ma bazę, ma też obowiązek przygotować sobie dane: dzięki temu
 * rachunek odsłony jest BRAMKĄ CI, a nie jednorazowym pomiarem. Ten sam plik
 * SQL zostaje w repo do ręcznych oględzin w przeglądarce.
 *
 * Identyfikatory najemców są losowe per przebieg — lokalna baza bywa
 * współdzielona między równoległymi sesjami i stała fikstura kasowałaby cudzą.
 *
 * Bez zmiennych plik jest POMIJANY (jak reszta suit integracyjnych),
 * a nie zielony — pominięcie widać w podsumowaniu vitest.
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ReactNode } from "react";

import { createClient } from "@supabase/supabase-js";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* -------------------------------------------------------------------------
 * Fikstura — lustro docs/pomiary/faza4a-fikstura.sql
 * ---------------------------------------------------------------------- */

/** Ile pozycji ma katalog pomiarowy. Dokument liczy koszt fazy 4 na tej skali. */
const POZYCJI = 200;

/** Znacznik przebiegu — izoluje fiksturę od równoległych sesji na tej samej bazie. */
const BIEG = randomUUID().slice(0, 8);

/** Pozycja nr 1 — TEN SAM slug u obu najemców (fikstura izolacji). */
const SLUG_WSPOLNY = `wiertarka-udarowa-${BIEG}`;
const NAZWA_A_1 = `Alfa ${BIEG} sprzet 001`;
const NAZWA_B_1 = `Beta ${BIEG} sprzet 001`;

/**
 * Pozycja, której strona sprzętu NIE POKAZUJE. Nazwa jest unikatowa w całej
 * fiksturze, więc jej obecność w ruchu do bazy znaczy dokładnie jedno: ciągniemy
 * pozycje, których nie wyświetlamy. Asercja „gdziekolwiek w wyjściu" ma tu sens
 * WYŁĄCZNIE dlatego, że ta wartość nie ma prawa stać tam z żadnego innego
 * powodu — inaczej byłaby to bramka, która przechodzi przypadkiem.
 */
const NAZWA_CUDZEJ_POZYCJI = `Alfa ${BIEG} sprzet ${POZYCJI}`;

const WYMAGANE_ENV = [
  "SUPABASE_LOCAL_API_URL",
  "SUPABASE_LOCAL_ANON_KEY",
  "SUPABASE_LOCAL_SERVICE_ROLE_KEY",
] as const;
const maBaze = WYMAGANE_ENV.every((name) => Boolean(process.env[name]));

const najemcy = { a: "", b: "" };

/* -------------------------------------------------------------------------
 * Przyrząd — licznik na granicy procesu
 * ---------------------------------------------------------------------- */

interface Wywolanie {
  funkcja: string;
  bajty: number;
  /** Ciało odpowiedzi — potrzebne, by pytać, CO przyjechało, a nie tylko ile. */
  cialo: string;
}

const ruch: Wywolanie[] = [];
let oryginalnyFetch: typeof globalThis.fetch;

/**
 * Podmiana `fetch`, która MIERZY, a nie udaje: żądanie leci do prawdziwego
 * PostgREST, a my odczytujemy klon odpowiedzi. Atrapa zwracająca ustaloną
 * kopertę mierzyłaby kształt atrapy.
 */
function zalozLicznik(): void {
  oryginalnyFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const odpowiedz = await oryginalnyFetch(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const dopasowanie = /\/rest\/v1\/rpc\/([a-z0-9_]+)/i.exec(url);
    if (dopasowanie) {
      const tresc = await odpowiedz.clone().text();
      ruch.push({
        funkcja: dopasowanie[1]!,
        bajty: Buffer.byteLength(tresc, "utf8"),
        cialo: tresc,
      });
    }
    return odpowiedz;
  }) as typeof globalThis.fetch;
}

/** Wszystko, co przyjechało z bazy w tej odsłonie, w jednym ciągu. */
function pobraneDane(): string {
  return ruch.map((wpis) => wpis.cialo).join("\n");
}

function rachunek(): { zapytania: number; bajty: number; funkcje: string[] } {
  return {
    zapytania: ruch.length,
    bajty: ruch.reduce((suma, wpis) => suma + wpis.bajty, 0),
    funkcje: ruch.map((wpis) => wpis.funkcja),
  };
}

/**
 * Raport idzie do PLIKU wskazanego `FAZA4A_RAPORT`, a nie tylko na konsolę:
 * przy czerwonej asercji vitest zalewa wyjście zrzutem koperty i liczby, po
 * które przyszliśmy, przestają być czytelne. Plik zostaje niezależnie od
 * wyniku suity.
 */
function raport(etykieta: string): void {
  const { zapytania, bajty } = rachunek();
  const rozbicie = ruch
    .map((wpis) => `      ${wpis.funkcja}: ${(wpis.bajty / 1024).toFixed(1)} KB (${wpis.bajty} B)`)
    .join("\n");
  const tekst = `\n  ${etykieta}\n    zapytania: ${zapytania}\n    bajty: ${bajty} (${(bajty / 1024).toFixed(1)} KB)\n${rozbicie}\n`;
  console.log(tekst);
  const sciezka = process.env.FAZA4A_RAPORT;
  if (sciezka) appendFileSync(sciezka, tekst, "utf8");
}

/* -------------------------------------------------------------------------
 * Atrapy krawędzi Next — nagłówki żądania i cookies
 * ---------------------------------------------------------------------- */

const stanZadania = { tenantId: "" };

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        "x-tenant-id": stanZadania.tenantId,
        "x-nonce": "pomiar-nonce",
        host: "sklep.example.test",
        "x-forwarded-proto": "https",
      }),
    ),
  cookies: () =>
    Promise.resolve({
      getAll: () => [],
      set: () => undefined,
    }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  permanentRedirect: (to: string) => {
    throw new Error(`permanentRedirect:${to}`);
  },
}));

async function renderStronySprzetu(slug: string): Promise<string> {
  const { default: Trasa } = await import("../app/(tenant)/produkt/[slug]/page");
  const drzewo = (await Trasa({ params: Promise.resolve({ slug }) })) as ReactNode;
  return renderToStaticMarkup(drzewo);
}

async function renderKatalogu(): Promise<string> {
  const { default: Trasa } = await import("../app/(tenant)/store/page");
  const drzewo = (await Trasa()) as ReactNode;
  return renderToStaticMarkup(drzewo);
}

/** Strona `/katalog` (faza 4b, ADR-186) — JEDNA strona wyników z bazy. */
async function renderStronyKatalogu(strona?: number): Promise<string> {
  const { default: Trasa } = await import("../app/(tenant)/katalog/page");
  const drzewo = (await Trasa({
    searchParams: Promise.resolve(strona ? { strona: String(strona) } : {}),
  })) as ReactNode;
  return renderToStaticMarkup(drzewo);
}


/* -------------------------------------------------------------------------
 * Fikstura zakładana przez suitę — patrz nagłówek pliku
 * ---------------------------------------------------------------------- */

function admin() {
  return createClient(
    process.env.SUPABASE_LOCAL_API_URL as string,
    process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

/**
 * Katalog jednego najemcy: `POZYCJI` pozycji, po 3 zdjęcia i 2 progi cenowe.
 *
 * BOGATY, NIE MINIMALNY — i to jest cały sens tej fikstury. Pomiar na
 * pozycjach bez zdjęć i progów pokazałby kopertę kilkukrotnie mniejszą od
 * produkcyjnej, więc różnica przed/po wyglądałaby na mniejszą, niż jest.
 */
async function zalozNajemce(etykieta: string): Promise<string> {
  const db = admin();
  const { data: tenant, error } = await db
    .from("tenants")
    .insert({
      // CHECK tenants_slug_check: same małe litery, cyfry i myślnik.
      slug: `k4a-${etykieta.toLowerCase()}-${BIEG}`,
      name: `Pomiar ${etykieta} ${BIEG}`,
      status: "active",
      locale: "pl",
    })
    .select("id")
    .single();
  if (error || !tenant) throw new Error(`fikstura najemcy: ${error?.message}`);
  const tenantId = tenant.id as string;

  await db.from("tenant_settings").insert({ tenant_id: tenantId, key: "currency", value: "PLN" });

  const wiersze = Array.from({ length: POZYCJI }, (_, k) => {
    const nr = String(k + 1).padStart(3, "0");
    return {
      tenant_id: tenantId,
      name: `${etykieta} ${BIEG} sprzet ${k + 1 === POZYCJI ? String(POZYCJI) : nr}`,
      // Pozycja nr 1 dostaje adres WSPÓLNY dla obu najemców — fikstura izolacji.
      slug: k === 0 ? SLUG_WSPOLNY : `${etykieta.toLowerCase()}-${BIEG}-${nr}`,
      description:
        "Opis pozycji o dlugosci zblizonej do produkcyjnej, zeby pomiar rozmiaru koperty nie stal na pustych polach. Sprzet budowlany do wynajmu krotko- i dlugoterminowego.",
      base_price_day_grosze: 10_000 + k * 37,
      deposit_grosze: 20_000 + k * 11,
    };
  });

  const { data: pozycje, error: bladPozycji } = await db
    .from("products")
    .insert(wiersze)
    .select("id");
  if (bladPozycji || !pozycje) throw new Error(`fikstura pozycji: ${bladPozycji?.message}`);

  const zdjecia = pozycje.flatMap((poz) =>
    [0, 1, 2].map((n) => ({
      tenant_id: tenantId,
      product_id: poz.id as string,
      storage_path: `${tenantId}/${poz.id}/${randomUUID()}.webp`,
      sort_order: n,
      alt_text: `Zdjecie ${n}`,
    })),
  );
  const progi = pozycje.flatMap((poz) => [
    { tenant_id: tenantId, product_id: poz.id as string, tier_days: 3, multiplier: 0.9, label: "Od 3 dni" },
    { tenant_id: tenantId, product_id: poz.id as string, tier_days: 7, multiplier: 0.8, label: "Od tygodnia" },
  ]);

  const [{ error: bladZdjec }, { error: bladProgow }] = await Promise.all([
    db.from("product_images").insert(zdjecia),
    db.from("pricing_tiers").insert(progi),
  ]);
  if (bladZdjec) throw new Error(`fikstura zdjec: ${bladZdjec.message}`);
  if (bladProgow) throw new Error(`fikstura progow: ${bladProgow.message}`);

  return tenantId;
}

/* -------------------------------------------------------------------------
 * Suita
 * ---------------------------------------------------------------------- */

const BUDZET_RENDERU = 60_000;

describe.skipIf(!maBaze)("koszt odsłony sklepu na katalogu 200 pozycji (ADR-185)", () => {
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_LOCAL_API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_LOCAL_ANON_KEY;
    najemcy.a = await zalozNajemce("Alfa");
    najemcy.b = await zalozNajemce("Beta");
    stanZadania.tenantId = najemcy.a;

    zalozLicznik();
    // Rozgrzewka grafu modułów — patrz product-template-route.test.tsx.
    await import("../app/(tenant)/produkt/[slug]/page");
    await import("../app/(tenant)/store/page");
    await import("../app/(tenant)/katalog/page");
    ruch.length = 0;
  }, 300_000);

  afterEach(() => {
    ruch.length = 0;
    stanZadania.tenantId = najemcy.a;
    vi.resetModules();
  });

  afterAll(async () => {
    globalThis.fetch = oryginalnyFetch;
    const db = admin();
    for (const id of [najemcy.a, najemcy.b]) {
      if (id) await db.from("tenants").delete().eq("id", id);
    }
  }, 120_000);

  it("strona sprzętu: rachunek odsłony", async () => {
    const markup = await renderStronySprzetu(SLUG_WSPOLNY);
    const wynik = rachunek();
    raport("STRONA SPRZĘTU /produkt/{slug}");

    expect(markup, "render nie pokazał pozycji spod adresu").toContain(NAZWA_A_1);
    expect(wynik.zapytania, "odsłona bez ani jednego zapytania = przyrząd nie mierzy").toBeGreaterThan(0);
  }, BUDZET_RENDERU);

  it("katalog: rachunek odsłony", async () => {
    await renderKatalogu();
    raport("KATALOG /store");
    expect(rachunek().zapytania).toBeGreaterThan(0);
  }, BUDZET_RENDERU);

  it("strona sprzętu NIE POBIERA pozycji, których nie pokazuje", async () => {
    await renderStronySprzetu(SLUG_WSPOLNY);
    const dane = pobraneDane();

    // KONTROLA PRZYRZĄDU najpierw: jeżeli nie przyjechała nawet pozycja, której
    // strona dotyczy, to asercja niżej przechodzi po pustym zbiorze.
    expect(dane, "przyrząd nie widzi nawet pozycji spod adresu").toContain(NAZWA_A_1);

    expect(dane, "sklep ciągnie pozycje, których strona nie pokazuje").not.toContain(
      NAZWA_CUDZEJ_POZYCJI,
    );
  }, BUDZET_RENDERU);

  it("katalog: DRUGA odsłona nie idzie po katalog do bazy", async () => {
    /*
      KONTROLA POZYTYWNA CACHE'U NA POZIOMIE TRASY (ADR-185). Suita
      `catalog-cache.test.ts` dowodzi tego samego na warstwie danych; tutaj
      pytamy o RENDER, bo między jednym a drugim stoi `loadStorefrontContext`
      i to on decyduje, czy katalog w ogóle przechodzi przez cache.

      BEZ `vi.resetModules()` między odsłonami — cache jest stanem MODUŁU,
      więc reset kasowałby dokładnie to, co mierzymy.
    */
    await renderKatalogu();
    const pierwsza = rachunek();
    expect(
      pierwsza.funkcje,
      "pierwsza odsłona nie poszła po katalog — nie ma czego buforować",
    ).toContain("get_public_catalog");

    ruch.length = 0;
    await renderKatalogu();
    raport("KATALOG /store — DRUGA odsłona (ciepły cache)");
    const druga = rachunek();

    // KONTROLA PRZYRZĄDU: pozostałe odczyty MUSZĄ dalej lecieć. Gdyby zniknęły
    // wszystkie, znaczyłoby to, że memoizuje coś innego niż nasz cache (np.
    // `cache` Reacta poza zakresem żądania) — i asercja niżej byłaby zielona
    // z zupełnie innego powodu, niż myślimy.
    expect(
      druga.funkcje,
      "zniknęły WSZYSTKIE odczyty — mierzymy nie ten cache, co trzeba",
    ).toContain("get_tenant_appearance");

    expect(druga.funkcje, "katalog ciągnięty z bazy po raz drugi").not.toContain(
      "get_public_catalog",
    );
  }, BUDZET_RENDERU);

  it("IZOLACJA: ten sam slug u drugiego najemcy oddaje JEGO pozycję", async () => {
    const markupA = await renderStronySprzetu(SLUG_WSPOLNY);
    expect(markupA).toContain(NAZWA_A_1);

    vi.resetModules();
    ruch.length = 0;
    stanZadania.tenantId = najemcy.b;
    const markupB = await renderStronySprzetu(SLUG_WSPOLNY);

    expect(markupB, "najemca B nie dostał swojej pozycji").toContain(NAZWA_B_1);
    expect(markupB, "WYCIEK: najemca B zobaczył pozycję najemcy A").not.toContain(NAZWA_A_1);
  }, BUDZET_RENDERU);

  /* -----------------------------------------------------------------------
   * STRONA KATALOGU `/katalog` (faza 4b, ADR-186)
   * -------------------------------------------------------------------- */

  it("katalog `/katalog`: rachunek odsłony", async () => {
    const markup = await renderStronyKatalogu();
    raport("STRONA KATALOGU /katalog");

    expect(markup, "render nie pokazał pierwszej pozycji katalogu").toContain(NAZWA_A_1);
    expect(rachunek().zapytania, "odsłona bez zapytania = przyrząd nie mierzy").toBeGreaterThan(0);
  }, BUDZET_RENDERU);

  it("`/katalog` NIE POBIERA pozycji spoza swojej strony wyników", async () => {
    // To jest różnica między STRONICOWANIEM a UKRYWANIEM: gdyby trasa czytała
    // cały katalog i pokazywała z niego wycinek, pozycja nr 200 przyjechałaby
    // do procesu mimo że nie ma jej na ekranie — czyli koszt zdjęty przez
    // ADR-185 wróciłby tylnymi drzwiami, tyle że na innej trasie.
    await renderStronyKatalogu();
    const dane = pobraneDane();

    expect(dane, "przyrząd nie widzi nawet pierwszej pozycji").toContain(NAZWA_A_1);
    expect(dane, "strona katalogu ciągnie pozycje, których nie pokazuje").not.toContain(
      NAZWA_CUDZEJ_POZYCJI,
    );
  }, BUDZET_RENDERU);

  it("`/katalog`: DRUGA strona wyników pokazuje INNE pozycje niż pierwsza", async () => {
    const pierwsza = await renderStronyKatalogu();
    vi.resetModules();
    ruch.length = 0;
    const druga = await renderStronyKatalogu(2);

    expect(pierwsza, "pierwsza strona pusta — nie ma czego porównywać").toContain(NAZWA_A_1);
    expect(druga, "pozycja z pierwszej strony wyciekła na drugą").not.toContain(NAZWA_A_1);
    expect(druga.length, "druga strona nic nie wyrenderowała").toBeGreaterThan(500);
  }, BUDZET_RENDERU);

  it("`/katalog` IZOLACJA: najemca B nie widzi ani jednej pozycji najemcy A", async () => {
    const markupA = await renderStronyKatalogu();
    expect(markupA, "najemca A nie dostał swojego katalogu").toContain(NAZWA_A_1);

    vi.resetModules();
    ruch.length = 0;
    stanZadania.tenantId = najemcy.b;
    const markupB = await renderStronyKatalogu();

    expect(markupB, "najemca B nie dostał swojego katalogu").toContain(NAZWA_B_1);
    expect(markupB, "WYCIEK: najemca B zobaczył katalog najemcy A").not.toContain(NAZWA_A_1);
    expect(pobraneDane(), "pozycja najemcy A przyjechała do procesu najemcy B").not.toContain(
      NAZWA_A_1,
    );
  }, BUDZET_RENDERU);
});
