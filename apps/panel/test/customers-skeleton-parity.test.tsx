import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

import {
  CUSTOMERS_LIST_COMPOSITION_FILES,
  CUSTOMERS_LIST_PARTS_WITHOUT_REGION,
  CUSTOMERS_LIST_REGIONS,
  CUSTOMERS_LIST_SCREEN_PARTS,
  CUSTOMERS_LIST_SKELETON_ROWS,
  CUSTOMER_DETAIL_COMPOSITION_FILES,
  CUSTOMER_DETAIL_PARTS_WITHOUT_REGION,
  CUSTOMER_DETAIL_REGIONS,
  CUSTOMER_DETAIL_SCREEN_PARTS,
  type SkeletonRegionSpec,
} from "@/components/skeleton/screen-regions";
import {
  PAINTED_TAGS,
  tagsInsideReserve,
  tagsOutsideReserve,
  visibilityOverridesInsideReserve,
} from "./helpers/skeleton-html";

/**
 * Kontrakt ODPOWIEDNIOŚCI szkielet ↔ ekran dla sekcji klientów (R6a) —
 * wzorzec `skeleton-parity-contract.test.tsx`.
 *
 * Wiąże obie strony trzema regułami: (1) zbiór regionów szkieletu = zbiór
 * regionów manifestu; (2) każdy region ma DOWÓD po stronie ekranu (render
 * komponentu prezentacyjnego albo źródło `page.tsx`); (3) WYCZERPUJĄCOŚĆ —
 * każdy własny komponent ekranu stoi na liście regionów albo na jawnej liście
 * wyjątków z powodem.
 */

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/klienci",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { CustomersTable } = await import("@/app/[locale]/(panel)/klienci/customers-table");
const { CustomersToolbar } = await import("@/app/[locale]/(panel)/klienci/customers-toolbar");
const { CustomerEditForm } = await import("@/app/[locale]/(panel)/klienci/[id]/customer-edit-form");
const { CustomerOrders } = await import("@/app/[locale]/(panel)/klienci/[id]/customer-orders");
const { CustomersListSkeleton } = await import("@/components/skeleton/customers-list-skeleton");
const { CustomerDetailSkeleton } = await import("@/components/skeleton/customer-detail-skeleton");

/* ── Pomocnicze ────────────────────────────────────────────────────────── */

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      {node}
    </NextIntlClientProvider>,
  );
}

function countRegion(html: string, region: string): number {
  return [...html.matchAll(new RegExp(`data-skeleton-region="${region}"`, "g"))].length;
}

function regionsOf(html: string): string[] {
  return [
    ...new Set([...html.matchAll(/data-skeleton-region="([^"]+)"/g)].map((match) => match[1]!)),
  ].sort();
}

function countAnchor(evidence: string, anchor: string): number {
  return evidence.split(anchor).length - 1;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const screensDir = resolve(process.cwd(), "app/[locale]/(panel)/klienci");
const readScreen = (file: string) => stripComments(readFileSync(resolve(screensDir, file), "utf8"));

const listSource = readScreen("page.tsx");
const detailSource = readScreen("[id]/page.tsx");
const listCompositionSources = CUSTOMERS_LIST_COMPOSITION_FILES.map(readScreen);
const detailCompositionSources = CUSTOMER_DETAIL_COMPOSITION_FILES.map(readScreen);

/** Własne komponenty ekranu = nazwy z importów `./…` (bez importów typów). */
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

const listRows = ["a", "b", "c"].map((suffix, index) => ({
  id: `00000000-0000-4000-8000-00000000000${index}`,
  customerLabel: `Klient ${suffix}`,
  fullName: `Klient ${suffix}`,
  email: `klient-${suffix}@example.com`,
  phone: index === 0 ? "+48 600 100 200" : null,
  orderCount: index,
  lastOrderAt: index === 0 ? null : "2026-07-20T10:00:00Z",
  banned: false,
}));

const listRenderEvidence = [
  render(<CustomersToolbar filter={{}} resultCount={3} />),
  render(
    <CustomersTable rows={listRows} locale="pl" sort={{ key: "klient", dir: "asc" }} baseParams={{}} />,
  ),
].join("\n");

const detailRenderEvidence = [
  render(
    <CustomerEditForm
      action={async () => ({})}
      defaults={{
        email: "anna@example.com",
        fullName: "Anna Kowalska",
        phone: "+48 600 100 200",
        companyName: "",
        nip: "",
        addressStreet: "Polna 4",
        addressZip: "00-001",
        addressCity: "Warszawa",
      }}
    />,
  ),
  render(
    <CustomerOrders
      orders={[
        {
          id: "00000000-0000-4000-8000-0000000000a1",
          orderNumber: "AV-2026-001",
          startDate: "2026-07-20",
          endDate: "2026-07-22",
          totalRentalGrosze: 119900,
          orderStatus: "reserved",
        },
      ]}
      currency="PLN"
      locale="pl"
    />,
  ),
].join("\n");

const listSkeleton = render(<CustomersListSkeleton />);
const detailSkeleton = render(<CustomerDetailSkeleton />);

const evidenceFor = (spec: SkeletonRegionSpec, renderEvidence: string, source: string) =>
  spec.from === "render" ? renderEvidence : source;

/* ── Kontrola pozytywna: dowody nie są puste ───────────────────────────── */

describe("kontrakt szkieletów klientów: dowody wejściowe", () => {
  it("render ekranów i szkieletów faktycznie coś zwrócił", () => {
    expect(listRenderEvidence).toContain("data-customer-row");
    expect(listRenderEvidence).toContain("data-customers-search");
    expect(detailRenderEvidence).toContain("data-customer-edit-form");
    expect(detailRenderEvidence).toContain("data-customer-order-row");
    expect(listSkeleton).toContain("data-skeleton-screen");
    expect(detailSkeleton).toContain("data-skeleton-screen");
  });

  it("źródła ekranów są wczytane i zawierają swoje znaczniki", () => {
    expect(listSource).toContain("<header");
    expect(listCompositionSources.join("\n")).toContain("<CustomersTable");
    expect(detailSource).toContain("<CustomerOrders");
    expect(detailSource).toContain("data-customer-back");
  });

  it("manifesty nie są puste i mają unikalne nazwy regionów", () => {
    expect(CUSTOMERS_LIST_REGIONS.length).toBeGreaterThanOrEqual(6);
    expect(CUSTOMER_DETAIL_REGIONS.length).toBeGreaterThanOrEqual(6);
    for (const manifest of [CUSTOMERS_LIST_REGIONS, CUSTOMER_DETAIL_REGIONS]) {
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

/* ── Lista klientów ────────────────────────────────────────────────────── */

describe("kontrakt szkieletu listy klientów ↔ ekran listy", () => {
  it("szkielet deklaruje DOKŁADNIE regiony z manifestu", () => {
    expect(regionsOf(listSkeleton)).toEqual(
      [...CUSTOMERS_LIST_REGIONS.map((spec) => spec.region)].sort(),
    );
  });

  it.each(CUSTOMERS_LIST_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s występuje w szkielecie w zadeklarowanej liczbie",
    (region, spec) => {
      expect(countRegion(listSkeleton, region)).toBe(spec.count ?? 1);
    },
  );

  it.each(CUSTOMERS_LIST_REGIONS.map((spec) => [spec.region, spec] as const))(
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
    expect(screenColumns).toBe(5);
    expect(skeletonCells).toBe(screenColumns * CUSTOMERS_LIST_SKELETON_ROWS);
  });

  it("każdy własny komponent ekranu ma region albo jawny wyjątek z powodem", () => {
    expect(localComponents(listCompositionSources)).toEqual(
      [...CUSTOMERS_LIST_SCREEN_PARTS, ...Object.keys(CUSTOMERS_LIST_PARTS_WITHOUT_REGION)].sort(),
    );
    for (const reason of Object.values(CUSTOMERS_LIST_PARTS_WITHOUT_REGION)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});

/* ── Karta klienta ─────────────────────────────────────────────────────── */

describe("kontrakt szkieletu karty klienta ↔ ekran karty", () => {
  it("szkielet deklaruje DOKŁADNIE regiony z manifestu", () => {
    expect(regionsOf(detailSkeleton)).toEqual(
      [...CUSTOMER_DETAIL_REGIONS.map((spec) => spec.region)].sort(),
    );
  });

  it.each(CUSTOMER_DETAIL_REGIONS.map((spec) => [spec.region, spec] as const))(
    "region %s występuje w szkielecie w zadeklarowanej liczbie",
    (region, spec) => {
      expect(countRegion(detailSkeleton, region)).toBe(spec.count ?? 1);
    },
  );

  it.each(CUSTOMER_DETAIL_REGIONS.map((spec) => [spec.region, spec] as const))(
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
    expect(localComponents(detailCompositionSources)).toEqual(
      [...CUSTOMER_DETAIL_SCREEN_PARTS, ...Object.keys(CUSTOMER_DETAIL_PARTS_WITHOUT_REGION)].sort(),
    );
  });
});

/* ── Dostępność ────────────────────────────────────────────────────────── */

// Delta v3 2026-08-05: z ekranu ładowania znika WSZYSTKO poza szyną u góry i
// komunikatem na dole — rezerwa geometrii stoi pod `visibility: hidden`
// (pinezka właściciela). Ekrany klientów jadą tymi samymi prymitywami co
// zamówienia, więc reguły są te same i mierzymy je tak samo. Zejście z tej pary
// ekranów pod inny prymityw pali ten blok razem z blokiem zamówień.
describe("kontrakt ekranów ładowania klientów: co widać i dostępność", () => {
  it.each([
    ["lista", listSkeleton, messages.customers.list.loading],
    ["karta", detailSkeleton, messages.customers.card.historyHeading],
  ])("rezerwa %s jest dekoracją, a stan niesie widoczny role=status", (_name, html, label) => {
    const rootTag = html.match(/<div[^>]*data-skeleton-screen[^>]*>/)?.[0];
    expect(rootTag, "brak korzenia rezerwy").toBeDefined();
    expect(rootTag).toContain('aria-hidden="true"');
    expect(rootTag).toContain('aria-busy="true"');
    const statusTag = html.match(/<p[^>]*role="status"[^>]*>/)?.[0];
    expect(statusTag, "brak komunikatu role=status").toBeDefined();
    expect(statusTag).toContain("data-skeleton-status");
    expect(statusTag).not.toContain("sr-only");
    expect(html).toContain(label);
  });

  it.each([
    ["lista", listSkeleton],
    ["karta", detailSkeleton],
  ])("ekran %s nie maluje NIC poza szyną i komunikatem", (_name, html) => {
    expect(tagsOutsideReserve(html)).toEqual([...PAINTED_TAGS]);
    // Kontrola pozytywna: wycięcie faktycznie coś zabrało (rezerwa nie jest pusta).
    expect([...html.matchAll(/<([a-z]+)[^>]*>/g)].length).toBeGreaterThan(50);
    const rootTag = html.match(/<div[^>]*data-skeleton-screen[^>]*>/)?.[0] ?? "";
    const classes = (rootTag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
    expect(classes, "korzeń rezerwy bez klasy `invisible`").toContain("invisible");
    expect(classes, "rezerwa zdjęta z układu — wróciłby skok").not.toContain("hidden");
  });

  it.each([
    ["lista", listSkeleton],
    ["karta", detailSkeleton],
  ])("żaden węzeł rezerwy %s nie przywraca sobie widoczności", (_name, html) => {
    // Uwaga recenzji PM do #179: `visibility: hidden` dziedziczy się w dół, ale
    // potomek z własnym `visible` maluje się mimo ukrytego rodzica. Kontrakt
    // musi więc przejść RENDEROWANE drzewo, a nie klasę korzenia.
    const nodes = tagsInsideReserve(html);
    expect(nodes.length, "rezerwa bez węzłów — asercja mierzyłaby pustkę").toBeGreaterThan(10);
    const offenders = visibilityOverridesInsideReserve(html);
    expect(
      offenders,
      `węzły rezerwy przywracające widoczność:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it.each([
    ["lista", listSkeleton],
    ["karta", detailSkeleton],
  ])("ekran %s: puste pudełka geometrii i szyna z design systemu", (_name, html) => {
    const boxes = [...html.matchAll(/<div[^>]*data-slot="skeleton-box"[^>]*>/g)].map(
      (match) => match[0],
    );
    expect(boxes.length, "brak pudełek geometrii — asercja mierzyłaby pustkę").toBeGreaterThan(10);
    expect(boxes.filter((box) => /class="[^"]*\bbg-/.test(box))).toEqual([]);
    expect(html).toContain('data-slot="loading-rail"');
  });
});
