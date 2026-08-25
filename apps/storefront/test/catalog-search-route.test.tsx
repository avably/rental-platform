/**
 * WYSZUKIWARKA NA TRASIE `/katalog?q=` — SKUTEK, NIE OBECNOŚĆ POLA (ADR-263).
 *
 * ==================== CO TEN PLIK MIERZY ====================
 *
 * Że `?q=` naprawdę ZAWĘŻA to, co wchodzi do dokumentu (a nie tylko dokłada pole
 * nad pełnym katalogiem), że fraza jedzie do bazy jako `p_query`, że pusty wynik
 * pokazuje komunikat „brak wyników" (a nie pustą siatkę katalogu w przygotowaniu),
 * że nawigacja stron ZACHOWUJE `?q=`, i że widok wyników jest `noindex` — a
 * czysty katalog dalej indeksowalny.
 *
 * ==================== ATRAPĄ JEST KLIENT BAZY, NIE WARSTWA DANYCH ====================
 *
 * Podmieniamy `createSupabaseServerClient` (najgłębszy punkt przed siecią), więc
 * pod pomiarem stoi PRAWDZIWY łańcuch trasa → `loadCatalogPageContext` →
 * `lib/checkout/catalog` → klient. Atrapa `get_public_catalog_page` NAPRAWDĘ
 * filtruje po `p_query` (name/description, bez wielkości liter) i tnie okno —
 * inaczej przypadek „fraza zawęża" byłby czerwony, i to jest właściwa strona
 * pomyłki.
 */
import type { ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG_PAGE_SIZE } from "@avably/core";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Pozycji pasujących do „wiertarka" — dwie pełne strony wyników i zapas. */
const WIERTAREK = CATALOG_PAGE_SIZE + 3;

function id(nr: number): string {
  return `00000000-0000-4000-8000-${String(nr).padStart(12, "0")}`;
}

/**
 * Katalog atrapy: `WIERTAREK` pozycji z „Wiertarka" w nazwie plus dwie z „Młot"
 * i jedna, która frazy nie niesie w nazwie, za to w OPISIE — żeby dowieść, że
 * filtr czyta oba pola.
 */
function katalog() {
  const wiertarki = Array.from({ length: WIERTAREK }, (_, k) => ({
    id: id(k + 1),
    name: `Wiertarka ${String(k + 1).padStart(3, "0")}`,
    description: null as string | null,
  }));
  const mloty = [
    { id: id(900), name: "Młot 001", description: null as string | null },
    { id: id(901), name: "Młot 002", description: null as string | null },
  ];
  const opisowa = [
    { id: id(950), name: "Szlifierka kątowa", description: "w opisie stoi wiertarka udarowa" },
  ];
  return [...wiertarki, ...mloty, ...opisowa];
}

function pozycja(p: { id: string; name: string; description: string | null }) {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    base_price_day_grosze: 10_000,
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

function pasuje(p: { name: string; description: string | null }, q: string): boolean {
  if (q.length === 0) return true;
  const igla = q.toLowerCase();
  return (
    p.name.toLowerCase().includes(igla) ||
    (p.description ?? "").toLowerCase().includes(igla)
  );
}

const stan = {
  tenantId: TENANT as string | null,
  stronaGlowna: true,
  pigulka: true,
  wywolania: [] as unknown[],
};

const STRONA_GLOWNA = {
  published_at: "2026-08-01T10:00:00.000Z",
  template: "classic",
  sections: [],
};

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
          const query = typeof args.p_query === "string" ? args.p_query : "";
          const pasujace = katalog().filter((p) => pasuje(p, query));
          const okno = pasujace.slice(offset, offset + limit);
          return {
            data: {
              // total liczy PRZEFILTROWANY zbiór (jak baza 0107).
              total: pasujace.length,
              tenant: { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" },
              custom_fields: [],
              products: okno.map(pozycja),
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

const BUDZET_RENDERU = 60_000;

describe("wyszukiwarka katalogu na trasie /katalog (ADR-263)", () => {
  beforeAll(async () => {
    await renderKatalog({});
    stan.wywolania.length = 0;
  }, BUDZET_RENDERU);

  beforeEach(() => {
    stan.tenantId = TENANT;
    stan.stronaGlowna = true;
    stan.pigulka = true;
    stan.wywolania.length = 0;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Pole wyszukiwania jest formularzem GET → `?q=`
  // -------------------------------------------------------------------
  it("pole to formularz GET celujący w /katalog z parametrem `q` (linkowalny, bez JS)", async () => {
    const html = await renderKatalog({});
    expect(html, "brak pola wyszukiwania na katalogu").toContain("data-catalog-search");
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/katalog"');
    expect(html).toContain('name="q"');
  }, BUDZET_RENDERU);

  it("pole niesie bieżącą frazę jako wartość (stan z adresu, nie z Reacta)", async () => {
    const html = await renderKatalog({ q: "wiertarka" });
    expect(html, "pole nie pokazało bieżącej frazy").toContain('value="wiertarka"');
    // Przy aktywnej frazie pojawia się „Wyczyść" prowadzący pod czysty katalog.
    expect(html).toContain("data-catalog-search-clear");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 2. `?q=` NAPRAWDĘ zawęża to, co wchodzi do dokumentu
  // -------------------------------------------------------------------
  it("fraza pokazuje TYLKO dopasowania i pomija resztę katalogu", async () => {
    const html = await renderKatalog({ q: "młot" });

    expect(html, "dopasowanie po nazwie nie weszło do wyników").toContain("Młot 001");
    expect(html, "pozycja spoza frazy stoi w wynikach").not.toContain("Wiertarka 001");

    const kafle = html.match(/data-products-item=/g) ?? [];
    expect(kafle.length, "liczba kafli ≠ liczba dopasowań frazy").toBe(2);
  }, BUDZET_RENDERU);

  it("fraza jedzie do bazy jako `p_query`, a nie jest filtrem w pamięci trasy", async () => {
    await renderKatalog({ q: "wiertarka" });
    const odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_catalog_page",
    );
    expect(odczyt, "trasa nie zapytała bazy").toBeTruthy();
    expect(odczyt!.args.p_query, "fraza nie doszła do bazy jako p_query").toBe("wiertarka");
    expect(odczyt!.args.p_tenant_id, "najemca nie przyszedł z nagłówka").toBe(TENANT);
  }, BUDZET_RENDERU);

  it("filtr czyta też OPIS — fraza w opisie wnosi pozycję bez frazy w nazwie", async () => {
    const html = await renderKatalog({ q: "wiertarka udarowa" });
    // Tylko pozycja opisowa niesie dokładnie „wiertarka udarowa" (nazwy wiertarek
    // to „Wiertarka NNN", bez słowa „udarowa").
    expect(html, "dopasowanie po opisie nie weszło do wyników").toContain("Szlifierka kątowa");
    const kafle = html.match(/data-products-item=/g) ?? [];
    expect(kafle.length, "opisowe dopasowanie nie jest jedyne").toBe(1);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3. Pusty wynik — komunikat, nie pusta siatka
  // -------------------------------------------------------------------
  it("brak dopasowań pokazuje komunikat pustego wyniku, a nie siatkę katalogu", async () => {
    const html = await renderKatalog({ q: "nieistniejacafrazaxyz" });
    expect(html, "brak komunikatu o pustym wyniku wyszukiwania").toContain(
      "data-catalog-search-empty",
    );
    const kafle = html.match(/data-products-item=/g) ?? [];
    expect(kafle.length, "pusty wynik mimo to narysował kafle").toBe(0);
    // Pole zostaje, żeby klient mógł zawęzić inaczej albo wyczyścić.
    expect(html, "pole wyszukiwania zniknęło przy pustym wyniku").toContain("data-catalog-search");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 4. Nawigacja stron ZACHOWUJE `?q=`
  // -------------------------------------------------------------------
  it("adresy stron wyników niosą `q`, więc przejście między nimi nie gubi frazy", async () => {
    // „wiertarka" ma dwie strony wyników (WIERTAREK > rozmiar strony).
    const html = await renderKatalog({ q: "wiertarka", strona: "2" });

    expect(html, "brak nawigacji stron przy wynikach na dwóch stronach").toContain(
      "data-catalog-pager",
    );
    // Odnośnik do strony 1 wyników zachowuje frazę i nie nosi `strona` (kanon 1).
    expect(html).toContain('href="/katalog?q=wiertarka"');
    // „poprzednia" na stronie 2 też trzyma frazę.
    expect(html).toContain('data-catalog-prev');
    expect(html, "nawigacja zgubiła frazę i wróciła do czystego katalogu").not.toContain(
      'href="/katalog?strona=1"',
    );
  }, BUDZET_RENDERU);

  it("numer strony ZA ostatnią stroną wyników to 404, nie pusta siatka", async () => {
    await expect(renderKatalog({ q: "wiertarka", strona: "99" })).rejects.toThrow("notFound");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 5. Indeksowalność — wyniki wyszukiwania są noindex
  // -------------------------------------------------------------------
  it("widok `?q=` jest NOINDEX (widok filtrowany), a czysty katalog — indeksowalny", async () => {
    const wyniki = await metadane({ q: "wiertarka" });
    expect(wyniki.robots, "widok wyników wyszukiwania wpuszczony do indeksu").toMatchObject({
      index: false,
    });

    vi.resetModules();
    const czysty = await metadane({});
    expect(
      czysty.robots,
      "czysty katalog wyrzucony z indeksu przez wyszukiwarkę",
    ).toBeUndefined();
  }, BUDZET_RENDERU);

  it("tytuł widoku wyników niesie frazę (rozróżnialny w karcie i historii)", async () => {
    const meta = await metadane({ q: "wiertarka" });
    expect(String(meta.title)).toContain("wiertarka");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // Kontrola: bez frazy trasa zachowuje się jak dotąd (pełny katalog)
  // -------------------------------------------------------------------
  it("bez frazy katalog renderuje pełną stronę wyników (zachowanie ADR-186)", async () => {
    const html = await renderKatalog({});
    expect(html).toContain("Wiertarka 001");
    const kafle = html.match(/data-products-item=/g) ?? [];
    expect(kafle.length, "pełny katalog nie oddał pełnej strony").toBe(CATALOG_PAGE_SIZE);
  }, BUDZET_RENDERU);
});
