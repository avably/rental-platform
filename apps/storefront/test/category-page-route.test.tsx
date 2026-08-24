/**
 * STRONA KATEGORII `/kategoria/{slug}` — SKUTEK, NIE OBECNOŚĆ TRASY (faza C,
 * ADR-247; odczyt z ADR-244).
 *
 * ==================== CO TEN PLIK MIERZY ====================
 *
 * Trzy stany kategorii schodzą na trzy zachowania trasy: najemca poza oknem →
 * 404, slug nieznany (`category=null`) → 404, kategoria istnieje → render (pusta
 * pokazuje „nie ma jeszcze produktów", NIE 404). Ponadto: stronicowanie
 * ogranicza to, co wchodzi do dokumentu (druga strona ma INNE pozycje),
 * sortowanie mapuje się na `p_sort` bazy, kanon celuje w CZYSTĄ stronę kategorii
 * niezależnie od sortu/strony, a nawigacja i sort są ODNOŚNIKAMI, które ta sama
 * trasa umie obsłużyć.
 *
 * ==================== ATRAPĄ JEST KLIENT BAZY, NIE WARSTWA DANYCH ====================
 *
 * Podmieniamy `createSupabaseServerClient` — najgłębszy punkt przed siecią —
 * więc pod pomiarem stoi PRAWDZIWY łańcuch trasa → `loadCategoryPageContext` →
 * `lib/checkout/catalog` → klient. Atrapa STRONICUJE i SORTUJE naprawdę, żeby
 * przypadek „druga strona ma inne pozycje" umiał być czerwony.
 */
import type { ReactNode } from "react";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CATALOG_PAGE_SIZE } from "@avably/core";

import { categoryPagePath } from "@/lib/catalog/category-path";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SLUG = "rowery";

/** Ile pozycji ma kategoria atrapy — dwie pełne strony i jedna niepełna. */
const POZYCJI = 2 * CATALOG_PAGE_SIZE + 3;

function nazwa(nr: number): string {
  return `Rower ${String(nr).padStart(3, "0")}`;
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
  /** null = najemca poza oknem handlowym (cała koperta NULL). */
  pozaOknem: false,
  total: POZYCJI,
  stronaGlowna: true,
  pigulka: true,
  /** Ścieżka banera kategorii (image_path) albo null. */
  banner: null as string | null,
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
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: async () => ({
    schema: () => ({
      rpc: async (fn: string, args: Record<string, unknown>) => {
        stan.wywolania.push({ fn, args });
        if (fn === "get_public_category_page") {
          if (stan.pozaOknem) return { data: null, error: null };
          const slug = String(args.p_slug);
          const tenant = { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" };
          if (slug === "nieznane") {
            return {
              data: {
                category: null,
                tenant,
                page: 1,
                page_size: CATALOG_PAGE_SIZE,
                total: 0,
                custom_fields: [],
                products: [],
                slugs: [],
              },
              error: null,
            };
          }
          const meta = {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Rowery",
            slug,
            description: slug === "opisana" ? "Rowery górskie i miejskie na doby." : null,
            image_path: stan.banner,
          };
          const page = Number(args.p_page);
          const size = Number(args.p_page_size);
          const wszystkie = Array.from({ length: stan.total }, (_, k) => pozycja(k + 1));
          const okno = wszystkie.slice((page - 1) * size, (page - 1) * size + size);
          return {
            data: {
              category: meta,
              tenant,
              page,
              page_size: size,
              total: stan.total,
              custom_fields: [],
              products: okno,
              slugs: okno.map((p) => ({ id: p.id, slug: `rower-${p.id.slice(-3)}` })),
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

async function renderKategoria(
  slug: string,
  params: Record<string, string | string[]> = {},
): Promise<string> {
  const { default: Trasa } = await import("../app/(tenant)/kategoria/[slug]/page");
  const drzewo = (await Trasa({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(params),
  })) as ReactNode;
  return renderToStaticMarkup(drzewo);
}

async function metadane(slug: string, params: Record<string, string | string[]> = {}) {
  const { generateMetadata } = await import("../app/(tenant)/kategoria/[slug]/page");
  return generateMetadata({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve(params),
  });
}

const BUDZET_RENDERU = 60_000;

describe("strona kategorii (ADR-247)", () => {
  beforeAll(async () => {
    await renderKategoria(SLUG);
    stan.wywolania.length = 0;
  }, BUDZET_RENDERU);

  beforeEach(() => {
    stan.tenantId = TENANT;
    stan.pozaOknem = false;
    stan.total = POZYCJI;
    stan.stronaGlowna = true;
    stan.pigulka = true;
    stan.banner = null;
    stan.wywolania.length = 0;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Trzy stany kategorii → trzy zachowania (ADR-244)
  // -------------------------------------------------------------------
  it("najemca poza oknem handlowym (koperta NULL) to 404", async () => {
    stan.pozaOknem = true;
    await expect(renderKategoria(SLUG)).rejects.toThrow("notFound");
  });

  it("slug nieznany (category=null) to 404, nie pusty widok", async () => {
    await expect(renderKategoria("nieznane")).rejects.toThrow("notFound");
  });

  it("kategoria PUSTA renderuje widok z komunikatem, a NIE 404", async () => {
    stan.total = 0;
    const html = await renderKategoria(SLUG);
    expect(html, "pusta kategoria nie wyrenderowała niczego").toContain("data-category-empty");
    expect(html, "pusta kategoria pokazała komunikat pustej listy").toContain(
      "W tej kategorii nie ma jeszcze produktów",
    );
    // Pusta kategoria ma stronę pierwszą, ale jej strona druga to 404.
    vi.resetModules();
    stan.total = 0;
    await expect(renderKategoria(SLUG, { strona: "2" })).rejects.toThrow("notFound");
  }, BUDZET_RENDERU);

  it("wejście BEZ nagłówka najemcy (spoza gałęzi tenanckiej) to 404", async () => {
    stan.tenantId = null;
    await expect(renderKategoria(SLUG)).rejects.toThrow("notFound");
  });

  // -------------------------------------------------------------------
  // 2. Stronicowanie NAPRAWDĘ ogranicza dokument
  // -------------------------------------------------------------------
  it("druga strona pokazuje INNE pozycje i nie pokazuje ANI JEDNEJ z pierwszej", async () => {
    const pierwsza = await renderKategoria(SLUG);
    vi.resetModules();
    const druga = await renderKategoria(SLUG, { strona: "2" });

    expect(pierwsza, "pierwsza strona nie pokazała pierwszej pozycji").toContain(nazwa(1));
    expect(druga, "druga strona nie pokazała pozycji ze swojego okna").toContain(
      nazwa(CATALOG_PAGE_SIZE + 1),
    );
    expect(druga, "pozycja z pierwszej strony wyciekła na drugą").not.toContain(nazwa(1));
    expect(pierwsza, "pozycja z drugiej strony stoi już na pierwszej").not.toContain(
      nazwa(CATALOG_PAGE_SIZE + 1),
    );
  }, BUDZET_RENDERU);

  it("zapytanie do bazy niesie NUMER STRONY (nie offset) i najemcę z nagłówka", async () => {
    await renderKategoria(SLUG, { strona: "3" });
    const odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_category_page",
    );
    expect(odczyt, "trasa nie zapytała bazy o stronę kategorii").toBeTruthy();
    expect(odczyt!.args.p_page, "trasa liczy offset w pamięci zamiast oddać numer strony").toBe(3);
    expect(odczyt!.args.p_page_size).toBe(CATALOG_PAGE_SIZE);
    expect(odczyt!.args.p_slug).toBe(SLUG);
    expect(odczyt!.args.p_tenant_id, "najemca nie przyszedł z nagłówka").toBe(TENANT);
  }, BUDZET_RENDERU);

  it("numer strony ZA ostatnią stroną to 404, a nie pusta siatka", async () => {
    await expect(renderKategoria(SLUG, { strona: "99" })).rejects.toThrow("notFound");
  });

  it.each(["0", "-1", "01", "abc", "1.5", ""])("numer `%s` nie jest adresem — 404", async (raw) => {
    await expect(renderKategoria(SLUG, { strona: raw })).rejects.toThrow("notFound");
  });

  it("KONTROLA POZYTYWNA: ostatnia istniejąca strona renderuje się", async () => {
    const html = await renderKategoria(SLUG, { strona: "3" });
    expect(html).toContain(nazwa(POZYCJI));
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3. Sortowanie mapuje się na p_sort i trzyma się w adresie
  // -------------------------------------------------------------------
  it.each([
    ["price_asc", "price_asc"],
    ["price_desc", "price_desc"],
    ["newest", "newest"],
  ])("sort `%s` w adresie schodzi na p_sort=%s bazy", async (urlSort, dbSort) => {
    await renderKategoria(SLUG, { sort: urlSort });
    const odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_category_page",
    );
    expect(odczyt!.args.p_sort).toBe(dbSort);
  }, BUDZET_RENDERU);

  it("sort domyślny (nazwa) i literówka schodzą na p_sort=catalog", async () => {
    await renderKategoria(SLUG);
    let odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_category_page",
    );
    expect(odczyt!.args.p_sort, "brak parametru = porządek katalogu").toBe("catalog");

    stan.wywolania.length = 0;
    vi.resetModules();
    await renderKategoria(SLUG, { sort: "byle-co" });
    odczyt = (stan.wywolania as { fn: string; args: Record<string, unknown> }[]).find(
      (w) => w.fn === "get_public_category_page",
    );
    expect(odczyt!.args.p_sort, "literówka nie wywraca sklepu — schodzi do katalogu").toBe(
      "catalog",
    );
  }, BUDZET_RENDERU);

  it("przełącznik sortowania jest ODNOŚNIKAMI, które trafiają w stronę 1 z sortem", async () => {
    const html = await renderKategoria(SLUG, { sort: "price_asc" });
    expect(html).toContain("data-category-sort");
    // Aktywny porządek nie jest odnośnikiem do samego siebie.
    expect(html).toContain("data-category-sort-active");
    // Zmiana na inny porządek celuje w stronę 1 z tym sortem.
    expect(html).toContain(`href="${categoryPagePath(SLUG, 1, "price_desc")}"`);
    // Powrót do porządku domyślnego to adres CZYSTY (bez ?sort=).
    expect(html).toContain(`href="${categoryPagePath(SLUG, 1, "name")}"`);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 4. Nawigacja stron NIESIE sort
  // -------------------------------------------------------------------
  it("nawigacja stron składa się z odnośników, które niosą bieżący sort", async () => {
    // renderToStaticMarkup eskejpuje `&` w atrybutach na `&amp;`, więc adres
    // o dwóch parametrach porównujemy w jego formie zakodowanej w HTML.
    const esc = (path: string) => path.replaceAll("&", "&amp;");
    const html = await renderKategoria(SLUG, { sort: "price_asc", strona: "2" });
    expect(html).toContain(`href="${categoryPagePath(SLUG, 1, "price_asc")}"`);
    expect(html).toContain(`href="${esc(categoryPagePath(SLUG, 3, "price_asc"))}"`);
    // Bieżąca strona nie jest odnośnikiem do samej siebie.
    expect(html).not.toContain(`href="${esc(categoryPagePath(SLUG, 2, "price_asc"))}"`);
    expect(html).toContain('aria-current="page"');
  }, BUDZET_RENDERU);

  it("kategoria mieszcząca się na jednej stronie nie dostaje nawigacji", async () => {
    stan.total = 3;
    const html = await renderKategoria(SLUG);
    expect(html, "pasek z jedynym numerem jest szumem").not.toContain("data-category-pager");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 5. Szablon: nagłówek, okruszki, baner, opis
  // -------------------------------------------------------------------
  it("nagłówek niesie DOKŁADNIE jedną nazwę kategorii jako h1 i okruszki", async () => {
    const html = await renderKategoria(SLUG);
    expect(html).toContain("data-category-breadcrumbs");
    expect(html).toMatch(/<h1[^>]*>Rowery<\/h1>/);
    // BreadcrumbList (JSON-LD) obecny.
    expect(html).toContain("BreadcrumbList");
  }, BUDZET_RENDERU);

  it("baner renderuje się TYLKO gdy kategoria ma image_path", async () => {
    const bez = await renderKategoria(SLUG);
    expect(bez, "baner pojawił się mimo braku image_path").not.toContain("data-category-banner");

    stan.banner = "kategorie/rowery/hero.jpg";
    vi.resetModules();
    const zBanerem = await renderKategoria(SLUG);
    expect(zBanerem).toContain("data-category-banner");
    expect(zBanerem, "URL banera nie wskazał publicznego bucketa sklepu").toContain(
      "/storage/v1/object/public/site-images/kategorie/rowery/hero.jpg",
    );
  }, BUDZET_RENDERU);

  it("opis kategorii renderuje się jako TEKST, nie znaczniki, i tylko gdy jest", async () => {
    const bez = await renderKategoria(SLUG);
    expect(bez).not.toContain("data-category-description");

    vi.resetModules();
    const zOpisem = await renderKategoria("opisana");
    expect(zOpisem).toContain("data-category-description");
    expect(zOpisem).toContain("Rowery górskie i miejskie na doby.");
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 6. Indeksowalność — kanon czystej strony i noindex pustej
  // -------------------------------------------------------------------
  it("kanon CELUJE W CZYSTĄ stronę kategorii niezależnie od sortu i numeru strony", async () => {
    const pierwsza = await metadane(SLUG);
    expect(pierwsza.alternates?.canonical).toBe("https://sklep.example.test/kategoria/rowery");

    vi.resetModules();
    const druga = await metadane(SLUG, { sort: "price_asc", strona: "2" });
    expect(
      druga.alternates?.canonical,
      "kanon wariantu sort/strona musi konsolidować się do czystej strony kategorii",
    ).toBe("https://sklep.example.test/kategoria/rowery");
  });

  it("kategoria PUSTA zostaje POZA indeksem (treść cienka)", async () => {
    stan.total = 0;
    const meta = await metadane(SLUG);
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("sklep bez opublikowanej strony głównej zostaje poza indeksem — spójnie z robots.txt", async () => {
    stan.stronaGlowna = false;
    const meta = await metadane(SLUG);
    expect(meta.robots).toMatchObject({ index: false });
  });

  it("numer strony spoza formy kanonicznej to noindex w metadanych", async () => {
    const zly = await metadane(SLUG, { strona: "abc" });
    expect(zly.robots).toMatchObject({ index: false });
  });

  it("tytuł niesie nazwę kategorii, a od strony 2 także numer strony", async () => {
    const pierwsza = await metadane(SLUG);
    expect(String(pierwsza.title)).toContain("Rowery");

    vi.resetModules();
    const druga = await metadane(SLUG, { strona: "2" });
    expect(druga.title).not.toBe(pierwsza.title);
    expect(String(druga.title)).toContain("2");
  });

  // -------------------------------------------------------------------
  // 7. Pigułka terminu w pasku respektuje flagę najemcy (ADR-203)
  // -------------------------------------------------------------------
  it("pigułka w pasku: JEST przy fladze on, ZNIKA po wyłączeniu przez najemcę", async () => {
    const wlaczona = await renderKategoria(SLUG);
    expect(wlaczona).toContain('data-store-term="true"');
    expect(wlaczona).toContain("data-store-term-toggle");

    stan.pigulka = false;
    vi.resetModules();
    const wylaczona = await renderKategoria(SLUG);
    expect(wylaczona).not.toContain('data-store-term="true"');
    expect(wylaczona).not.toContain("data-store-term-toggle");
    // Kategoria dalej SPRZEDAJE: siatka pozycji zostaje.
    expect(wylaczona, "flaga off zgasiła całą stronę kategorii").toContain(nazwa(1));
  }, BUDZET_RENDERU);
});
