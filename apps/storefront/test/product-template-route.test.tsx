/**
 * TRASA STRONY SPRZĘTU — SZABLON ALBO STRONA WBUDOWANA (faza 5, ADR-178).
 *
 * ==================== CO TEN PLIK MIERZY ====================
 *
 * SKUTEK, a nie obecność importu. Każda asercja pyta o WYJŚCIE trasy: co jest
 * w kodzie strony, którą dostanie klient, i — równie ważne — czego tam NIE MA.
 * „Trasa importuje `SiteRenderer`" przechodziłoby dla trasy, która renderera
 * nigdy nie woła.
 *
 * Cztery osie:
 *
 *   1. FALLBACK. Bez opublikowanego szablonu klient dostaje DZISIEJSZĄ stronę
 *      wbudowaną. To jest stan każdego istniejącego najemcy, więc wdrożenie
 *      fazy 5 nie ma prawa zmienić mu ani jednego węzła.
 *
 *   2. SZABLON WYGRYWA. Z opublikowanym szablonem klient dostaje jego treść,
 *      a strony wbudowanej NIE MA. Obie połowy są konieczne: sama obecność
 *      treści szablonu przeszłaby też wtedy, gdyby trasa renderowała OBIE.
 *
 *   3. PUSTY SZABLON TEŻ WYGRYWA. Granica biegnie po PUBLIKACJI, nie po
 *      zawartości (ADR-178 R2) — inaczej operator publikuje pustą stronę
 *      i dalej widzi wbudowaną.
 *
 *   4. REKORD STRONY TO TEN SPRZĘT. Wiązanie `pageProduct` rozwiązuje się na
 *      pozycji, której dotyczy adres — a nie na pierwszej z brzegu.
 *
 * ==================== FIKSTURY W KSZTAŁCIE PRODUKCJI ====================
 *
 * Płótno v2 z geometrią absolutną, bo dokładnie to zapisuje kreator. Suita
 * ADR-160 świeciła kiedyś na zielono wobec formatu v1, którego nie ma ani
 * jeden najemca — test był zielony wobec świata, który nie istnieje.
 */
import type { ReactNode } from "react";

import { resolveSiteStyle } from "@avably/core/site";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TENANT = "11111111-1111-4111-8111-111111111111";
const SPRZET_ID = "22222222-2222-4222-8222-222222222222";
const INNY_ID = "33333333-3333-4333-8333-333333333333";

const NAZWA = "Wiertarka udarowa SDS";
const NAZWA_INNEGO = "Zageszczarka plytowa";
const NAPIS_PROJEKTOWY = "TEKST-Z-KREATORA-NIE-Z-KATALOGU";
const NAPIS_SZABLONU = "SEKCJA-SZABLONU-PRODUKTU";

/* -------------------------------------------------------------------------
 * Fikstury
 * ---------------------------------------------------------------------- */

/**
 * Sekcja szablonu w kształcie PRODUKCYJNYM: płótno v2, geometria absolutna,
 * nagłówek ZWIĄZANY z nazwą pozycji, na której stoi strona.
 *
 * `text` niesie napis projektowy — ten, który operator widzi w kreatorze.
 * Jeżeli wiązanie zadziała, w wyjściu jest nazwa sprzętu i NIE MA tego napisu;
 * gdyby silnik wiązań wypadł, byłoby odwrotnie. Jedna fikstura, dwie odpowiedzi.
 */
function sekcjaSzablonu(extra: unknown[] = []) {
  return [
    {
      id: "sekcja-szablonu",
      position: 0,
      type: "hero",
      content: {
        version: 2,
        rows: 24,
        background: "default",
        elements: [
          {
            id: "naglowek",
            kind: "heading",
            text: NAPIS_PROJEKTOWY,
            level: 1,
            align: "left",
            layout: { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } },
            bindings: {
              text: { record: { kind: "pageProduct" }, field: "name", whenEmpty: "hide" },
            },
          },
          {
            id: "znacznik",
            kind: "text",
            text: NAPIS_SZABLONU,
            variant: "body",
            align: "left",
            layout: { desktop: { x: 0, y: 8, w: 48, h: 6, z: 1 } },
          },
          ...extra,
        ],
      },
    },
  ];
}

function opublikowanySzablon(sections: unknown[]) {
  return {
    template: "classic",
    publishedAt: "2026-08-14T08:00:00.000Z",
    style: {},
    logo: null,
    sections,
  };
}

/** Pozycja w kształcie `PublicCatalogProduct` — komplet kluczy koperty 0072. */
function katalogowySprzet(id: string, name: string) {
  return {
    id,
    name,
    description: `Opis pozycji ${name}`,
    base_price_day_grosze: 12_000,
    deposit_grosze: 0,
    auto_increment_multiplier: 1,
    buffer_before_days: 0,
    buffer_after_days: 0,
    custom_fields: {},
    category_ids: [],
    pricing_tiers: [],
    images: [],
  };
}

/* -------------------------------------------------------------------------
 * Mocki — stan sterowany z każdego przypadku
 * ---------------------------------------------------------------------- */

const stan: { szablon: unknown } = { szablon: null };

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-nonce": "test-nonce" })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/seo/request-origin", () => ({
  tenantOrigin: async () => "https://sklep.example.test",
}));

vi.mock("@/lib/site/published", () => ({
  getPublishedProductTemplate: async () => stan.szablon,
}));

vi.mock("@/lib/storefront/context", () => ({
  /*
    KONTEKST SKŁADANY Z PRAWDZIWYM SŁOWNIKIEM I PRAWDZIWYM STYLEM.

    Ręcznie sklecony `copy` i ręcznie sklecony `style` wywróciły ten plik dwa
    razy z rzędu — raz na brakującej parze krojów, raz na kluczu `nav.cart`,
    którego powłoka używa poza sekcjami. To nie jest niewygoda testu, tylko
    sygnał: atrapa kontraktu, który ma kilkadziesiąt kluczy, mierzy kształt
    atrapy, a nie kształt produkcji. Słownik ładujemy więc TĄ SAMĄ funkcją,
    którą ładuje go sklep, a styl liczymy TĄ SAMĄ, którą liczy go `ctx.style`.
  */
  loadStorefrontContext: async () => {
    const { getStorefrontCopy } = await import("@/lib/storefront/copy");
    return {
      tenantId: TENANT,
      catalog: {
        tenant: { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" },
        products: [katalogowySprzet(SPRZET_ID, NAZWA), katalogowySprzet(INNY_ID, NAZWA_INNEGO)],
        custom_fields: [],
        categories: [],
        pickup_locations: [],
        delivery_methods: [],
      },
      locale: "pl",
      currency: "PLN",
      copy: await getStorefrontCopy("pl"),
      style: resolveSiteStyle({}, "classic"),
      appearance: { template: "classic", style: {}, logo: null },
      site: null,
      legalDocuments: [],
      supabaseUrl: "https://sklep.supabase.co",
    };
  },
}));

/**
 * WYJŚCIE BEZ JSON-LD — asercje o TREŚCI WIDZIALNEJ muszą pytać o nią, a nie
 * o cokolwiek w dokumencie.
 *
 * Znaleziona mutacją, nie recenzją: przy `record={undefined}` nagłówek związany
 * z rekordem strony jest WYCINANY (`whenEmpty: "hide"`), więc nazwa sprzętu
 * znika z treści — ale zostaje w JSON-LD, bo ten liczy się z katalogu. Asercja
 * `markup.toContain(NAZWA)` przechodziła więc nad stroną, na której nazwy nie
 * widać. Skrypt danych strukturalnych ma własny przypadek i tam jest mierzony.
 */
function bezJsonLd(markup: string): string {
  return markup.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g, "");
}

async function renderProductPage(id = SPRZET_ID): Promise<string> {
  const { default: TenantProductPage } = await import("../app/(tenant)/product/[id]/page");
  const tree = (await TenantProductPage({ params: Promise.resolve({ id }) })) as ReactNode;
  return renderToStaticMarkup(tree);
}

/**
 * BUDŻET CZASU MA WŁASNY HAK, a hak ma własny, JAWNY limit.
 *
 * Ten plik renderuje PRAWDZIWY komponent trasy, więc pierwsze wywołanie
 * pociąga transformację całego grafu modułów Next — na obciążonym runnerze
 * (self-hosted Mac dzieli maszynę z wykonawcami) przekracza to domyślne 5 s
 * i pali PIERWSZY przypadek pliku, udając regres. Zmierzone: 13,7 s w jobie
 * `ci`, przy kilkuset ms lokalnie na ciepłym cache.
 *
 * Rozgrzewka przenosi ten koszt do haka, a hak dostaje limit JAWNY — bo
 * przekroczony budżet haka wywraca CAŁY plik, nie jeden przypadek.
 * `vi.resetModules()` w `beforeEach` czyści rejestr modułów, ale NIE cache
 * transformacji, więc rozgrzewka nie traci ważności między przypadkami.
 */
const BUDZET_RENDERU = 30_000;

describe("strona sprzętu: szablon albo strona wbudowana (ADR-178)", () => {
  beforeAll(async () => {
    await import("../app/(tenant)/product/[id]/page");
    await import("@/lib/storefront/copy");
  }, 120_000);

  beforeEach(() => {
    stan.szablon = null;
    vi.resetModules();
  });

  // -------------------------------------------------------------------
  // 1. Fallback — wdrożenie nie zabiera działającej funkcji
  // -------------------------------------------------------------------
  it("BEZ opublikowanego szablonu klient dostaje stronę WBUDOWANĄ", async () => {
    const markup = await renderProductPage();

    // Marker strony wbudowanej: odnośnik powrotu do katalogu rysuje WYŁĄCZNIE
    // ona (gałąź szablonu nie ma go w ogóle — nawigację niesie powłoka).
    expect(markup).toContain("Wróć do katalogu");
    expect(bezJsonLd(markup)).toContain(NAZWA);
    // ...i ANI JEDNEGO węzła szablonu.
    expect(markup).not.toContain(NAPIS_SZABLONU);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 2. Szablon wygrywa — obie połowy
  // -------------------------------------------------------------------
  it("Z opublikowanym szablonem klient dostaje SZABLON, a strony wbudowanej NIE MA", async () => {
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const markup = await renderProductPage();

    expect(markup, "treść szablonu nie doszła do wyjścia").toContain(NAPIS_SZABLONU);
    expect(markup, "strona wbudowana renderuje się RAZEM z szablonem").not.toContain(
      "Wróć do katalogu",
    );
  }, BUDZET_RENDERU);

  it("nagłówek związany z REKORDEM STRONY pokazuje nazwę TEGO sprzętu", async () => {
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const markup = await renderProductPage();

    expect(bezJsonLd(markup), "nazwa sprzętu nie doszła do TREŚCI strony").toContain(NAZWA);
    // Napis projektowy z kreatora NIE MOŻE wyjść do klienta — gdyby wyszedł,
    // znaczyłoby to, że wiązanie się nie rozwiązało i render spadł na wartość
    // statyczną. To jest ta sama granica, którą pilnuje faza 3.
    expect(markup, "wiązanie pageProduct nie zadziałało — wyszła treść projektowa").not.toContain(
      NAPIS_PROJEKTOWY,
    );
  }, BUDZET_RENDERU);

  it("ten sam szablon pod INNYM adresem pokazuje INNY sprzęt", async () => {
    // Dowód, że rekord jedzie z ADRESU, a nie jest przypadkiem pierwszą
    // pozycją katalogu: bez tej nogi wiązanie celujące na stałe w `products[0]`
    // przeszłoby poprzedni przypadek.
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const markup = await renderProductPage(INNY_ID);

    expect(bezJsonLd(markup)).toContain(NAZWA_INNEGO);
    expect(markup, "szablon pokazał sprzęt spod innego adresu").not.toContain(NAZWA);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3. Pusty szablon też wygrywa
  // -------------------------------------------------------------------
  it("PUSTY opublikowany szablon NIE cofa się do strony wbudowanej", async () => {
    stan.szablon = opublikowanySzablon([]);
    const markup = await renderProductPage();

    expect(markup, "pusty szablon podmieniony na stronę wbudowaną").not.toContain(
      "Wróć do katalogu",
    );
    // Nazwa sprzętu zostaje w dokumencie jako nagłówek dla czytnika ekranu —
    // strona bez `h1` byłaby regresem dostępności wywołanym samym wdrożeniem.
    expect(bezJsonLd(markup)).toContain(NAZWA);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3b. REZERWACJA W OBU GAŁĘZIACH (faza 5, ADR-180)
  // -------------------------------------------------------------------
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: zdjęcie widgetu z KTÓREJKOLWIEK gałęzi. Do
  // ADR-180 gałąź szablonu nie miała go wcale — najemca, który opublikował
  // szablon strony sprzętu, tracił przycisk rezerwacji i nie widział tego
  // w żadnym błędzie. Dlatego obie gałęzie mierzy JEDNA pętla po tej samej
  // liście asercji: przypadek osobny dla każdej z nich prędzej czy później
  // rozjechałby się o jedną asercję i znowu przestałby pilnować drugiej.
  //
  // NIC INNEGO TEGO NIE PRZYKRYWA: suita widgetu (`product-booking.test.tsx`)
  // bada jego zachowanie, ale montuje go SAMA — przechodzi więc także wtedy,
  // gdy trasa nie renderuje go nigdzie.
  it("OBIE gałęzie oddają widget rezerwacji: przycisk do koszyka, ilość i siatkę terminu", async () => {
    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();
    // Trzecia gałąź kontrolna: szablon PUSTY. Operator, który opublikował
    // stronę bez ani jednej sekcji, też musi mieć czym sprzedawać.
    stan.szablon = opublikowanySzablon([]);
    vi.resetModules();
    const pustySzablon = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
      ["pusty szablon", pustySzablon],
    ] as const) {
      expect(markup, `${etykieta}: brak widgetu rezerwacji`).toContain(
        `data-product-booking="${SPRZET_ID}"`,
      );
      expect(markup, `${etykieta}: brak przycisku dodania do koszyka`).toContain(
        "data-product-booking-add",
      );
      expect(markup, `${etykieta}: brak siatki wyboru terminu w widgecie`).toContain(
        "data-calendar-day=",
      );
      expect(markup, `${etykieta}: brak pola ilości`).toContain('id="booking-qty"');
      expect(markup, `${etykieta}: brak etykiety przycisku koszyka`).toContain("Dodaj do koszyka");
    }
  }, BUDZET_RENDERU);

  it("widget rezerwacji jest DOKŁADNIE JEDEN na stronie wbudowanej", async () => {
    // Strona wbudowana miała do ADR-180 własną parę pól daty obok paska
    // powłoki. Zostawienie ich RAZEM z widgetem dałoby dwa wyboru terminu na
    // jednym ekranie — czyli tę samą wadę, którą naprawiał ADR-179, tylko
    // w drugą stronę. Liczymy WYSTĄPIENIA, bo „jest widget" przeszłoby też
    // wtedy, gdyby stary blok został obok.
    const markup = await renderProductPage();
    const widgety = markup.match(/data-product-booking="/g) ?? [];
    expect(widgety, "widget rezerwacji nie jest jeden").toHaveLength(1);
    expect(markup, "została stara para pól daty ze strony wbudowanej").not.toContain(
      'id="rent-start"',
    );
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 4. Metadane i JSON-LD opisują SPRZĘT w obu gałęziach
  // -------------------------------------------------------------------
  it("JSON-LD opisuje SPRZĘT niezależnie od tego, która gałąź renderuje", async () => {
    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
    ] as const) {
      expect(markup, `${etykieta}: brak JSON-LD`).toContain('"@type":"Product"');
      // Ta noga pyta o SKRYPT, więc czyta pełny znacznik świadomie.
      expect(markup, `${etykieta}: JSON-LD nie opisuje sprzętu`).toContain(NAZWA);
      expect(markup, `${etykieta}: kanon nie wskazuje adresu sprzętu`).toContain(
        `/product/${SPRZET_ID}`,
      );
    }
  }, BUDZET_RENDERU);

  it("metadane biorą tytuł z KATALOGU, a nie z treści szablonu", async () => {
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const { generateMetadata } = await import("../app/(tenant)/product/[id]/page");
    const meta = await generateMetadata({ params: Promise.resolve({ id: SPRZET_ID }) });

    expect(String(meta.title)).toContain(NAZWA);
    expect(JSON.stringify(meta)).not.toContain(NAPIS_SZABLONU);
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // Bramka wejścia bez zmian
  // -------------------------------------------------------------------
  it("sprzęt spoza katalogu najemcy oddaje 404 także wtedy, gdy szablon istnieje", async () => {
    // Szablon nie może stać się drogą, którą renderuje się cokolwiek dla
    // pozycji, której najemca nie ma w katalogu publicznym.
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    await expect(
      renderProductPage("44444444-4444-4444-8444-444444444444"),
    ).rejects.toThrow("notFound");
  }, BUDZET_RENDERU);
});
