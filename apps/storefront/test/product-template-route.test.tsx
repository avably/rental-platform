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
 * Pięć osi:
 *
 *   1. FALLBACK. Bez opublikowanego szablonu klient dostaje DZISIEJSZĄ stronę
 *      wbudowaną. To jest stan każdego istniejącego najemcy, więc wdrożenie
 *      fazy 5 nie ma prawa zmienić mu ani jednego węzła.
 *
 *   2. SZABLON WYGRYWA POD STAŁYM BLOKIEM. Z opublikowanym szablonem klient
 *      dostaje jego treść, a POWŁOKI strony wbudowanej (odnośnik powrotu do
 *      katalogu) NIE MA. Obie połowy są konieczne: sama obecność treści
 *      szablonu przeszłaby też wtedy, gdyby trasa renderowała DWIE powłoki.
 *
 *   3. PUSTY SZABLON TEŻ WYGRYWA. Granica biegnie po PUBLIKACJI, nie po
 *      zawartości (ADR-178 R2) — inaczej operator publikuje pustą stronę
 *      i dalej widzi wbudowaną.
 *
 *   4. REKORD STRONY TO TEN SPRZĘT. Wiązanie `pageProduct` rozwiązuje się na
 *      pozycji, której dotyczy adres — a nie na pierwszej z brzegu.
 *
 *   5. GÓRA STRONY JEST STAŁA I PIERWSZA (ADR-189). Stały blok (galeria + dane
 *      + widget rezerwacji) stoi w OBU gałęziach, a w gałęzi szablonu PRZED
 *      pierwszą sekcją najemcy. Ta oś mierzy KOLEJNOŚĆ w dokumencie, bo pytanie
 *      o samą obecność widgetu przeżyło regres, który ADR-189 naprawia:
 *      blok stał POD treścią szablonu i asercja obecności świeciła na zielono.
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

const SLUG = "wiertarka-udarowa-sds";
const SLUG_INNEGO = "zageszczarka-plytowa";
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

const stan: { szablon: unknown; pigulka: boolean } = { szablon: null, pigulka: true };

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(new Headers({ "x-nonce": "test-nonce" })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  // 308 przerywa render rzutem, dokładnie jak w produkcji — atrapa musi to
  // odwzorować, inaczej trasa renderowałaby się DALEJ po przekierowaniu.
  permanentRedirect: (to: string) => {
    throw new Error(`permanentRedirect:${to}`);
  },
}));

vi.mock("@/lib/seo/request-origin", () => ({
  tenantOrigin: async () => "https://sklep.example.test",
}));

vi.mock("@/lib/site/published", () => ({
  getPublishedProductTemplate: async () => stan.szablon,
}));

/**
 * Katalog najemcy po stronie ATRAPY — dwie pozycje pod dwoma adresami.
 *
 * Sklep od ADR-185 nie czyta go w całości na stronie sprzętu: kontekst tej
 * trasy niesie DOKŁADNIE jedną pozycję (`ProductPageContext`). Atrapa trzyma
 * obie, bo przypadek „ten sam szablon pod INNYM adresem" musi umieć oddać
 * inną — ale każde pojedyncze wywołanie oddaje jedną, tak jak baza.
 */
const KATALOG_ATRAPY: Record<string, { id: string; nazwa: string }> = {
  [SLUG]: { id: SPRZET_ID, nazwa: NAZWA },
  [SLUG_INNEGO]: { id: INNY_ID, nazwa: NAZWA_INNEGO },
};

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
  loadProductPageContext: async (target: { slug?: string; productId?: string }) => {
    const { getStorefrontCopy } = await import("@/lib/storefront/copy");
    const wpis = target.slug
      ? KATALOG_ATRAPY[target.slug]
      : Object.entries(KATALOG_ATRAPY).find(([, v]) => v.id === target.productId)?.[1];
    if (!wpis) return { kind: "none" };
    const slug = target.slug ?? SLUG;

    return {
      kind: "product",
      ctx: {
        tenantId: TENANT,
        catalog: {
          tenant: { name: "Wypożyczalnia Testowa", locale: "pl", currency: "PLN" },
          // JEDNA pozycja — ta spod adresu (ADR-185).
          products: [katalogowySprzet(wpis.id, wpis.nazwa)],
          custom_fields: [],
        },
        locale: "pl",
        currency: "PLN",
        copy: await getStorefrontCopy("pl"),
        style: resolveSiteStyle({}, "classic"),
        appearance: { template: "classic", style: {}, logo: null },
        // Flaga pigułki (ADR-203) sterowana z przypadku — default `true`,
        // czyli stan każdego najemcy sprzed 0090.
        storeFlags: { termCalendarEnabled: stan.pigulka },
        site: null,
        legalDocuments: [],
        // Rejestr adresów ma JEDEN wpis — adres tej pozycji (ADR-182/184).
        productSlugs: { products: [{ id: wpis.id, slug }], redirects: [] },
        supabaseUrl: "https://sklep.supabase.co",
      },
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

/**
 * Render idzie przez trasę KANONICZNĄ `/produkt/{slug}` (ADR-182) — od tej
 * migracji to ona renderuje stronę sprzętu, a `/product/{uuid}` oddaje 308.
 */
async function renderProductPage(slug = SLUG): Promise<string> {
  const { default: TenantProductPage } = await import("../app/(tenant)/produkt/[slug]/page");
  const tree = (await TenantProductPage({ params: Promise.resolve({ slug }) })) as ReactNode;
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
    await import("../app/(tenant)/produkt/[slug]/page");
    await import("@/lib/storefront/copy");
  }, 120_000);

  beforeEach(() => {
    stan.szablon = null;
    stan.pigulka = true;
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
  it("Z opublikowanym szablonem klient dostaje SZABLON, a POWŁOKI strony wbudowanej NIE MA", async () => {
    // Od ADR-189 stały blok (galeria + dane + rezerwacja) stoi w OBU gałęziach,
    // więc markerem strony wbudowanej nie jest już jej treść — jest nim
    // odnośnik powrotu do katalogu, który rysuje WYŁĄCZNIE ona.
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const markup = await renderProductPage();

    expect(markup, "treść szablonu nie doszła do wyjścia").toContain(NAPIS_SZABLONU);
    expect(markup, "powłoka strony wbudowanej renderuje się RAZEM z szablonem").not.toContain(
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
    const markup = await renderProductPage(SLUG_INNEGO);

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
    // Nazwa sprzętu zostaje w dokumencie jako WIDOCZNY nagłówek stałego bloku
    // (ADR-189) — pusty szablon znaczy „nic POD blokiem", nigdy „nic w ogóle".
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
  it("OBIE gałęzie oddają widget rezerwacji: przycisk do koszyka, ilość i pole terminu", async () => {
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
      // FORMA ZWARTA (ADR-194): wejściem do wyboru terminu jest POLE
      // z zachętą — siatka dat otwiera się dopiero po interakcji.
      expect(markup, `${etykieta}: brak pola terminu w widgecie`).toContain(
        "data-product-booking-field",
      );
      expect(markup, `${etykieta}: pole terminu bez zachęty wyboru dat`).toContain(
        "Kliknij, aby wybrać daty",
      );
      expect(markup, `${etykieta}: brak pola ilości`).toContain('id="booking-qty"');
      expect(markup, `${etykieta}: brak etykiety przycisku koszyka`).toContain("Dodaj do koszyka");
      // HAK PULSU PRODUKCYJNEGO (aneks ADR-194): goły `data-store-term` ma być
      // w SSR każdej gałęzi NIEZALEŻNIE od szerokości okna — sonda produkcyjna
      // grepuje HTML, więc znacznik chowany media query wciąż ją karmi, ale
      // znacznik ZDJĘTY z dokumentu zgasiłby ją bez żadnego innego alarmu.
      // Dopisek `="true"`, bo substring bez niego łapałby też `-toggle`.
      // Od ADR-203 kontrakt jest DWUKIERUNKOWY: marker obecny ⟺ pigułka
      // włączona. Ta pętla biegnie przy fladze WŁĄCZONEJ (stan domyślny,
      // demo-najemca pulsu trzyma default true); kierunek „flaga off →
      // markera NIE MA" mierzy przypadek 3e niżej.
      expect(markup, `${etykieta}: goły data-store-term (hak pulsu) zniknął z SSR`).toContain(
        'data-store-term="true"',
      );
    }
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3c. BRAK STALE ROZWINIĘTEJ SIATKI (ADR-194)
  // -------------------------------------------------------------------
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót zawsze rozwiniętego kalendarza miesiąca
  // w treści strony — czyli formy, którą właściciel kazał zdjąć: siatka
  // zjadała pół pierwszego ekranu i spychała opis oraz specyfikację pod
  // zwijkę. Bramka pyta o SSR KAŻDEJ gałęzi trasy, bo tylko SSR mówi, co
  // klient dostaje PRZED interakcją; suita widgetu montuje go sama i mierzy
  // dopiero zachowanie po kliknięciach.
  it("SSR żadnej gałęzi NIE niesie siatki dni — kalendarz otwiera dopiero interakcja", async () => {
    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();
    stan.szablon = opublikowanySzablon([]);
    vi.resetModules();
    const pustySzablon = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
      ["pusty szablon", pustySzablon],
    ] as const) {
      // Kontrola, że mierzymy właściwą stronę: widget rezerwacji JEST.
      expect(markup, `${etykieta}: brak widgetu — bramka mierzy pustkę`).toContain(
        `data-product-booking="${SPRZET_ID}"`,
      );
      expect(markup, `${etykieta}: stale rozwinięta siatka dni wróciła do SSR`).not.toContain(
        "data-calendar-day=",
      );
      expect(markup, `${etykieta}: otwarte okno wyboru terminu w SSR`).not.toContain(
        "data-store-term-modal",
      );
    }
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3d. PIGUŁKA TERMINU W BELCE, WIERSZ POD BELKĄ TYLKO MOBILNY (aneks ADR-194)
  // -------------------------------------------------------------------
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: powrót wiersza terminu pod belką NA DESKTOPIE
  // (forma sprzed aneksu — właściciel kazał ją zdjąć) albo zniknięcie pigułki
  // z belki. Media query nie zostawia śladu w renderze statycznym, więc bramka
  // mierzy DOKŁADNIE to, co media query czyta: klasy w SSR. Suita terminu
  // montuje pasek sama i mierzy zachowanie — o MIEJSCU w dokumencie trasy nie
  // mówi nic, dlatego ta bramka stoi tu, przy prawdziwym renderze trasy.
  it("pigułka terminu stoi W BELCE, a wiersz pod belką niesie md:hidden", async () => {
    const markup = await renderProductPage();

    // Noga kontrolna: belka w ogóle jest — bez niej `slice` mierzyłby pustkę.
    const koniecBelki = markup.indexOf("</header>");
    expect(koniecBelki, "trasa nie wyrenderowała belki menu").toBeGreaterThanOrEqual(0);
    expect(
      markup.slice(0, koniecBelki),
      "belka menu nie niesie pigułki terminu (desktop)",
    ).toContain("data-store-term-toggle");

    // Wiersz pod belką: PIERWSZE dziecko owijki `data-store-term`. Wolno mu
    // istnieć wyłącznie jako forma mobilna — czyli z `md:hidden` w klasach.
    const wiersz = markup.match(/data-store-term="true"><div class="([^"]*)"/)?.[1] ?? "";
    expect(wiersz, "wiersza terminu pod belką nie ma w SSR (forma mobilna)").toContain(
      "site-rule-top",
    );
    expect(wiersz, "wiersz terminu pod belką wrócił na desktop — zgubił md:hidden").toContain(
      "md:hidden",
    );
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 3e. PIGUŁKA WYŁĄCZONA PRZEZ NAJEMCĘ (ADR-203) — widget zostaje sam
  // -------------------------------------------------------------------
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: (1) trasa ignoruje flagę i pigułka stoi wbrew
  // ustawieniu najemcy (wtedy pierwsza połowa czerwienieje); (2) wyłączenie
  // pigułki zabiera RAZEM z nią widget rezerwacji — czyli jedyne pozostałe
  // miejsce wyboru terminu (wtedy czerwienieje druga połowa: klient bez
  // pigułki NIE MA JAK wybrać terminu globalnie, więc pole w karcie musi
  // być w pełni samowystarczalne). Marker pulsu znika ŚWIADOMIE: nie ma
  // paska = nie ma markera paska; puls produkcyjny sprawdza demo-najemcę,
  // który trzyma default true.
  it("FLAGA OFF: pigułki i paska NIE MA w żadnej gałęzi, a widget z polem terminu ZOSTAJE", async () => {
    stan.pigulka = false;

    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();
    stan.szablon = opublikowanySzablon([]);
    vi.resetModules();
    const pustySzablon = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
      ["pusty szablon", pustySzablon],
    ] as const) {
      // Pasek i OBA wystąpienia pigułki (belka + wiersz mobilny) gasną razem
      // z owijką `data-store-term` — jedną gałęzią `term=null` w powłoce,
      // nie media query.
      expect(markup, `${etykieta}: marker paska stoi wbrew wyłączonej fladze`).not.toContain(
        'data-store-term="true"',
      );
      expect(markup, `${etykieta}: pigułka terminu stoi wbrew wyłączonej fladze`).not.toContain(
        "data-store-term-toggle",
      );

      // SAMOWYSTARCZALNOŚĆ WIDGETU: pole terminu z zachętą jest w SSR, więc
      // klient wchodzący na sprzęt BEZ wcześniej wybranego terminu ma gdzie
      // go wybrać (własne okno widgetu — suita product-booking mierzy samą
      // mechanikę wyboru od zera).
      expect(markup, `${etykieta}: widget rezerwacji zniknął razem z pigułką`).toContain(
        `data-product-booking="${SPRZET_ID}"`,
      );
      expect(markup, `${etykieta}: pole terminu widgetu zniknęło razem z pigułką`).toContain(
        "data-product-booking-field",
      );
      expect(markup, `${etykieta}: pole terminu bez zachęty wyboru dat`).toContain(
        "Kliknij, aby wybrać daty",
      );
      expect(markup, `${etykieta}: przycisk koszyka zniknął razem z pigułką`).toContain(
        "data-product-booking-add",
      );
    }
  }, BUDZET_RENDERU);

  it("stały blok i widget rezerwacji są DOKŁADNIE PO JEDNYM w każdej gałęzi", async () => {
    // Strona wbudowana miała do ADR-180 własną parę pól daty obok paska
    // powłoki. Zostawienie ich RAZEM z widgetem dałoby dwa wyboru terminu na
    // jednym ekranie — czyli tę samą wadę, którą naprawiał ADR-179, tylko
    // w drugą stronę. Liczymy WYSTĄPIENIA, bo „jest widget" przeszłoby też
    // wtedy, gdyby stary blok został obok.
    //
    // Od ADR-189 to samo pytanie dotyczy STAŁEGO BLOKU we wszystkich trzech
    // gałęziach: gdyby gałąź szablonu dostała blok i RAZEM z nim starą stronę
    // wbudowaną (albo pusty szablon dorysował blok dwa razy), klient miałby
    // dwie galerie i dwa widgety — a asercja o samej obecności by to przełknęła.
    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();
    stan.szablon = opublikowanySzablon([]);
    vi.resetModules();
    const pustySzablon = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
      ["pusty szablon", pustySzablon],
    ] as const) {
      expect(
        markup.match(/data-product-booking="/g) ?? [],
        `${etykieta}: widget rezerwacji nie jest dokładnie jeden`,
      ).toHaveLength(1);
      expect(
        markup.match(/data-product-detail="/g) ?? [],
        `${etykieta}: stały blok nie jest dokładnie jeden`,
      ).toHaveLength(1);
      expect(markup, `${etykieta}: została stara para pól daty ze strony wbudowanej`).not.toContain(
        'id="rent-start"',
      );
    }
  }, BUDZET_RENDERU);

  // -------------------------------------------------------------------
  // 5. GÓRA STRONY JEST STAŁA I PIERWSZA (ADR-189)
  // -------------------------------------------------------------------
  //
  // CO MUSIAŁOBY SIĘ ZEPSUĆ: przeniesienie stałego bloku POD treść szablonu —
  // czyli dokładnie regres, który ADR-189 naprawia. Oś 3b pyta o OBECNOŚĆ
  // widgetu i regres przeżyła: widget POD sekcjami też „jest na stronie".
  // Dlatego ta oś pyta o KOLEJNOŚĆ w dokumencie, przez pozycje znaczników
  // w wyjściu renderu — a nie o to, czy coś „gdzieś" się wyrenderowało.
  it("gałąź szablonu ZACZYNA się stałym blokiem: galeria i widget PRZED pierwszą sekcją najemcy", async () => {
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    const markup = await renderProductPage();

    const blok = markup.indexOf(`data-product-detail="${SPRZET_ID}"`);
    const galeria = markup.indexOf("data-product-gallery");
    const widget = markup.indexOf(`data-product-booking="${SPRZET_ID}"`);
    const sekcja = markup.indexOf(NAPIS_SZABLONU);

    // Kontrola, że mutant w ogóle wchodzi w badaną ścieżkę: wszystkie cztery
    // znaczniki MUSZĄ być w wyjściu. `indexOf` oddaje -1 dla nieobecnego,
    // a -1 < cokolwiek, więc bez tych czterech nóg asercje kolejności byłyby
    // zielone nad stroną, na której połowy rzeczy nie ma.
    expect(blok, "brak stałego bloku w gałęzi szablonu").toBeGreaterThanOrEqual(0);
    expect(galeria, "brak galerii w gałęzi szablonu").toBeGreaterThanOrEqual(0);
    expect(widget, "brak widgetu rezerwacji w gałęzi szablonu").toBeGreaterThanOrEqual(0);
    expect(sekcja, "brak sekcji szablonu — to nie jest gałąź szablonu").toBeGreaterThanOrEqual(0);

    expect(blok, "stały blok stoi POD treścią szablonu").toBeLessThan(sekcja);
    expect(galeria, "galeria stoi POD treścią szablonu").toBeLessThan(sekcja);
    expect(widget, "widget rezerwacji stoi POD treścią szablonu").toBeLessThan(sekcja);
    // Widget siedzi WEWNĄTRZ stałego bloku, więc otwiera się PO nim.
    expect(blok, "widget rezerwacji wyprowadził się PRZED stały blok").toBeLessThan(widget);
  }, BUDZET_RENDERU);

  it("dokument ma DOKŁADNIE JEDEN `h1` w każdej gałęzi — nagłówek szablonu schodzi na `h2`", async () => {
    // Nagłówek dokumentu wnosi stały blok (nazwa pozycji). Hero szablonu ma
    // w fiksturze nagłówek POZIOMU 1 — na tej trasie musi zejść na `h2`
    // (`withDemotedHeadings`), inaczej ekran sprzętu ma dwa konkurujące tytuły
    // (zgłoszenie L-UX-01 z audytu właściciela). Gałęzie bez sekcji dowodzą
    // drugiej połowy: jedyny `h1` pochodzi ze stałego bloku, więc jest ZAWSZE,
    // także nad pustym szablonem.
    const bezSzablonu = await renderProductPage();
    stan.szablon = opublikowanySzablon(sekcjaSzablonu());
    vi.resetModules();
    const zeSzablonem = await renderProductPage();
    stan.szablon = opublikowanySzablon([]);
    vi.resetModules();
    const pustySzablon = await renderProductPage();

    for (const [etykieta, markup] of [
      ["bez szablonu", bezSzablonu],
      ["ze szablonem", zeSzablonem],
      ["pusty szablon", pustySzablon],
    ] as const) {
      expect(
        markup.match(/<h1[\s>]/g) ?? [],
        `${etykieta}: dokument nie ma dokładnie jednego h1`,
      ).toHaveLength(1);
    }

    // KONTROLA POZYTYWNA zejścia: nagłówek szablonu nie ZNIKNĄŁ — stoi jako
    // `h2` i dalej niesie nazwę pozycji z wiązania. Bez tej nogi „jeden h1"
    // przechodziłoby też wtedy, gdyby zejście poziomu WYCINAŁO nagłówek.
    expect(
      zeSzablonem,
      "nagłówek szablonu nie zszedł na h2 z rozwiązanym wiązaniem",
    ).toMatch(new RegExp(`<h2[^>]*>${NAZWA}</h2>`));
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
      // ADRES KANONICZNY, nie zastany (ADR-182): robot dostaje `/produkt/{slug}`,
      // czyli ten sam URL, który stoi w sitemapie i w `<link rel="canonical">`.
      // Adres z identyfikatorem prowadziłby go pod 308.
      expect(markup, `${etykieta}: kanon nie wskazuje adresu sprzętu`).toContain(
        `/produkt/${SLUG}`,
      );
      expect(markup, `${etykieta}: JSON-LD dalej niesie adres z identyfikatorem`).not.toContain(
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
      renderProductPage("czego-tu-nie-ma"),
    ).rejects.toThrow("notFound");
  }, BUDZET_RENDERU);
});
