// @vitest-environment jsdom

/**
 * EKRAN STRON PO FAZIE 2: ŻYWYCH STRON MOŻE BYĆ WIELE (ADR-165).
 *
 * Faza 2 (0073–0075, ADR-157/158/159) zamieniła wiersze `sites` z WERSJI jednej
 * strony w osobne STRONY, a 0074 zdjęła zdanie gaszące: publikacja jednej strony
 * NIE wyłącza pozostałych. Kreator został przy modelu sprzed tej zmiany i pytał
 * bazę „która strona najemcy jest żywa" zapytaniem `.maybeSingle()`, powołując
 * się na unikat, którego już nie ma.
 *
 * Zmierzony skutek — i to jest KLASA błędu, nie brakujący warunek: przy dwóch
 * opublikowanych stronach PostgREST oddaje BŁĄD, kod czytał wyłącznie `data`,
 * więc wynik był po cichu `null`. Operator edytujący stronę, którą klienci
 * WIDZĄ, dostawał w oknie publikacji wariant „pierwszej publikacji" — zdanie
 * fałszywe o tym, co właśnie zrobi ze swoim sklepem.
 *
 * Test trzyma cztery zdania, które psują się osobno:
 *
 *   1. NAJEMCA Z DWIEMA ŻYWYMI STRONAMI: kreator strony ŻYWEJ mówi
 *      o odświeżeniu, a nie o pierwszej publikacji (odtworzenie defektu na
 *      TRASIE, z atrapą PostgREST wierną w jednym: `maybeSingle` przy wielu
 *      wierszach oddaje błąd, nie wiersz).
 *   2. Kreator strony ROBOCZEJ mówi, pod jakim adresem strona stanie, i że
 *      pozostałe strony sklepu zostają bez zmian.
 *   3. NIEUDANY ODCZYT NIE JEST CICHYM `null` — trasa kończy się błędem,
 *      a nie kłamiącym oknem publikacji.
 *   4. Teksty są PRZYPIĘTE w obu językach: ani PL, ani EN nie ostrzega przed
 *      wygaszeniem strony, którego od 0074 nie ma, a klucz, który to zdanie
 *      niósł, nie istnieje w żadnym z plików.
 */
import { DEFAULT_SITE_STYLE, pagePathFromSlug } from "@avably/core/site";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const HOME_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OFERTA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const KONTAKT_ID = "cccccccc-3333-4333-8333-333333333333";

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

/* ======================= ATRAPA POSTGREST (WIERNA W JEDNYM) =======================
 *
 * Atrapa filtruje NAPRAWDĘ i oddaje z `maybeSingle()` BŁĄD przy więcej niż
 * jednym wierszu — dokładnie jak PostgREST. Bez tej jednej wierności test nie
 * mierzyłby niczego: zapytanie „która strona jest żywa" wracałoby przy dwóch
 * żywych stronach z pierwszym wierszem i defekt byłby niewidoczny.
 */

interface Row {
  [column: string]: unknown;
}

const store = {
  sites: [] as Row[],
  site_sections: [] as Row[],
  pickup_locations: [] as Row[],
  /** Tabela, której odczyt ma paść — wstrzyknięcie awarii bazy. */
  failing: null as string | null,
};

const READ_FAILURE = { code: "42501", message: "permission denied for table sites" };

function queryFor(table: string) {
  let rows = [...((store as unknown as Record<string, Row[]>)[table] ?? [])];
  const failed = () => store.failing === table;

  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      rows = rows.filter((row) => row[column] === value);
      return builder;
    },
    not: (column: string, operator: string, value: unknown) => {
      if (operator === "is" && value === null) rows = rows.filter((row) => row[column] != null);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (failed()) return { data: null, error: READ_FAILURE };
      // Wierność, o którą chodzi: wiele wierszy = BŁĄD, a nie pierwszy wiersz.
      if (rows.length > 1) {
        return {
          data: null,
          error: {
            code: "PGRST116",
            message: "JSON object requested, multiple (or no) rows returned",
          },
        };
      }
      return { data: rows[0] ?? null, error: null };
    },
    then: (resolve: (value: { data: Row[] | null; error: unknown }) => unknown) =>
      Promise.resolve(
        failed() ? { data: null, error: READ_FAILURE } : { data: rows, error: null },
      ).then(resolve),
  };
  return builder;
}

const supabase = { from: (table: string) => queryFor(table) };

/* ================================ MOCKI TRASY ================================ */

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));

// `getSiteWithSections` NIE jest zamockowane — to jego odczyt niesie odtąd
// prawdę o żywości edytowanej strony, więc test musi wykonać jego kod.
vi.mock("@/lib/supabase-server", () => ({
  requireMember: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "pl"),
}));

vi.mock("@/lib/site-preview-data", () => ({ previewProductsFor: vi.fn(async () => []) }));
vi.mock("@/lib/tenant-currency", () => ({ getTenantCurrency: vi.fn(async () => "PLN") }));
vi.mock("@/lib/tenant-appearance", () => ({
  getTenantDraftStyle: vi.fn(async () => DEFAULT_SITE_STYLE),
}));
vi.mock("@/lib/custom-fields", () => ({ loadCustomFieldDefinitions: vi.fn(async () => []) }));

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
  unpublishSite: vi.fn(),
  createSite: vi.fn(),
  deleteSite: vi.fn(),
  renameSite: vi.fn(),
}));
vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { default: SiteBuilderPage } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/page"
);
const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");

/* ================================== FIKSTURY ================================== */

/** Wiersz `sites`. `published_at` niepuste = stronę WIDZĄ klienci. */
function site(id: string, name: string, slug: string, publishedAt: string | null): Row {
  return {
    id,
    tenant_id: TENANT_ID,
    name,
    slug,
    slug_published: publishedAt ? slug : null,
    redirect_old_slug: true,
    published_at: publishedAt,
    template: "classic",
    template_published: publishedAt ? "classic" : null,
    style_draft: {},
    style_published: {},
    created_at: "2026-08-10T10:00:00Z",
  };
}

function heroSection(siteId: string): Row {
  return {
    id: `${siteId.slice(0, 8)}-4444-4444-8444-444444444444`,
    tenant_id: TENANT_ID,
    site_id: siteId,
    type: "hero",
    position: 0,
    enabled: true,
    deleted_in_draft: false,
    content_draft: { heading: "Alfa" },
    content_published: null,
  };
}

/** DWIE ŻYWE STRONY — stan, który po 0074 jest normalny, a nie awaryjny. */
function seedTwoLivePages() {
  store.failing = null;
  store.sites = [
    site(HOME_ID, "Strona główna", "", "2026-08-11T09:00:00Z"),
    site(OFERTA_ID, "Oferta", "oferta", "2026-08-12T09:00:00Z"),
    site(KONTAKT_ID, "Kontakt", "kontakt", null),
  ];
  store.site_sections = [heroSection(HOME_ID), heroSection(OFERTA_ID), heroSection(KONTAKT_ID)];
  store.pickup_locations = [];
}

async function renderBuilderRoute(siteId: string) {
  const page = await SiteBuilderPage({ params: Promise.resolve({ siteId }) });
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      {page}
    </NextIntlClientProvider>,
  );
}

/** Otwiera potwierdzenie publikacji i oddaje treść okna (Radix portuje do body). */
function openPublishDialog(trigger: HTMLElement): string {
  fireEvent.click(trigger);
  const dialog = document.querySelector<HTMLElement>("[role='dialog']");
  if (!dialog) throw new Error("okno publikacji się nie otworzyło");
  return dialog.textContent ?? "";
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-08-13T10:00:00Z" });
  seedTwoLivePages();
});

afterEach(() => cleanup());

/* ===================== 1–2. TRASA KREATORA PRZY DWÓCH ŻYWYCH ===================== */

const pages = plMessages.site.pages;

describe("kreator najemcy z DWIEMA żywymi stronami (ADR-165)", () => {
  it("strona ŻYWA dostaje zdanie o odświeżeniu, nie o pierwszej publikacji", async () => {
    const { container } = await renderBuilderRoute(OFERTA_ID);

    const text = openPublishDialog(container.querySelector<HTMLElement>("[data-builder-publish]")!);

    expect(text, "kreator żywej strony mówi o pierwszej publikacji").toContain(
      pages.switchBodySelf,
    );
  });

  it("strona ROBOCZA mówi, pod jakim adresem stanie, i że reszta sklepu zostaje", async () => {
    const { container } = await renderBuilderRoute(KONTAKT_ID);

    const text = openPublishDialog(container.querySelector<HTMLElement>("[data-builder-publish]")!);

    expect(text).toContain(
      pages.switchBodyNew.replace("{address}", pagePathFromSlug("kontakt")),
    );
  });

  /*
   * UWAGA NA PUSTĄ ZIELEŃ: przed ADR-165 ten przypadek przechodził, bo połknięty
   * błąd zerował wsad i wariant o wygaszeniu w kreatorze nie miał jak wejść.
   * Zdanie jest tu mimo to, bo pilnuje GÓRNEJ granicy po naprawie; jego niepusty
   * bliźniak stoi niżej, na liście stron, gdzie wariant faktycznie wchodził.
   */
  it("żaden wariant okna nie straszy wygaszeniem strony (od 0074 nie następuje)", async () => {
    for (const id of [HOME_ID, OFERTA_ID, KONTAKT_ID]) {
      const { container, unmount } = await renderBuilderRoute(id);
      const text = openPublishDialog(
        container.querySelector<HTMLElement>("[data-builder-publish]")!,
      );

      expect(text, `okno publikacji strony ${id} obiecuje wygaszenie`).not.toContain(
        "przestanie być publiczna",
      );
      unmount();
      cleanup();
    }
  });
});

/* ==================== 3. NIEUDANY ODCZYT NIE JEST CICHYM NULL ==================== */

describe("nieudany odczyt strony kończy się błędem, a nie kłamiącym oknem", () => {
  it("trasa kreatora odrzuca z komunikatem o odczycie, gdy baza odmawia", async () => {
    store.failing = "sites";

    await expect(
      SiteBuilderPage({ params: Promise.resolve({ siteId: OFERTA_ID }) }),
      "błąd odczytu został połknięty i trasa poszła dalej",
    ).rejects.toThrow(/Odczyt strony nie powiódł się/);
  });
});

/* ========================= 4. LISTA STRON I PRZYPIĘTE TEKSTY ========================= */

type ListRow = Parameters<typeof SitePages>[0]["rows"][number];

const LIST_ROWS: ListRow[] = [
  {
    id: HOME_ID,
    name: "Strona główna",
    live: true,
    kind: "page",
    slug: "",
    slugPublished: "",
    redirectOldSlug: true,
    redirectedFrom: [],
    publishedAtLabel: "11.08.2026",
    createdAtLabel: "10.08.2026",
  },
  {
    id: OFERTA_ID,
    name: "Oferta",
    live: true,
    kind: "page",
    slug: "oferta",
    slugPublished: "oferta",
    redirectOldSlug: true,
    redirectedFrom: [],
    publishedAtLabel: "12.08.2026",
    createdAtLabel: "10.08.2026",
  },
  {
    id: KONTAKT_ID,
    name: "Kontakt",
    live: false,
    kind: "page",
    slug: "kontakt",
    slugPublished: null,
    redirectOldSlug: true,
    redirectedFrom: [],
    publishedAtLabel: null,
    createdAtLabel: "11.08.2026",
  },
];

function renderList(locale: "pl" | "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "pl" ? plMessages : enMessages}
      timeZone="Europe/Warsaw"
    >
      <SitePages rows={LIST_ROWS} />
    </NextIntlClientProvider>,
  );
}

describe("lista stron przy dwóch żywych stronach — obie wersje językowe", () => {
  for (const locale of ["pl", "en"] as const) {
    const copy = (locale === "pl" ? plMessages : enMessages).site.pages;

    it(`${locale}: druga żywa strona nie jest nazywana „dotychczasową"`, async () => {
      const { container } = renderList(locale);

      const oferta = container.querySelector<HTMLElement>(`[data-site-page="${OFERTA_ID}"]`)!;
      const text = openPublishDialog(oferta.querySelector<HTMLElement>("[data-publish-site]")!);

      expect(text).toContain(copy.switchBodySelf);
      expect(text, "okno mówi o innej stronie, choć publikacja jej nie dotyczy").not.toContain(
        "Strona główna",
      );
    });

    it(`${locale}: strona robocza dostaje swój adres, a nie cudzą nazwę`, async () => {
      const { container } = renderList(locale);

      const kontakt = container.querySelector<HTMLElement>(`[data-site-page="${KONTAKT_ID}"]`)!;
      const text = openPublishDialog(kontakt.querySelector<HTMLElement>("[data-publish-site]")!);

      expect(text).toContain(copy.switchBodyNew.replace("{address}", "/kontakt"));
      /*
       * TO ZDANIE JEST TU NIEPUSTE. Lista liczyła „inną żywą stronę" z wierszy,
       * które sama dostaje, więc dla wiersza roboczego przy dwóch żywych
       * stronach wariant o wygaszeniu WCHODZIŁ i obiecywał, że „Strona główna”
       * przestanie być publiczna. Na trasie kreatora ta sama asercja była do
       * ADR-165 pusta — tam połknięty błąd zerował wsad i wariant nie wchodził.
       */
      expect(text, "wiersz roboczy obiecuje wygaszenie innej strony").not.toContain(
        locale === "pl" ? "przestanie być publiczna" : "stops being public",
      );
      expect(text, "okno publikacji nazywa cudzą stronę").not.toContain("Strona główna");
    });
  }
});

describe("teksty ekranu stron są przypięte w obu językach", () => {
  const plPages = plMessages.site.pages as Record<string, string>;
  const enPages = enMessages.site.pages as Record<string, string>;

  it("klucz niosący obietnicę wygaszenia nie istnieje w żadnym pliku", () => {
    for (const [locale, copy] of [
      ["pl", plPages],
      ["en", enPages],
    ] as const) {
      expect(
        Object.hasOwn(copy, "switchBody"),
        `${locale}: wrócił klucz opisujący przełączanie wersji`,
      ).toBe(false);
      expect(
        Object.hasOwn(copy, "switchBodyFirst"),
        `${locale}: wrócił wariant „pierwszej publikacji"`,
      ).toBe(false);
    }
  });

  it("podpis ekranu mówi o współistnieniu stron, nie o jednej wersji", () => {
    expect(plPages.subtitle).toContain("adres");
    expect(enPages.subtitle).toContain("address");
    for (const [locale, subtitle] of [
      ["pl", plPages.subtitle],
      ["en", enPages.subtitle],
    ] as const) {
      expect(subtitle, `${locale}: podpis dalej mówi o przełączaniu wersji`).not.toMatch(
        /przełącz|switch/i,
      );
    }
  });

  it("nowy wariant niesie adres i jest w obu językach INNYM napisem", () => {
    // Kontrola pozytywna: gdyby ktoś skopiował wartość między plikami, oba
    // przebiegi wyżej mierzyłyby ten sam napis i nie mierzyłyby tłumaczenia.
    expect(plPages.switchBodyNew).toContain("{address}");
    expect(enPages.switchBodyNew).toContain("{address}");
    expect(plPages.switchBodyNew).not.toBe(enPages.switchBodyNew);
    expect(plPages.subtitle).not.toBe(enPages.subtitle);
  });
});

/* Zamknięcie okna nie zostawia otwartego portalu następnemu przypadkowi. */
afterEach(async () => {
  const cancel = screen.queryByRole("button", { name: pages.cancel });
  if (cancel) {
    fireEvent.click(cancel);
    await waitFor(() => expect(document.querySelector("[role='dialog']")).toBeNull());
  }
});
