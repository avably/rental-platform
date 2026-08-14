/**
 * KOSZT ODSŁONY SKLEPU — ILE ZAPYTAŃ I ILE BAJTÓW (faza 4a, ADR-184).
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
 *   2. fikstura: `docs/pomiary/faza4a-fikstura.sql` przez psql na lokalnej bazie
 *   3. `SUPABASE_LOCAL_API_URL=… SUPABASE_LOCAL_ANON_KEY=… \
 *       corepack pnpm --filter @avably/storefront exec vitest run test/koszt-odslony.integration.test.ts`
 *
 * Bez tych zmiennych plik jest POMIJANY (jak reszta suit integracyjnych),
 * a nie zielony — pominięcie widać w podsumowaniu vitest.
 */
import { appendFileSync } from "node:fs";
import type { ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/* -------------------------------------------------------------------------
 * Fikstura — lustro docs/pomiary/faza4a-fikstura.sql
 * ---------------------------------------------------------------------- */

const NAJEMCA_A = "aaaaaaaa-0000-4000-8000-000000000001";
const NAJEMCA_B = "bbbbbbbb-0000-4000-8000-000000000002";

/** Pozycja nr 1 — TEN SAM slug u obu najemców (fikstura izolacji). */
const SLUG_WSPOLNY = "wiertarka-udarowa-sds";
const NAZWA_A_1 = "Alfa sprzet 001";
const NAZWA_B_1 = "Beta sprzet 001";

/**
 * Pozycja, której strona sprzętu NIE POKAZUJE. Nazwa jest unikatowa w całej
 * fiksturze, więc jej obecność w ruchu do bazy znaczy dokładnie jedno: ciągniemy
 * pozycje, których nie wyświetlamy. Asercja „gdziekolwiek w wyjściu" ma tu sens
 * WYŁĄCZNIE dlatego, że ta wartość nie ma prawa stać tam z żadnego innego
 * powodu — inaczej byłaby to bramka, która przechodzi przypadkiem.
 */
const NAZWA_CUDZEJ_POZYCJI = "Alfa sprzet 200";

const WYMAGANE_ENV = ["SUPABASE_LOCAL_API_URL", "SUPABASE_LOCAL_ANON_KEY"] as const;
const maBaze = WYMAGANE_ENV.every((name) => Boolean(process.env[name]));

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

const stanZadania = { tenantId: NAJEMCA_A };

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

/* -------------------------------------------------------------------------
 * Suita
 * ---------------------------------------------------------------------- */

const BUDZET_RENDERU = 60_000;

describe.skipIf(!maBaze)("koszt odsłony sklepu na katalogu 200 pozycji (ADR-184)", () => {
  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_LOCAL_API_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.SUPABASE_LOCAL_ANON_KEY;
    zalozLicznik();
    // Rozgrzewka grafu modułów — patrz product-template-route.test.tsx.
    await import("../app/(tenant)/produkt/[slug]/page");
    await import("../app/(tenant)/store/page");
    ruch.length = 0;
  }, 180_000);

  afterEach(() => {
    ruch.length = 0;
    stanZadania.tenantId = NAJEMCA_A;
    vi.resetModules();
  });

  afterAll(() => {
    globalThis.fetch = oryginalnyFetch;
  });

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
      KONTROLA POZYTYWNA CACHE'U NA POZIOMIE TRASY (ADR-184). Suita
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
    stanZadania.tenantId = NAJEMCA_B;
    const markupB = await renderStronySprzetu(SLUG_WSPOLNY);

    expect(markupB, "najemca B nie dostał swojej pozycji").toContain(NAZWA_B_1);
    expect(markupB, "WYCIEK: najemca B zobaczył pozycję najemcy A").not.toContain(NAZWA_A_1);
  }, BUDZET_RENDERU);
});

export { NAZWA_CUDZEJ_POZYCJI };
