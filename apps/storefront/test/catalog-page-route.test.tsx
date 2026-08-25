/**
 * STRONA KATALOGU `/katalog` — SKUTEK, NIE OBECNOŚĆ TRASY (faza 4b, ADR-186).
 *
 * ==================== CO TEN PLIK MIERZY ====================
 *
 * Nie „plik trasy istnieje", tylko: druga strona wyników pokazuje INNE pozycje
 * niż pierwsza i nie pokazuje ANI JEDNEJ z nich, do dokumentu wchodzi wyłącznie
 * jedna strona (a nie cały katalog schowany arkuszem), nawigacja składa się
 * z ODNOŚNIKÓW pod adresy, które ta sama trasa umie obsłużyć, a numer strony
 * spoza zakresu oddaje 404 zamiast pustego ekranu.
 *
 * ==================== ATRAPĄ JEST KLIENT BAZY, NIE WARSTWA DANYCH ====================
 *
 * Podmieniamy `createSupabaseServerClient`, czyli najgłębszy punkt przed siecią.
 * Dzięki temu pod pomiarem stoi PRAWDZIWY łańcuch: trasa →
 * `loadCatalogPageContext` → `lib/checkout/catalog` → klient. Atrapa warstwy
 * danych mierzyłaby kształt atrapy, a rozstrzygnięcie „czy ten adres w ogóle
 * istnieje" siedzi właśnie w kontekście, nie w trasie.
 *
 * ATRAPA STRONICUJE NAPRAWDĘ. Gdyby oddawała ten sam wycinek niezależnie od
 * `p_offset`, przypadek „druga strona ma inne pozycje" byłby czerwony — i to
 * jest właściwa strona pomyłki: przyrząd, który nie umie pokazać różnicy, ma
 * palić, a nie przechodzić.
 */
import type { ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG_PAGE_SIZE, catalogPagePath } from "@avably/core";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Ile pozycji ma katalog atrapy — dwie pełne strony i jedna niepełna. */
const POZYCJI = 2 * CATALOG_PAGE_SIZE + 3;

function nazwa(nr: number): string {
  return `Sprzet ${String(nr).padStart(3, "0")}`;
}

function pozycja(nr: number) {
  return {
    id: `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`,
    name: nazwa(nr),
    description: null,
    base_price_day_grosze: 10_000 + nr,
    deposit_grosze: 20_000,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  };
}

const stan = {
  tenantId: TENANT as string | null,
  total: POZYCJI,
  /** Czy najemca ma OPUBLIKOWANĄ stronę główną — od tego zależy `robots.txt`. */
  stronaGlowna: true,
  /** Globalna pigułka terminu w pasku (ADR-203) — default true, jak w bazie. */
  pigulka: true,
  /** Czy `app.get_public_catalog` (reużyty pod menu kategorii, ADR-266) coś niesie. */
  menu: false,
  wywolania: [] as unknown[],
};

/** Minimalna koperta `app.get_published_page` — pusta strona, ale opublikowana. */
const STRONA_GLOWNA = {
  published_at: "2026-08-01T10:00:00.000Z",
  template: "classic",
  sections: [],
};

/** Kategoria niepusta i pusta — do menu kategorii powłoki (ADR-266). */
const CAT_NIEPUSTA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAT_PUSTA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/**
 * Koperta WĄSKIEGO odczytu menu kategorii (`app.get_public_category_nav`,
 * 0109/ADR-266) — kategorie z licznikiem, BEZ ani jednej pozycji katalogu, więc
 * menu na `/katalog` nie ciągnie oferty spoza strony wyników. Funkcja bazy
 * filtruje puste po swojej stronie; wpis `count: 0` stoi tu, żeby sprawdzić, że
 * `navItemsFromCounts` trzyma ten sam guard także w warstwie prezentacji.
 */
const NAV_ENTRIES = [
  { id: CAT_NIEPUSTA, name: "Kajaki", slug: "kajaki", count: 3 },
  { id: CAT_PUSTA, name: "Puste", slug: "puste", count: 0 },
];

vi.mock("next/headers", () => ({
  headers: () =>
    Promise.resolve(
      new Headers({
        ...(stan.tenantId ? { "x-tenant-id": stan.tenantId } : {}),
        "x-nonce": "test-nonce",
        host: "sklep.example.test",
        "x-forwarded-proto": "https",
      }),
    ),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  // Nagłówek sklepu czyta ścieżkę pod aria-current koszyka (S-52);
  // poza routerem Nexta hook oddaje null — jak w renderToStaticMarkup.
  usePathname: () => null,
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        stan.wywolania.push({ fn, args });
        if (fn === "get_public_catalog_page") {
          const offset = Number(args.p_offset);
          const limit = Number(args.p_limit);
          const wszystkie = Array.from({ length: stan.total }, (_, k) => pozycja(k + 1));
          const okno = wszystkie.slice(offset, offset + limit);
          return {
            data: {
              total: stan.total,
              tenant: { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" },
              custom_fields: [],
              products: okno,
              slugs: okno.map((p) => ({ id: p.id, slug: `sprzet-${p.id.slice(-3)}` })),
            },
            error: null,
          };
        }
        if (fn === "get_tenant_appearance") return { data: null, error: null };
        if (fn === "get_public_store_flags") {
          return { data: { term_calendar_enabled: stan.pigulka }, error: null };
        }
        if (fn === "get_published_page") {
          return { data: stan.stronaGlowna ? STRONA_GLOWNA : null, error: null };
        }
        if (fn === "get_published_legal_documents") return { data: [], error: null };
        // [ADR-266] Wąski odczyt menu kategorii — `null` znaczy „nieudany odczyt":
        // menu ma wtedy zniknąć (fail-soft), nie wywrócić trasy.
        if (fn === "get_public_category_nav") {
          return { data: stan.menu ? NAV_ENTRIES : null, error: null };
        }
        return { data: null, error: null };
      },
    }),
  }),
}));

async function renderKatalog(params: Record<string, string | string[]>): Promise<string> {
  const { default: Trasa } = await import("../app/(tenant)/katalog/page");
  const drzewo = (await Trasa({ searchParams: Promise.resolve(params) })) as ReactNode;
  return renderToStaticMarkup(drzewo);
}

async function metadane(params: Record<string, string | string[]>) {
  const { generateMetadata } = await import("../app/(tenant)/katalog/page");
  return generateMetadata({ searchParams: Promise.resolve(params) });
}

/**
 * BUDŻET RENDERU — jawny, i to nie jest kosmetyka.
 *
 * Pierwszy render ciągnie CAŁY graf modułów powłoki sklepu (renderer sekcji,
 * kalendarz, koszyk) i na obciążonej maszynie przekracza domyślne 5 s vitest.
 * Skutek przekroczenia nie jest lokalny: vitest przerywa PRZYPADEK, ale nie
 * przerywa renderu, więc jego zapytania do atrapy lądują w liczniku przypadku
 * NASTĘPNEGO — i pada asercja o przesunięciu, która z tym renderem nie ma nic
 * wspólnego. Diagnoza po objawie prowadziłaby prosto w „stronicowanie liczy zły
 * offset", którego nie ma.
 */
const BUDZET_RENDERU = 60_000;

describe("strona katalogu ze stronicowaniem (ADR-186)", () => {
  /*
    ROZGRZEWKA MA WŁASNY BUDŻET (hak, nie przypadek). Wciągnięcie grafu modułów
    tutaj sprawia, że koszt pierwszego importu nie obciąża pierwszego
    przypadku — a ten hak dostaje jawny limit, bo przekroczony limit HAKA
    wywraca cały plik, nie jeden przypadek.
  */
  beforeAll(async () => {
    await renderKatalog({});
    stan.wywolania.length = 0;
  }, BUDZET_RENDERU);

  beforeEach(() => {
    stan.tenantId = TENANT;
    stan.total = POZYCJI;
    stan.pigulka = true;
    stan.menu = false;
    stan.wywolania.length = 0;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Stronicowanie NAPRAWDĘ ogranicza to, co wchodzi do dokumentu
  // -------------------------------------------------------------------
  it("druga strona pokazuje INNE pozycje i nie pokazuje ANI JEDNEJ z pierwszej", async () => {
    const pierwsza = await renderKatalog({});
    vi.resetModules();
    const druga = await renderKatalog({ strona: "2" });

    // KONTROLA PO PUSTYM ZBIORZE: bez niej „druga nie zawiera pierwszych"
    // przechodziłoby także dla strony, która nie pokazuje niczego.
    expect(pierwsza, "pierwsza strona nie pokazała pierwszej pozycji").toContain(nazwa(1));
    expect(druga, "druga strona nie pokazała pozycji ze swojego okna").toContain(
      nazwa(CATALOG_PAGE_SIZE + 1),
    );

    expect(druga, "pozycja z pierwszej strony wyciekła na drugą").not.toContain(nazwa(1));
    expect(pierwsza, "pozycja z drugiej strony stoi już na pierwszej").not.toContain(
      nazwa(CATALOG_PAGE_SIZE + 1),
    );
  }, BUDZET_RENDERU);

  it("do dokumentu wchodzi JEDNA strona wyników, a nie cały katalog", async () => {
    const html = await renderKatalog({});

    // Pozycja z OSTATNIEJ strony nie ma prawa być w kodzie strony pierwszej —
    // ani widoczna, ani ukryta arkuszem. To jest różnica między „stronicowanie"
    // a „ukrywanie": ukryta lista dalej waży i dalej daje się zaindeksować.
    expect(html, "katalog przyjechał w całości i został ukryty").not.toContain(nazwa(POZYCJI));

    const kafle = html.match(/data-products-item=/g) ?? [];
    expect(kafle.length, "liczba kafli w dokumencie ≠ rozmiar strony").toBe(CATALOG_PAGE_SIZE);
  }, BUDZET_RENDERU);

  it("zapytanie do bazy niesie przesunięcie TEJ strony, a nie zawsze zero", async () => {
    await renderKatalog({ strona: "3" });
    const odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_catalog_page",
    );
    expect(odczyt, "trasa nie zapytała bazy o stronę wyników").toBeTruthy();
    expect(odczyt!.args.p_offset, "przesunięcie liczone w pamięci zamiast w bazie").toBe(
      2 * CATALOG_PAGE_SIZE,
    );
    expect(odczyt!.args.p_limit).toBe(CATALOG_PAGE_SIZE);
    expect(odczyt!.args.p_tenant_id, "najemca nie przyszedł z nagłówka").toBe(TENANT);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 2. Adresy są linkowalne — nawigacja to ODNOŚNIKI
  // -------------------------------------------------------------------
  it("nawigacja stron składa się z odnośników pod adresy, które ta trasa obsługuje", async () => {
    const html = await renderKatalog({ strona: "2" });

    expect(html).toContain(`href="${catalogPagePath(1)}"`);
    expect(html).toContain(`href="${catalogPagePath(3)}"`);
    // Bieżąca strona NIE jest odnośnikiem do samej siebie.
    expect(html).not.toContain(`href="${catalogPagePath(2)}"`);
    expect(html).toContain('aria-current="page"');
  }, BUDZET_RENDERU);

  it("na pierwszej stronie nie ma odnośnika „poprzednia”, na ostatniej — „następna”", async () => {
    const pierwsza = await renderKatalog({});
    expect(pierwsza, "odnośnik „poprzednia” na pierwszej stronie").not.toContain(
      "data-catalog-prev",
    );
    expect(pierwsza).toContain("data-catalog-next");

    vi.resetModules();
    const ostatnia = await renderKatalog({ strona: "3" });
    expect(ostatnia).toContain("data-catalog-prev");
    expect(ostatnia, "odnośnik „następna” na ostatniej stronie").not.toContain("data-catalog-next");
  }, BUDZET_RENDERU);

  it("katalog mieszczący się na jednej stronie nie dostaje nawigacji", async () => {
    stan.total = 3;
    const html = await renderKatalog({});
    expect(html, "pasek z jedynym numerem jest szumem, nie informacją").not.toContain(
      "data-catalog-pager",
    );
  });

  // -------------------------------------------------------------------
  // 3. Numer strony spoza zakresu i spoza formy kanonicznej
  // -------------------------------------------------------------------
  it.each(["0", "-1", "01", "abc", "1.5", ""])(
    "numer `%s` nie jest adresem — 404",
    async (raw) => {
      await expect(renderKatalog({ strona: raw })).rejects.toThrow("notFound");
    },
  );

  it("numer strony ZA ostatnią stroną to 404, a nie pusta siatka", async () => {
    await expect(renderKatalog({ strona: "99" })).rejects.toThrow("notFound");
  });

  it("KONTROLA POZYTYWNA: ostatnia istniejąca strona renderuje się", async () => {
    // Bez tego „wszystko poza zakresem" (np. przez błąd w rachunku stron)
    // wyglądałoby jak działająca bramka.
    const html = await renderKatalog({ strona: "3" });
    expect(html).toContain(nazwa(POZYCJI));
  }, BUDZET_RENDERU);

  it("katalog PUSTY renderuje stronę pierwszą, a jego strona druga to 404", async () => {
    stan.total = 0;
    const html = await renderKatalog({});
    expect(html.length, "pusty katalog nie wyrenderował niczego").toBeGreaterThan(500);

    vi.resetModules();
    stan.total = 0;
    await expect(renderKatalog({ strona: "2" })).rejects.toThrow("notFound");
  }, BUDZET_RENDERU);

  it("wejście BEZ nagłówka najemcy (spoza gałęzi tenanckiej) to 404", async () => {
    stan.tenantId = null;
    await expect(renderKatalog({})).rejects.toThrow("notFound");
  });

  // -------------------------------------------------------------------
  // 4. Indeksowalność — kanon i tytuł
  // -------------------------------------------------------------------
  it("kanon strony N wskazuje SAM SIEBIE, a strona 1 — adres bez parametru", async () => {
    const pierwsza = await metadane({});
    expect(pierwsza.alternates?.canonical).toBe("https://sklep.example.test/katalog");

    vi.resetModules();
    const druga = await metadane({ strona: "2" });
    expect(
      druga.alternates?.canonical,
      "kanon strony 2 wskazujący stronę 1 chowa przed wyszukiwarką resztę oferty",
    ).toBe("https://sklep.example.test/katalog?strona=2");
  });

  // -------------------------------------------------------------------
  // Pigułka terminu w pasku respektuje flagę najemcy (ADR-203)
  // -------------------------------------------------------------------
  //
  // Dowód na PRAWDZIWYM renderze trasy /katalog i prawdziwym
  // `loadCatalogPageContext` (atrapa siedzi dopiero na kliencie Supabase):
  // flaga z odpowiedzi `get_public_store_flags` naprawdę przepływa przez
  // kontekst do powłoki. Obie strony kontraktu w JEDNYM przypadku —
  // „pigułka jest przy fladze on" bez drugiej połowy przechodziłoby też
  // wtedy, gdyby flaga nie była czytana wcale.
  it("pigułka w pasku: JEST przy fladze włączonej, ZNIKA po wyłączeniu przez najemcę", async () => {
    const wlaczona = await renderKatalog({});
    expect(wlaczona, "flaga on: marker paska zniknął z SSR").toContain('data-store-term="true"');
    expect(wlaczona, "flaga on: pigułki nie ma w SSR").toContain("data-store-term-toggle");

    stan.pigulka = false;
    vi.resetModules();
    const wylaczona = await renderKatalog({});
    expect(wylaczona, "flaga off: marker paska stoi wbrew ustawieniu najemcy").not.toContain(
      'data-store-term="true"',
    );
    expect(wylaczona, "flaga off: pigułka stoi wbrew ustawieniu najemcy").not.toContain(
      "data-store-term-toggle",
    );
    // Katalog dalej SPRZEDAJE: siatka pozycji zostaje — flaga gasi wyłącznie
    // globalny wyzwalacz terminu, nie treść strony.
    expect(wylaczona, "flaga off zgasiła całą stronę katalogu").toContain(nazwa(1));
  }, BUDZET_RENDERU);

  it("`?strona=1` ma ten sam kanon, co `/katalog` — dwa adresy, jedna treść", async () => {
    const jeden = await metadane({ strona: "1" });
    expect(jeden.alternates?.canonical).toBe("https://sklep.example.test/katalog");
  });

  it("strony wyników są INDEKSOWALNE, a numer spoza zakresu — nie", async () => {
    const druga = await metadane({ strona: "2" });
    expect(druga.robots, "strona wyników wyrzucona z indeksu — katalog nie ma jak trafić do wyszukiwarki").toBeUndefined();

    vi.resetModules();
    const zly = await metadane({ strona: "abc" });
    expect(zly.robots).toMatchObject({ index: false });
  });

  it("tytuł odróżnia strony wyników — inaczej w indeksie stoi N takich samych wyników", async () => {
    const pierwsza = await metadane({});
    vi.resetModules();
    const druga = await metadane({ strona: "2" });
    expect(druga.title).not.toBe(pierwsza.title);
    expect(String(druga.title)).toContain("2");
  });

  it("pusty katalog zostaje POZA indeksem (nie ma tam treści)", async () => {
    stan.total = 0;
    const meta = await metadane({});
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("sklep bez opublikowanej strony głównej też zostaje poza indeksem — spójnie z robots.txt", async () => {
    // `app/robots.txt` oddaje wtedy `Disallow: /`, a mapa strony 404. `index`
    // w metadanych byłby obietnicą, której druga deklaracja tej samej rzeczy
    // wprost zaprzecza — a rozjazd między nimi to defekt, który się później ściga.
    stan.stronaGlowna = false;
    const meta = await metadane({});
    expect(meta.robots).toMatchObject({ index: false });
  });

  // -------------------------------------------------------------------
  // Menu kategorii powłoki na /katalog (ADR-266) — wayfinding nie znika,
  // gdy klient zaczyna przeglądać ofertę.
  // -------------------------------------------------------------------
  it("menu kategorii renderuje się na /katalog, z guardem pustych", async () => {
    stan.menu = true;
    const html = await renderKatalog({});
    expect(html, "menu kategorii nie stanęło w nagłówku katalogu").toContain(
      "data-store-category-menu",
    );
    // Kategoria z pozycjami wchodzi do menu jako odnośnik do czystej strony kategorii.
    expect(html, "kategoria z pozycjami nie weszła do menu").toContain('href="/kategoria/kajaki"');
    // Kategoria PUSTA jest zdejmowana guardem — pozycja menu obiecywałaby półkę
    // bez sprzętu (patrz `categoryNavItems`).
    expect(html, "kategoria PUSTA weszła do menu wbrew guardowi").not.toContain(
      'href="/kategoria/puste"',
    );
  }, BUDZET_RENDERU);

  it("nieudany odczyt katalogu (fail-soft) nie gasi trasy ani nie rysuje menu", async () => {
    stan.menu = false;
    const html = await renderKatalog({});
    // Trasa dalej pokazuje siatkę — brak menu nie ma prawa wywrócić katalogu.
    expect(html, "brak menu zgasił całą stronę katalogu").toContain("data-products-item=");
    // Puste menu NIE rysuje wyzwalacza „Kategorie" — obietnicy listy, której nie ma.
    expect(html, "puste menu narysowało wyzwalacz mimo braku kategorii").not.toContain(
      "data-store-category-menu",
    );
  }, BUDZET_RENDERU);
});
