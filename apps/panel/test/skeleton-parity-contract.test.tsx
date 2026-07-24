import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ORDER_STATUSES, PAYMENT_STATUSES } from "@avably/core";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import {
  ORDERS_LIST_PARTS_WITHOUT_REGION,
  ORDERS_LIST_REGIONS,
  ORDERS_LIST_SCREEN_PARTS,
  ORDERS_LIST_SKELETON_ROWS,
  ORDER_DETAIL_INLINE_SECTIONS,
  ORDER_DETAIL_PARTS_WITHOUT_REGION,
  ORDER_DETAIL_REGIONS,
  ORDER_DETAIL_SCREEN_PARTS,
  type SkeletonRegionSpec,
} from "@/components/skeleton/screen-regions";

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
const listSource = stripComments(readFileSync(resolve(screensDir, "page.tsx"), "utf8"));
const detailSource = stripComments(readFileSync(resolve(screensDir, "[id]/page.tsx"), "utf8"));

/**
 * Własne komponenty ekranu = nazwy z importów `./…` (bez importów typów).
 * Import z własnego katalogu trasy to definicja „części tego ekranu" — a
 * pobrany z importu, nie z JSX, żeby zapis wieloliniowy albo `<Foo\n` nie
 * przemycił nowej sekcji obok skanu.
 */
function localComponents(source: string): string[] {
  const names = [...source.matchAll(/import\s*\{([^}]+)\}\s*from\s*"\.\/[^"]+";/g)]
    .flatMap((match) => match[1]!.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "" && !entry.startsWith("type "))
    .filter((entry) => /^[A-Z]/.test(entry));
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
  render(
    <OrdersTable
      rows={listRows}
      currency="PLN"
      locale="pl"
      sort={{ key: "numer", dir: "desc" }}
      baseParams={{}}
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
    expect(listSource).toContain("<OrdersTable");
    expect(detailSource).toContain("<OrderTimeline");
  });

  it("liczniki wykrywają brak regionu (kontrola pozytywna helpera)", () => {
    expect(countRegion('<div data-skeleton-region="header"></div>', "header")).toBe(1);
    expect(countRegion('<div data-skeleton-region="header-x"></div>', "header")).toBe(0);
    expect(countAnchor("aaa bb aaa", "aaa")).toBe(2);
  });

  it("manifesty nie są puste i mają unikalne nazwy regionów", () => {
    expect(ORDERS_LIST_REGIONS.length).toBeGreaterThanOrEqual(11);
    expect(ORDER_DETAIL_REGIONS.length).toBeGreaterThanOrEqual(17);
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
    expect(localComponents(listSource)).toEqual(
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
    expect(localComponents(detailSource)).toEqual(
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
});

/* ── Dostępność i próg antymigotania ───────────────────────────────────── */

describe("kontrakt szkieletów: dostępność i próg antymigotania", () => {
  it.each([
    ["lista", listSkeleton, messages.orders.list.loading],
    ["szczegół", detailSkeleton, messages.orders.detail.loading],
  ])("szkielet %s jest dekoracją, a komunikat idzie przez role=status", (_name, html, label) => {
    // Cała dekoracja pod aria-hidden…
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-busy="true"');
    // …a jedyna treść to komunikat ładowania POZA tym poddrzewem.
    expect(html).toContain('<p role="status" class="sr-only">');
    expect(html).toContain(label);
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf("data-skeleton-screen"));
  });

  it("próg antymigotania siedzi w CSS panelu i nie jest pętlą", () => {
    const css = readFileSync(resolve(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toContain("[data-skeleton-screen]");
    expect(css).toContain("skeleton-reveal");
    // Opóźnienie 200 ms — poniżej tego progu wskaźnik ładowania miga.
    expect(css).toMatch(/animation:\s*skeleton-reveal[^;]*200ms\s+both/);
    // Zakaz `extra-loops`: żadnej nieskończonej animacji szkieletu.
    expect(css).not.toMatch(/animation:[^;]*infinite/);
  });
});
