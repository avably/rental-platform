import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ORDER_STATUSES, PAYMENT_STATUSES } from "@avably/core";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import {
  ORDERS_LIST_COMPOSITION_FILES,
  ORDERS_LIST_PARTS_WITHOUT_REGION,
  ORDERS_LIST_REGIONS,
  ORDERS_LIST_SCREEN_PARTS,
  ORDERS_LIST_SKELETON_ROWS,
  ORDER_DETAIL_INLINE_SECTIONS,
  ORDER_DETAIL_PARTS_WITHOUT_REGION,
  ORDER_DETAIL_REGIONS,
  ORDER_DETAIL_SCREEN_PARTS,
  ORDER_DETAIL_SKELETON_ITEM_ROWS,
  type SkeletonRegionSpec,
} from "@/components/skeleton/screen-regions";
import {
  PAINTED_TAGS,
  tagsInsideReserve,
  tagsOutsideReserve,
  visibilityOverridesInsideReserve,
} from "./helpers/skeleton-html";

/**
 * Kontrakt ODPOWIEDNIOŚCI szkielet ↔ ekran (uwaga przeglądu N1).
 *
 * Po co istnieje: #113 przebudował listę zamówień, #114 szczegół, a żaden z
 * nich nie ruszył `loading.tsx`. Nic tego nie złapało, więc przez dwa PR-y
 * szkielet malował inny ekran niż ten, który po chwili wchodził — stąd uwaga
 * właściciela „pokazany jest ekran, który nie odpowiada temu, co się
 * wyświetla, i skacze ekran".
 *
 * Ten test wiąże obie strony trzema regułami:
 *  1. ZBIÓR REGIONÓW szkieletu = zbiór regionów z manifestu (zdjęcie regionu
 *     ze szkieletu pali test);
 *  2. każdy region manifestu ma DOWÓD po stronie ekranu — ślad w renderze
 *     komponentów prezentacyjnych albo w źródle `page.tsx` (usunięcie kafla,
 *     kolumny czy kroku osi pali test);
 *  3. WYCZERPUJĄCOŚĆ: każdy własny komponent ekranu (import `./…`) stoi albo
 *     na liście regionów, albo na jawnej liście wyjątków z powodem (dołożenie
 *     nowej sekcji bez regionu w szkielecie pali test).
 *
 * Reguły szkieletów, których ten kontrakt pilnuje, spisane są w dzienniku
 * dokumentacji (wpis N1).
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { OrdersStats } = await import("@/app/[locale]/(panel)/zamowienia/orders-stats");
const { OrdersTable } = await import("@/app/[locale]/(panel)/zamowienia/orders-table");
const { OrdersToolbar } = await import("@/app/[locale]/(panel)/zamowienia/orders-toolbar");
const { OrderTimeline } = await import("@/app/[locale]/(panel)/zamowienia/[id]/order-timeline");
const { CustomerCard } = await import("@/app/[locale]/(panel)/zamowienia/[id]/customer-card");
const { ItemsEditor } = await import("@/app/[locale]/(panel)/zamowienia/[id]/items-editor");
const { OrdersListSkeleton } = await import("@/components/skeleton/orders-list-skeleton");
const { OrderDetailSkeleton } = await import("@/components/skeleton/order-detail-skeleton");

/* ── Pomocnicze ────────────────────────────────────────────────────────── */

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

/** Ile razy dany region występuje w szkielecie (dopasowanie DOKŁADNE). */
function countRegion(html: string, region: string): number {
  return [...html.matchAll(new RegExp(`data-skeleton-region="${region}"`, "g"))].length;
}

/** Zbiór nazw regionów obecnych w szkielecie. */
function regionsOf(html: string): string[] {
  return [
    ...new Set([...html.matchAll(/data-skeleton-region="([^"]+)"/g)].map((match) => match[1]!)),
  ].sort();
}

/** Ile razy ślad ekranu występuje w dowodzie (podciąg, bez regexpa). */
function countAnchor(evidence: string, anchor: string): number {
  return evidence.split(anchor).length - 1;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const screensDir = resolve(process.cwd(), "app/[locale]/(panel)/zamowienia");
const readScreen = (file: string) =>
  stripComments(readFileSync(resolve(screensDir, file), "utf8"));

const listSource = readScreen("page.tsx");
const detailSource = readScreen("[id]/page.tsx");
/**
 * Po #120 `page.tsx` nie jest jedynym miejscem, w którym decyduje się, co na
 * liście widać — interaktywną warstwę wnosi `orders-list.tsx`, a kontrolki
 * filtrów `orders-toolbar.tsx`. Skan po samym `page.tsx` przepuściłby nowy
 * region schowany o poziom niżej.
 */
const listCompositionSources = ORDERS_LIST_COMPOSITION_FILES.map(readScreen);

/**
 * Własne komponenty ekranu = nazwy z importów `./…` (bez importów typów).
 * Import z własnego katalogu trasy to definicja „części tego ekranu" — a
 * pobrany z importu, nie z JSX, żeby zapis wieloliniowy albo `<Foo\n` nie
 * przemycił nowej sekcji obok skanu.
 */
function localComponents(sources: readonly string[]): string[] {
  const names = sources.flatMap((source) =>
    [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/[^"]+";/g)]
      .flatMap((match) => match[1]!.split(","))
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "" && !entry.startsWith("type "))
      .filter((entry) => /^[A-Z]/.test(entry)),
  );
  return [...new Set(names)].sort();
}

/* ── Dowody po stronie ekranów ─────────────────────────────────────────── */

const listRows = PAYMENT_STATUSES.map((paymentStatus, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  orderNumber: `ZAM/2026/07${index}`,
  customerLabel: `Klient ${index}`,
  customerName: `Klient ${index}`,
  customerEmail: `klient${index}@example.com`,
  equipment: ["Nagrzewnica 20 kW"],
  startDate: "2026-07-20",
  endDate: "2026-07-22",
  orderStatus: ORDER_STATUSES[index % ORDER_STATUSES.length]!,
  paymentStatus,
  totalRentalGrosze: 119900,
  currency: "PLN" as const,
}));

const listRenderEvidence = [
  render(
    <OrdersStats
      stats={{
        all: { count: 12, sumGrosze: 3_624_700 },
        toDispatch: { count: 2, sumGrosze: 0 },
        inRental: { count: 3, sumGrosze: 0 },
        outstanding: { count: 1, sumGrosze: 129_900 },
      }}
      currency="PLN"
      locale="pl"
    />,
  ),
  // Belka BEZ aktywnego zakresu: każdy z trzech chipów niesie wtedy `preset=`
  // w adresie, więc liczba chipów jest policzalna z renderu, a nie z wiary.
  render(<OrdersToolbar filter={{}} customers={[]} resultCount={7} />),
  // Tabela na KOMPLECIE kolumn i bez zaznaczenia — dokładnie ten stan, który
  // szkielet odwzorowuje (preferencji kolumn z `localStorage` nie zna).
  render(
    <OrdersTable
      rows={listRows}
      locale="pl"
      sort={{ key: "numer", dir: "desc" }}
      baseParams={{}}
      hiddenColumns={new Set()}
      selectedIds={new Set()}
      onToggleRow={() => {}}
      onToggleAll={() => {}}
    />,
  ),
].join("\n");

const detailRenderEvidence = [
  render(
    <OrderTimeline
      currency="PLN"
      orderStatus="reserved"
      paymentStatus="paid"
      shipmentStatus={null}
      createdAt="2026-07-20T10:00:00Z"
      endDate="2026-07-25"
      shipmentDispatchedAt={null}
      deposit={{ required: false, collectedGrosze: 0, balanceGrosze: 0, settled: false }}
    />,
  ),
  render(
    <CustomerCard
      data={{
        fullName: "Anna Kowalska",
        email: "anna@example.com",
        phone: "+48 600 100 200",
        addressStreet: "Polna 4",
        addressZip: "00-001",
        addressCity: "Warszawa",
        companyName: null,
        nip: null,
      }}
    />,
  ),
  // Sekcja pozycji w stanie WEJŚCIOWYM (D6/N4): zamówienie edytowalne, nic
  // nie jest otwarte do edycji — dokładnie to, co szkielet odwzorowuje.
  // Liczba pozycji = liczba wierszy szkieletu, żeby kontrakt komórek niżej
  // porównywał to samo po obu stronach.
  render(
    <ItemsEditor
      orderId="00000000-0000-4000-8000-000000000001"
      orderStatus="reserved"
      editable
      items={[
        {
          id: "00000000-0000-4000-8000-0000000000a1",
          productName: "Nagrzewnica 20 kW",
          unitId: "00000000-0000-4000-8000-0000000000b1",
          unitLabel: "NG-001",
          rentalGrosze: 24_000,
          depositGrosze: 50_000,
          freeUnitCount: 1,
          units: [{ id: "00000000-0000-4000-8000-0000000000b1", label: "NG-001", free: true }],
        },
        {
          id: "00000000-0000-4000-8000-0000000000a2",
          productName: "Agregat 5 kVA",
          unitId: null,
          unitLabel: null,
          rentalGrosze: 36_000,
          depositGrosze: 0,
          freeUnitCount: 0,
          units: [],
        },
      ]}
      products={[
        {
          id: "00000000-0000-4000-8000-0000000000c1",
          name: "Nagrzewnica 20 kW",
          freeUnits: 2,
          totalUnits: 3,
          units: [
            { id: "00000000-0000-4000-8000-0000000000b1", label: "NG-001", free: true },
            { id: "00000000-0000-4000-8000-0000000000b2", label: "NG-002", free: true },
          ],
          proposedRentalGrosze: 24_000,
          proposedDepositGrosze: 50_000,
        },
      ]}
      collectedGrosze={0}
      totalRentalGrosze={60_000}
      totalDepositGrosze={50_000}
      currency="PLN"
      locale="pl"
      actions={{
        add: async () => ({}),
        update: async () => ({}),
        remove: async () => ({}),
      }}
    />,
  ),
].join("\n");

const listSkeleton = render(<OrdersListSkeleton />);
const detailSkeleton = render(<OrderDetailSkeleton />);

const evidenceFor = (spec: SkeletonRegionSpec, render: string, source: string) =>
  spec.from === "render" ? render : source;

/* ── Kontrola pozytywna: dowody nie są puste ───────────────────────────── */

describe("kontrakt szkieletów: dowody wejściowe", () => {
  it("render ekranów i szkieletów faktycznie coś zwrócił", () => {
    // Bez tego cała reszta mogłaby być zielona po pustych zbiorach.
    expect(listRenderEvidence).toContain("data-order-stat=");
    expect(listRenderEvidence).toContain("data-order-row");
    expect(detailRenderEvidence).toContain("data-order-timeline");
    expect(detailRenderEvidence).toContain("data-customer-card");
    expect(listSkeleton).toContain("data-skeleton-screen");
    expect(detailSkeleton).toContain("data-skeleton-screen");
  });

  it("źródła ekranów są wczytane i zawierają swoje znaczniki", () => {
    expect(listSource).toContain("<OrdersList");
    expect(listCompositionSources.join("\n")).toContain("<OrdersTable");
    expect(listCompositionSources.join("\n")).toContain("<OrdersColumnsMenu");
    expect(detailSource).toContain("<OrderTimeline");
  });

  it("liczniki wykrywają brak regionu (kontrola pozytywna helpera)", () => {
    expect(countRegion('<div data-skeleton-region="header"></div>', "header")).toBe(1);
    expect(countRegion('<div data-skeleton-region="header-x"></div>', "header")).toBe(0);
    expect(countAnchor("aaa bb aaa", "aaa")).toBe(2);
  });

  it("manifesty nie są puste i mają unikalne nazwy regionów", () => {
    expect(ORDERS_LIST_REGIONS.length).toBeGreaterThanOrEqual(15);
    expect(ORDERS_LIST_COMPOSITION_FILES.length).toBeGreaterThanOrEqual(3);
    expect(ORDER_DETAIL_REGIONS.length).toBeGreaterThanOrEqual(18);
    for (const manifest of [ORDERS_LIST_REGIONS, ORDER_DETAIL_REGIONS]) {
      const names = manifest.map((spec) => spec.region);
      expect(new Set(names).size, `zduplikowana nazwa regionu: ${names.join(", ")}`).toBe(
        names.length,
      );
      for (const spec of manifest) {
        expect(spec.note.length, `region ${spec.region} bez uzasadnienia`).toBeGreaterThan(10);
      }
    }
  });
});

/* ── Lista zamówień ────────────────────────────────────────────────────── */

describe("kontrakt szkieletu listy zamówień ↔ ekran listy", () => {
  it("szkielet deklaruje DOKŁADNIE regiony z manifestu", () => {
    expect(regionsOf(listSkeleton)).toEqual(
      [...ORDERS_LIST_REGIONS.map((spec) => spec.region)].sort(),
    );
  });

  it.each(ORDERS_LIST_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s występuje w szkielecie w zadeklarowanej liczbie",
    (region, spec) => {
      expect(countRegion(listSkeleton, region)).toBe(spec.count ?? 1);
    },
  );

  it.each(ORDERS_LIST_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s ma odpowiednik na REALNYM ekranie",
    (region, spec) => {
      const found = countAnchor(evidenceFor(spec, listRenderEvidence, listSource), spec.anchor);
      if (spec.anchorCount === undefined) {
        expect(found, `brak śladu „${spec.anchor}" dla regionu ${region}`).toBeGreaterThanOrEqual(1);
      } else {
        expect(found, `ślad „${spec.anchor}" dla regionu ${region}`).toBe(spec.anchorCount);
      }
    },
  );

  it("wiersz szkieletu ma tyle komórek, ile ekran ma kolumn", () => {
    const screenColumns = countAnchor(listRenderEvidence, "<th ");
    const skeletonCells = countAnchor(listSkeleton, "<td ");
    expect(screenColumns).toBeGreaterThan(0);
    expect(skeletonCells).toBe(screenColumns * ORDERS_LIST_SKELETON_ROWS);
  });

  it("każdy własny komponent ekranu ma region albo jawny wyjątek z powodem", () => {
    expect(localComponents(listCompositionSources)).toEqual(
      [...ORDERS_LIST_SCREEN_PARTS, ...Object.keys(ORDERS_LIST_PARTS_WITHOUT_REGION)].sort(),
    );
    for (const reason of Object.values(ORDERS_LIST_PARTS_WITHOUT_REGION)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

/* ── Szczegół zamówienia ───────────────────────────────────────────────── */

describe("kontrakt szkieletu szczegółu ↔ ekran szczegółu", () => {
  it("szkielet deklaruje DOKŁADNIE regiony z manifestu", () => {
    expect(regionsOf(detailSkeleton)).toEqual(
      [...ORDER_DETAIL_REGIONS.map((spec) => spec.region)].sort(),
    );
  });

  it.each(ORDER_DETAIL_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s występuje w szkielecie w zadeklarowanej liczbie",
    (region, spec) => {
      expect(countRegion(detailSkeleton, region)).toBe(spec.count ?? 1);
    },
  );

  it.each(ORDER_DETAIL_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s ma odpowiednik na REALNYM ekranie",
    (region, spec) => {
      const found = countAnchor(evidenceFor(spec, detailRenderEvidence, detailSource), spec.anchor);
      if (spec.anchorCount === undefined) {
        expect(found, `brak śladu „${spec.anchor}" dla regionu ${region}`).toBeGreaterThanOrEqual(1);
      } else {
        expect(found, `ślad „${spec.anchor}" dla regionu ${region}`).toBe(spec.anchorCount);
      }
    },
  );

  it("każdy własny komponent ekranu ma region albo jawny wyjątek z powodem", () => {
    expect(localComponents([detailSource])).toEqual(
      [...ORDER_DETAIL_SCREEN_PARTS, ...Object.keys(ORDER_DETAIL_PARTS_WITHOUT_REGION)].sort(),
    );
    for (const reason of Object.values(ORDER_DETAIL_PARTS_WITHOUT_REGION)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it("sekcje wpisane WPROST w źródle mają komplet regionów w szkielecie", () => {
    // Sekcje wniesione przez komponenty liczy test wyżej; te cztery stoją
    // w `page.tsx` jako `<section>` i też muszą mieć swój region.
    expect(countAnchor(detailSource, "<section")).toBe(ORDER_DETAIL_INLINE_SECTIONS);
  });

  it("wiersz pozycji w szkielecie ma tyle komórek, ile ekran ma kolumn", () => {
    // Ta sama reguła co przy liście, przeniesiona na tabelę pozycji: po D6/N4
    // doszła piąta kolumna („Akcje"), a `<td` w szkielecie szczegółu pochodzą
    // WYŁĄCZNIE z tej tabeli (kaucja i dodawanie są malowane divami). Zdjęcie
    // albo dołożenie kolumny na ekranie bez zmiany szkieletu pali tu.
    const screenColumns = countAnchor(detailRenderEvidence, "<th ");
    const skeletonCells = countAnchor(detailSkeleton, "<td ");
    expect(screenColumns).toBe(5);
    expect(skeletonCells).toBe(screenColumns * ORDER_DETAIL_SKELETON_ITEM_ROWS);
  });
});

/* ── Dostępność i próg antymigotania ───────────────────────────────────── */

/**
 * DELTA v3 2026-08-05 (pinezka właściciela: „chcę widzieć TYLKO pasek u góry
 * i informację na dole — ładowanie"). Reguły tego bloku zmieniają adres albo
 * się WZMACNIAJĄ, ŻADNA nie została zdjęta:
 *  1. komunikat `role="status"` był `sr-only` (do 2026-08-04), potem widoczny
 *     na płytce w połowie ekranu, dziś jest widoczny przy DOLNEJ krawędzi okna
 *     i bez płytki — asercja nadal pilnuje, że nie ma DRUGIEGO, ukrytego
 *     tekstu (czytnik ogłosiłby stan dwa razy);
 *  2. próg antymigotania został na ramie `[data-skeleton-frame]`, bo rama
 *     trzyma szynę i komunikat — zejście na geometrię pali test;
 *  3. reguła „pudełko geometrii nie maluje powierzchni" (z 2026-08-04) ZOSTAJE
 *     jako pierwszy zamek…
 *  4. …a nad nią staje reguła MOCNIEJSZA i nowa: ekran ładowania nie maluje
 *     NICZEGO poza szyną i komunikatem. Cała rezerwa geometrii siedzi pod
 *     `visibility: hidden`, a poza jej poddrzewem nie ma prawa stać ani jeden
 *     element więcej. Wrócą ramki kafli i kreski tabeli — pali się kontrakt.
 */
describe("kontrakt ekranów ładowania: co widać, dostępność i próg", () => {
  it.each([
    ["lista", listSkeleton, messages.orders.list.loading],
    ["szczegół", detailSkeleton, messages.orders.detail.loading],
  ])("rezerwa %s jest dekoracją, a stan niesie widoczny role=status", (_name, html, label) => {
    // Cała dekoracja pod aria-hidden — asercja MUSI celować w KORZEŃ rezerwy.
    // (Łatka recenzji PM.) Samo `html.toContain('aria-hidden="true"')` było
    // PUSTE: pudełka geometrii noszą ten atrybut każde z osobna, więc łańcuch
    // był w HTML zawsze i zdjęcie `aria-hidden` z korzenia nie paliło testu.
    // Bramka, która nie umie spłonąć, niczego nie broni.
    const rootTag = html.match(/<div[^>]*data-skeleton-screen[^>]*>/)?.[0];
    expect(rootTag, "brak korzenia rezerwy").toBeDefined();
    expect(rootTag).toContain('aria-hidden="true"');
    expect(rootTag).toContain('aria-busy="true"');
    // …a treścią jest WIDOCZNY komunikat stojący POZA tym poddrzewem.
    const statusTag = html.match(/<p[^>]*role="status"[^>]*>/)?.[0];
    expect(statusTag, "brak komunikatu role=status").toBeDefined();
    expect(statusTag).toContain("data-skeleton-status");
    expect(html).toContain(label);
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("data-skeleton-screen"));
    // Widoczny znaczy widoczny: `sr-only` schowałoby go z powrotem, a drugi
    // egzemplarz komunikatu kazałby czytnikowi ogłosić stan dwa razy.
    expect(statusTag).not.toContain("sr-only");
    expect(html.split(label).length - 1, "komunikat ładowania zdublowany").toBe(1);
  });

  it.each([
    ["lista", listSkeleton],
    ["szczegół", detailSkeleton],
  ])("ekran %s nie maluje NIC poza szyną i komunikatem", (_name, html) => {
    // Sedno pinezki v3. Rezerwa nie maluje z definicji (`visibility: hidden`),
    // więc pytanie brzmi: co stoi POZA nią? Odpowiedź ma być zawsze ta sama —
    // rama, szyna z wypełnieniem i komunikat. Dołożenie czegokolwiek obok
    // (nagłówek, pudełko, druga szyna) natychmiast pali ten wiersz.
    expect(tagsOutsideReserve(html)).toEqual([...PAINTED_TAGS]);
    // Kontrola pozytywna: wycięcie faktycznie coś zabrało. Bez tego zielone
    // byłoby też puste poddrzewo, czyli szkielet bez geometrii.
    const allTags = [...html.matchAll(/<([a-z]+)[^>]*>/g)].length;
    expect(allTags, "rezerwa niemal pusta — kontrakt mierzyłby pustkę").toBeGreaterThan(100);
  });

  it("kontrola pozytywna helpera: element dołożony obok rezerwy jest widziany", () => {
    // Bramka, która nie umie spłonąć, niczego nie broni — sprawdzamy więc na
    // sztucznym HTML, że wycięcie poddrzewa NIE zjada rodzeństwa rezerwy.
    const doctored = `<div data-skeleton-frame><div data-skeleton-screen="true"><span><b>x</b></span></div><i>obok</i></div>`;
    expect(tagsOutsideReserve(doctored)).toEqual(["div", "i"]);
  });

  it.each([
    ["lista", listSkeleton],
    ["szczegół", detailSkeleton],
  ])("rezerwa %s stoi pod visibility: hidden (a nie tylko bez tła)", (_name, html) => {
    const rootTag = html.match(/<div[^>]*data-skeleton-screen[^>]*>/)?.[0] ?? "";
    const classes = (rootTag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    // `invisible` = `visibility: hidden`. Zdejmuje malowanie CAŁEGO poddrzewa
    // (obrysy, tła, tekst) i NIE rusza pudełka, więc rezerwa dalej trzyma
    // wysokość co do piksela — inaczej niż `hidden`, które ZDEJMUJE ją
    // z układu i przywraca skok przy wejściu treści.
    expect(classes, "korzeń rezerwy bez klasy `invisible`").toContain("invisible");
    expect(classes, "rezerwa zdjęta z układu — wróciłby skok").not.toContain("hidden");
  });

  it.each([
    ["lista", listSkeleton],
    ["szczegół", detailSkeleton],
  ])("żaden węzeł rezerwy %s nie przywraca sobie widoczności", (_name, html) => {
    // Uwaga recenzji PM do #179. `visibility: hidden` DZIEDZICZY się w dół, ale
    // potomek z własnym `visibility: visible` maluje się mimo ukrytego rodzica
    // (inaczej niż przy `display: none`). Deklaracja na korzeniu nie jest więc
    // dowodem na to, co widać: mutacja `cn("visible", className)` w
    // `SkeletonBlock` przechodziła CAŁĄ suitę, malując komplet pudełek.
    // Ta asercja idzie po RENDEROWANYM drzewie, a nie po jednym atrybucie.
    const nodes = tagsInsideReserve(html);
    // Osłona anty-pusta: bez węzłów filtr niżej byłby zielony po pustym zbiorze.
    expect(nodes.length, "rezerwa bez węzłów — asercja mierzyłaby pustkę").toBeGreaterThan(20);
    const offenders = visibilityOverridesInsideReserve(html);
    expect(
      offenders,
      `węzły rezerwy przywracające widoczność:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("kontrola pozytywna: odwrócenie widoczności JEST widziane w każdej postaci", () => {
    // Trzy zapisy, które realnie odwracają dziedziczenie — klasa goła, klasa
    // pod wariantem i deklaracja wprost w `style`. Czwarty przypadek jest
    // KONTROLĄ NEGATYWNĄ: `invisible` na korzeniu nie może liczyć się jako
    // odwrócenie, inaczej kontrakt paliłby się zawsze i nic nie znaczył.
    const frame = (inner: string) =>
      `<div data-skeleton-frame><div data-skeleton-screen="true" class="invisible">${inner}</div></div>`;
    expect(visibilityOverridesInsideReserve(frame('<div class="h-5 visible"></div>'))).toHaveLength(1);
    expect(visibilityOverridesInsideReserve(frame('<div class="md:visible"></div>'))).toHaveLength(1);
    expect(
      visibilityOverridesInsideReserve(frame('<div class="[visibility:visible]"></div>')),
    ).toHaveLength(1);
    expect(
      visibilityOverridesInsideReserve(frame('<div style="visibility: visible"></div>')),
    ).toHaveLength(1);
    expect(visibilityOverridesInsideReserve(frame('<div class="h-5"></div>'))).toEqual([]);
  });

  it.each([
    ["lista", listSkeleton],
    ["szczegół", detailSkeleton],
  ])("żadne pudełko geometrii %s nie maluje powierzchni (pierwszy zamek)", (_name, html) => {
    const boxes = [...html.matchAll(/<div[^>]*data-slot="skeleton-box"[^>]*>/g)].map(
      (match) => match[0],
    );
    // Kontrola pozytywna: gdyby selektor przestał cokolwiek łapać, reguła niżej
    // byłaby zielona po pustym zbiorze i nie broniłaby niczego.
    expect(boxes.length, "brak pudełek geometrii — asercja mierzyłaby pustkę").toBeGreaterThan(20);
    const painted = boxes.filter((box) => /class="[^"]*\bbg-/.test(box));
    expect(painted, `pudełka malujące tło:\n${painted.join("\n")}`).toEqual([]);
  });

  it.each([
    ["lista", listSkeleton],
    ["szczegół", detailSkeleton],
  ])("ekran %s niesie szynę ładowania z design systemu", (_name, html) => {
    expect(html).toContain('data-slot="loading-rail"');
  });

  it("próg antymigotania siedzi w CSS panelu i nie jest pętlą", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    // Próg obejmuje CAŁY wskaźnik (rezerwa + szyna + komunikat), więc siedzi
    // na ramie. Zejście z powrotem na samą geometrię pali ten wiersz.
    expect(css).toContain("[data-skeleton-frame]");
    expect(css).toContain("skeleton-reveal");
    // Opóźnienie 200 ms — poniżej tego progu wskaźnik ładowania miga.
    expect(css).toMatch(/animation:\s*skeleton-reveal[^;]*200ms\s+both/);
    // Zakaz `extra-loops`: nieskończona animacja w panelu wymaga świadomego
    // wpisu TUTAJ. Jedyny wyjątek (ADR-211): pan zrzutu w ramce laptopa na
    // ekranach wejścia — dekoracja zamówiona przez właściciela na ekranie bez
    // treści roboczej, nie wskaźnik stanu. Lista jest RÓWNOŚCIĄ, nie filtrem:
    // druga pętla (także skopiowana z tej) pali ten wiersz.
    const loops = [...css.matchAll(/animation:[^;]*infinite/g)].map((match) => match[0]);
    expect(loops).toEqual(["animation: auth-laptop-pan 18s ease-in-out infinite"]);
    // Wyjątek obowiązuje wyłącznie POD bramką reduced-motion: pętla poza
    // blokiem `no-preference` to regres dostępności, nie zmiana gustu.
    const gatedBlocks = css.match(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g) ?? [];
    expect(
      gatedBlocks.some((block) => /animation:[^;]*auth-laptop-pan[^;]*infinite/.test(block)),
      "pan laptopa wyszedł spod bramki prefers-reduced-motion: no-preference",
    ).toBe(true);
  });

  it("komunikat stoi przy dolnej krawędzi OKNA i nad paskiem mobilnym", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const rule = css.match(/\[data-skeleton-status\]\s*\{([^}]*)\}/)?.[1];
    expect(rule, "brak reguły pozycji komunikatu").toBeTypeOf("string");
    // `fixed` — bo dół niewidocznej rezerwy nie jest żadną krawędzią, a na
    // szczególe wypadałby pod zgięcie.
    expect(rule).toMatch(/position:\s*fixed/);
    // Poniżej `md` dół okna zajmuje `mobile-nav`; komunikat siada NAD rezerwą,
    // którą `main` trzyma pod ten pasek (ta sama liczba co w layoucie powłoki).
    const layout = readFileSync(
      resolve(process.cwd(), "app/[locale]/(panel)/layout.tsx"),
      "utf8",
    );
    expect(layout).toContain("pb-[calc(5.5rem+env(safe-area-inset-bottom))]");
    expect(rule).toMatch(/bottom:\s*calc\(5\.5rem \+ env\(safe-area-inset-bottom\)\)/);
  });

  it("komunikat jest wyśrodkowany na KOLUMNIE TREŚCI, nie na oknie", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    const layout = readFileSync(
      resolve(process.cwd(), "app/[locale]/(panel)/layout.tsx"),
      "utf8",
    );
    // Odsunięcie od lewej MUSI być kopią szerokości paska bocznego — inaczej
    // jedyne dwie rzeczy na ekranie (szyna i komunikat) rozjeżdżają się
    // względem siebie o pół sidebara. Rozjazd ma palić test, a nie czekać na
    // oko właściciela na zrzucie.
    expect(layout).toContain("w-[236px]");
    expect(layout).toContain("sidebar-collapsed:w-[72px]");
    expect(css).toMatch(/\[data-skeleton-status\]\s*\{[^}]*left:\s*236px/);
    expect(css).toMatch(
      /html\[data-sidebar="collapsed"\]\s*\[data-skeleton-status\]\s*\{[^}]*left:\s*72px/,
    );
  });
});
