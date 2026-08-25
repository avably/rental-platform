// @vitest-environment jsdom

/**
 * PODGLĄD MÓWI JĘZYKIEM SKLEPU, NIE JĘZYKIEM PANELU (L6, audyt E2E 2026-08-07).
 *
 * Podgląd szkicu odpowiada na pytanie „co zobaczy klient po publikacji" — a do
 * L6 odpowiadał na nie w JĘZYKU OPERATORA: `SiteRenderer` szedł bez propsu
 * `labels` (spadał na `DEFAULT_SITE_LABELS`, czyli polskie), a `money.locale`
 * brał z `getLocale()` — locale URL PANELU. Najemca prowadzący sklep po
 * angielsku widział w podglądzie polskie „doba" i polski zapis kwot, których
 * jego klient nigdy nie zobaczy.
 *
 * Kontrakt po naprawie — lustro sklepu (store/page.tsx):
 *   1. etykiety chrome renderu (labels) i formatowanie pieniędzy jadą z
 *      `tenants.locale` (ta sama oś, z której czyta sklep);
 *   2. ŹRÓDŁEM stringów jest i18n panelu (`site.renderLabels`), utrzymywane
 *      jako LUSTRO `storefront.siteLabels` — równość przypina ten test, więc
 *      poprawka etykiety w sklepie bez poprawki w panelu pali w CI (ADR-102);
 *   3. pasek podglądu (chrome PANELU) zostaje w języku operatora — zmiana
 *      dotyczy wyłącznie strony najemcy.
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import panelEn from "../messages/en.json";
import panelPl from "../messages/pl.json";
import storefrontEn from "../../storefront/messages/en.json";
import storefrontPl from "../../storefront/messages/pl.json";

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/* ============================== MOCKI TRASY ============================== */

const state = vi.hoisted(() => ({
  tenantLocale: "pl" as string,
}));

/** Wiersze zapytań supabase per tabela — komplet, którego trasa potrzebuje. */
const rowsFor = (table: string): unknown[] => {
  if (table === "tenants") return [{ locale: state.tenantLocale }];
  if (table === "tenant_settings") return [{ value: "PLN" }];
  if (table === "products")
    return [{ id: "p1", name: "Młot wyburzeniowy", description: null, base_price_day_grosze: 15000 }];
  return [];
};

/** Chainable atrapa PostgREST: każda metoda wraca budowniczym, await kończy. */
function queryFor(table: string) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: rowsFor(table)[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rowsFor(table), error: null }).then(resolve),
  };
  return builder;
}

const supabase = { from: (table: string) => queryFor(table) };

vi.mock("@/lib/member-page", () => ({
  requireMemberPage: vi.fn(async () => ({ tenantId: TENANT_ID, supabase })),
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "test-nonce" }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/site-image-base", () => ({
  siteImagePublicBase: () => "https://storage.local/site-images",
}));

/**
 * next-intl/server: locale URL PANELU jest ZAWSZE „pl" w tym teście — dokładnie
 * po to, żeby angielskie etykiety w drzewie mogły pochodzić WYŁĄCZNIE z osi
 * tenanckiej. Fabryka tłumaczeń honoruje wskazany locale (wzorzec layoutu).
 */
vi.mock("next-intl/server", () => {
  const dictionaries: Record<string, unknown> = { pl: panelPl, en: panelEn };
  const resolve = (locale: string, path: string): string => {
    let node: unknown = dictionaries[locale];
    for (const part of path.split(".")) {
      node = (node as Record<string, unknown> | undefined)?.[part];
    }
    return typeof node === "string" ? node : path;
  };
  return {
    getLocale: vi.fn(async () => "pl"),
    getTranslations: vi.fn(async (arg: string | { locale: string; namespace: string }) => {
      const namespace = typeof arg === "string" ? arg : arg.namespace;
      const locale = typeof arg === "string" ? "pl" : arg.locale;
      return (key: string, vars?: Record<string, string | number>) => {
        let text = resolve(locale, `${namespace}.${key}`);
        for (const [name, value] of Object.entries(vars ?? {})) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
        return text;
      };
    }),
  };
});

/** Sekcje szkicu: cennik v3 (jednostka + „od” + kwota) i kontakt v3 (etykieta wpisu). */
const SECTIONS = [
  {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    type: "pricing",
    position: 0,
    enabled: true,
    deleted_in_draft: false,
    content_draft: {
      v: 3,
      type: "pricing",
      layout: "table",
      background: "default",
      heading: "Cennik",
      items: [{ name: "Zagęszczarka", price_grosze: 12345, unit: "day", mode: "from" }],
    },
    content_published: null,
  },
  {
    id: "bbbbbbbb-2222-4222-8222-222222222222",
    type: "contact",
    position: 1,
    enabled: true,
    deleted_in_draft: false,
    content_draft: {
      v: 3,
      type: "contact",
      layout: "stacked",
      background: "default",
      heading: "Kontakt",
      items: [{ kind: "email", value: "biuro@firma.pl" }],
      showForm: false,
      askPhone: false,
    },
    content_published: null,
  },
  {
    id: "cccccccc-3333-4333-8333-333333333333",
    type: "products",
    position: 2,
    enabled: true,
    deleted_in_draft: false,
    content_draft: { heading: "Sprzęt" },
    content_published: null,
  },
];

vi.mock("@/lib/site-queries", () => ({
  getSiteWithSections: vi.fn(async () => ({
    site: { id: SITE_ID, name: "Strona sklepu", template: "classic", style_draft: {} },
    sections: SECTIONS,
  })),
}));

const { default: SiteDraftPreviewPage } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/podglad/page"
);

async function renderPreview(tenantLocale: string) {
  state.tenantLocale = tenantLocale;
  const page = await SiteDraftPreviewPage({ params: Promise.resolve({ siteId: SITE_ID }) });
  return render(page);
}

afterEach(() => cleanup());

/* ============================ KONTRAKT LUSTRA ============================ */

describe("i18n panelu niesie etykiety chrome renderu jako LUSTRO sklepu", () => {
  it("PL: site.renderLabels ≡ storefront.siteLabels — co do klucza i znaku", () => {
    expect(
      (panelPl.site as Record<string, unknown>).renderLabels,
      "panel nie ma sekcji site.renderLabels",
    ).toEqual(storefrontPl.storefront.siteLabels);
  });

  it("EN: site.renderLabels ≡ storefront.siteLabels — co do klucza i znaku", () => {
    expect(
      (panelEn.site as Record<string, unknown>).renderLabels,
      "panel nie ma sekcji site.renderLabels",
    ).toEqual(storefrontEn.storefront.siteLabels);
  });
});

describe("słownik etykiet renderu wybiera język po osi tenanckiej", () => {
  it("zwraca komplet etykiet EN i PL, znormalizowany jak w sklepie", async () => {
    const { siteRenderLabels, normalizeTenantSiteLocale } = await import(
      "@/lib/site-render-labels"
    );

    expect(siteRenderLabels("en").productsCatalog).toBe("See the full catalog →");
    expect(siteRenderLabels("pl").productsCatalog).toBe("Zobacz cały katalog →");
    // Normalizacja jak `normalizeStorefrontLocale`: nieznane i puste → pl.
    expect(normalizeTenantSiteLocale("en")).toBe("en");
    expect(normalizeTenantSiteLocale("pl")).toBe("pl");
    expect(normalizeTenantSiteLocale("de")).toBe("pl");
    expect(normalizeTenantSiteLocale(null)).toBe("pl");
  });
});

/* ============================ RENDER TRASY ============================ */

describe("podgląd szkicu u najemcy EN mówi po angielsku mimo panelu PL", () => {
  it("fikstury sekcji przechodzą schematy szkicu (kontrola fikstur)", async () => {
    const { SECTION_DRAFT_SCHEMAS } = await import("@avably/core/site");
    for (const section of SECTIONS) {
      const parsed = SECTION_DRAFT_SCHEMAS[
        section.type as keyof typeof SECTION_DRAFT_SCHEMAS
      ].safeParse(section.content_draft);
      expect(parsed.success, `fikstura ${section.type} nie przechodzi schematu`).toBe(true);
    }
  });

  it("chrome renderu i pieniądze jadą z tenants.locale = en", async () => {
    const { container } = await renderPreview("en");
    const text = container.textContent ?? "";

    // Etykieta wpisu kontaktowego — chrome renderu, nie treść najemcy.
    expect(text).toContain("Email:");
    expect(text, "polska etykieta kontaktu u najemcy EN").not.toContain("E-mail:");

    // Cennik: przedrostek „od”, jednostka i zapis kwoty w języku SKLEPU.
    expect(text).toContain("from");
    expect(text).toContain("day");
    expect(text, "polska jednostka u najemcy EN").not.toContain("doba");
    expect(text, "kwota sformatowana po polsku u najemcy EN").not.toContain("123,45");
    expect(text).toMatch(/PLN\s?123\.45/);

    // Karta produktu z katalogu: etykieta ceny też w języku sklepu.
    expect(text).toMatch(/from\s+PLN\s?150\.00\s+\/\s+day/);

    // PASEK PODGLĄDU zostaje w języku OPERATORA (locale URL panelu = pl).
    expect(text).toContain(panelPl.site.preview.draftTitle);
  });

  it("kontrola negatywna: najemca PL dostaje polskie etykiety i polski zapis kwot", async () => {
    const { container } = await renderPreview("pl");
    const text = container.textContent ?? "";

    expect(text).toContain("E-mail:");
    expect(text).toContain("doba");
    expect(text).toContain("od");
    expect(text).toMatch(/123,45\s?zł/);
    expect(text, "angielska jednostka u najemcy PL").not.toContain("/ day");
  });
});
