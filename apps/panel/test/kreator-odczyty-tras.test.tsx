// @vitest-environment jsdom

/**
 * ODCZYTY NA TRASACH KREATORA I PODGLĄDU (ADR-174).
 *
 * Dwa odczyty siedzą nie w module, tylko w samej trasie, więc pilnuje ich ten
 * plik — i pilnuje w OBIE strony, bo w obu miejscach pustka jest stanem
 * legalnym i naprawa nie ma prawa zamienić jej w awarię:
 *
 *   1. PUNKTY ODBIORU w trasie kreatora. `?? []` zamieniało awarię bazy
 *      w zdanie „nie masz punktów odbioru" — operatorowi, który wpisał je
 *      przed chwilą na ekranie Dostaw. Odtąd nieudany odczyt RZUCA, a najemca
 *      bez punktów dalej wchodzi w kreator bez jednego słowa o błędzie.
 *
 *   2. ZNAK FIRMY w trasie podglądu. Ten kończy się INACZEJ niż reszta paczki
 *      i to jest osobna decyzja: znak jest opcjonalny, więc „nie ma znaku" to
 *      stan poprawny, a wywrócenie podglądu z powodu jednej kolumny zabrałoby
 *      operatorowi całą odpowiedź na pytanie „co zobaczy klient". Nieudany
 *      odczyt dostaje TRZECI stan — „nie udało się odczytać" — widoczny
 *      w pasku podglądu, w obu językach panelu.
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const SITE_ID = "aaaaaaaa-1111-4111-8111-111111111111";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

/* ======================= ATRAPA POSTGREST (FILTRUJE NAPRAWDĘ) ======================= */

interface Row {
  [column: string]: unknown;
}

const store = {
  sites: [] as Row[],
  site_sections: [] as Row[],
  pickup_locations: [] as Row[],
  tenants: [] as Row[],
  /** Tabela, której odczyt ma paść — wstrzyknięcie awarii bazy. */
  failing: null as string | null,
};

const AWARIA = { code: "42501", message: "permission denied" };

function queryFor(table: string) {
  let rows = [...((store as unknown as Record<string, Row[]>)[table] ?? [])];
  const failed = () => store.failing === table;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () =>
      failed() ? { data: null, error: AWARIA } : { data: rows[0] ?? null, error: null },
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve(failed() ? { data: null, error: AWARIA } : { data: rows, error: null }).then(
        resolve,
      ),
  };
  return builder;
}

const supabase = { from: (table: string) => queryFor(table) };

/* ================================== MOCKI TRAS ================================== */

/** Język, którym mówi `getTranslations` w tym przebiegu. */
let locale: "pl" | "en" = "pl";

function tekst(key: string): string {
  const messages = locale === "pl" ? plMessages : enMessages;
  return (
    key
      .split(".")
      .reduce<unknown>(
        (node, part) => (node as Record<string, unknown> | undefined)?.[part],
        messages.site,
      ) as string | undefined
  ) ?? key;
}

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));
vi.mock("@/lib/supabase-server", () => ({
  requireMember: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => locale),
  getTranslations: vi.fn(async () => (key: string) => tekst(key)),
}));

vi.mock("@/lib/site-preview-data", () => ({
  previewProductsFor: vi.fn(async () => []),
  previewCategoriesFor: vi.fn(async () => []),
}));
vi.mock("@/lib/tenant-currency", () => ({ getTenantCurrency: vi.fn(async () => "PLN") }));
vi.mock("@/lib/tenant-appearance", () => ({
  getTenantDraftStyle: vi.fn(async () => DEFAULT_SITE_STYLE),
}));
vi.mock("@/lib/custom-fields", () => ({ loadCustomFieldDefinitions: vi.fn(async () => []) }));
vi.mock("@/lib/site-image-base", () => ({ siteImagePublicBase: () => "https://obrazy.test/site" }));
vi.mock("@/lib/site-render-labels", () => ({
  getTenantSiteLocale: vi.fn(async () => "pl"),
  siteRenderLabels: vi.fn(() => ({})),
}));

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  restoreSection: vi.fn(),
  updateStoreStyle: vi.fn(),
  applyStarterTemplate: vi.fn(),
  publishSite: vi.fn(),
}));
vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const { default: SiteBuilderPage } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/page"
);
const { default: SiteDraftPreviewPage } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/podglad/page"
);

/* ================================== FIKSTURY ================================== */

function seed() {
  store.failing = null;
  locale = "pl";
  store.sites = [
    {
      id: SITE_ID,
      tenant_id: TENANT_ID,
      name: "Strona główna",
      slug: "",
      slug_published: null,
      redirect_old_slug: true,
      published_at: null,
      template: "classic",
      template_published: null,
      style_draft: {},
      style_published: {},
      created_at: "2026-08-10T10:00:00Z",
    },
  ];
  // Strona BEZ widocznych sekcji: podgląd rysuje wtedy sam pasek i zdanie
  // o pustym szkicu, więc pomiar dotyczy odczytu znaku, a nie renderu strony.
  store.site_sections = [];
  store.pickup_locations = [];
  store.tenants = [{ id: TENANT_ID, name: "Wypożyczalnia", logo_draft: null, locale: "pl" }];
}

async function renderKreator() {
  const page = await SiteBuilderPage({ params: Promise.resolve({ siteId: SITE_ID }) });
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      {page}
    </NextIntlClientProvider>,
  );
}

async function renderPodglad() {
  const page = await SiteDraftPreviewPage({ params: Promise.resolve({ siteId: SITE_ID }) });
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      {page}
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  seed();
});

afterEach(() => cleanup());

/* ======================= 1. PUNKTY ODBIORU W TRASIE KREATORA ======================= */

describe("punkty odbioru: nieudany odczyt nie udaje „nie masz punktów”", () => {
  it("trasa kreatora ODRZUCA z komunikatem o odczycie, gdy baza odmawia", async () => {
    store.failing = "pickup_locations";

    await expect(
      SiteBuilderPage({ params: Promise.resolve({ siteId: SITE_ID }) }),
      "błąd odczytu został połknięty i kreator otworzył się ze zdaniem „nie masz punktów odbioru”",
    ).rejects.toThrow(/Odczyt punktów odbioru nie powiódł się/);
  });

  it("BRAK punktów zostaje stanem cichym — kreator otwiera się bez słowa o błędzie", async () => {
    // Kontrola „nie zamień «nie ma» w «awaria»". Najemca, który nie założył
    // jeszcze punktów odbioru, ma wejść w kreator dokładnie tak, jak wchodził.
    const { container } = await renderKreator();

    expect(container.querySelector("[data-site-builder]"), "kreator się nie otworzył").not.toBeNull();
  });

  it("punkty, które SĄ, dojeżdżają do kreatora — kontrola po niepustym zbiorze", async () => {
    store.pickup_locations = [
      {
        tenant_id: TENANT_ID,
        name: "Magazyn",
        address_street: "Morska 1",
        address_zip: "80-001",
        address_city: "Gdańsk",
        active: true,
      },
    ];

    const { container } = await renderKreator();
    expect(container.querySelector("[data-site-builder]")).not.toBeNull();
  });
});

/* ========================= 2. ZNAK FIRMY W TRASIE PODGLĄDU ========================= */

describe("znak firmy w podglądzie: trzeci stan zamiast cichego braku", () => {
  it("nieudany odczyt znaku MÓWI o sobie — podgląd stoi, ale nie udaje, że znaku nie ma", async () => {
    store.failing = "tenants";

    const { container } = await renderPodglad();

    const nota = container.querySelector("[data-preview-logo-unreadable]");
    expect(
      nota,
      "awaria odczytu wróciła jako „brak znaku” — operator wgra znak jeszcze raz, żeby naprawić coś, co nie jest zepsute",
    ).not.toBeNull();
    expect(nota!.textContent).toBe(plMessages.site.preview.logoUnreadable);

    // Podgląd MA STAĆ: wywrócenie go z powodu jednej kolumny zabrałoby
    // operatorowi całą odpowiedź na pytanie „co zobaczy klient”.
    expect(container.querySelector("[data-preview-bar]"), "podgląd przestał się renderować").not.toBeNull();
  });

  it("BRAK znaku zostaje stanem cichym — najemca bez znaku nie widzi żadnej noty", async () => {
    const { container } = await renderPodglad();

    expect(container.querySelector("[data-preview-bar]")).not.toBeNull();
    expect(
      container.querySelector("[data-preview-logo-unreadable]"),
      "brak znaku został zamieniony w awarię",
    ).toBeNull();
  });

  it("WGRANY znak też nie zapala noty — kontrola po niepustym zbiorze", async () => {
    store.tenants = [
      {
        id: TENANT_ID,
        name: "Wypożyczalnia",
        logo_draft: { path: `${TENANT_ID}/logo.png`, width: 240, height: 80, inFooter: true },
        locale: "pl",
      },
    ];

    const { container } = await renderPodglad();
    expect(container.querySelector("[data-preview-logo-unreadable]")).toBeNull();
  });

  it("nota mówi w OBU językach panelu, i mówi w każdym co innego", async () => {
    store.failing = "tenants";

    locale = "en";
    const { container } = await renderPodglad();
    expect(container.querySelector("[data-preview-logo-unreadable]")!.textContent).toBe(
      enMessages.site.preview.logoUnreadable,
    );

    // Kontrola pozytywna parytetu: bez tego zdania skopiowanie wartości między
    // plikami przechodziłoby oba przebiegi po tym samym napisie.
    expect(plMessages.site.preview.logoUnreadable).not.toBe(
      enMessages.site.preview.logoUnreadable,
    );
  });
});
