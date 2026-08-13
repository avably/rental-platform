// @vitest-environment jsdom

/**
 * PODGLĄD RENDERUJE POWŁOKĘ SKLEPU, A STOPKĘ BIERZE ZE STRONY GŁÓWNEJ (ADR-172).
 *
 * ==================== DWA ZDANIA, KTÓRYCH PILNUJE TEN PLIK ====================
 *
 * 1. PODGLĄD MA POWŁOKĘ. Pasek obiecuje wprost „Tak strona wygląda po
 *    publikacji", a sklep stawia nad sekcjami nagłówek (znak firmy zamiast
 *    nazwy, koszyk) na KAŻDEJ trasie. Do ADR-172 podgląd rysował same sekcje,
 *    więc obietnica była fałszywa dokładnie tam, gdzie ma być wiarygodna —
 *    i w całym panelu nie istniała ani jedna powierzchnia pokazująca wgrany
 *    znak w nagłówku, czyli w głównym miejscu jego użycia.
 *
 * 2. STOPKA JEST WŁASNOŚCIĄ POWŁOKI, NIE STRONY (ADR-154). Sklep bierze ją ze
 *    strony GŁÓWNEJ i rysuje wszędzie; stopka zbudowana na podstronie nie
 *    dociera do klienta. Podgląd podstrony musi więc pokazywać stopkę strony
 *    głównej — i NIE POKAZYWAĆ własnej, bo tej odwiedzający nie zobaczy.
 *
 * Fikstury są w kształcie PRODUKCYJNYM: stopka to płótno v2 (`sectionCanvasFrom`),
 * bo kreator konwertuje każdą dodawaną sekcję i innego kształtu najemcy nie
 * mają. Suita zbudowana na treści v1 świeciłaby na zielono nad generacją, której
 * nie ma ani jeden najemca — ten błąd kosztował już martwy przełącznik znaku
 * w stopce (ADR-160 → naprawa ADR-167).
 */
import { presetContentFor, sectionCanvasFrom, type CanvasElement } from "@avably/core/site";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import panelEn from "../messages/en.json";
import panelPl from "../messages/pl.json";
import storefrontEn from "../../storefront/messages/en.json";
import storefrontPl from "../../storefront/messages/pl.json";

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HOME_ID = "88888888-8888-4888-8888-888888888888";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const STORE_NAME = "Wypożyczalnia Kontrolna";
const NAZWA_W_STOPCE_GLOWNEJ = "Stopka Strony Glownej sp. z o.o.";
const NAZWA_W_STOPCE_PODSTRONY = "Stopka Podstrony Ktorej Nikt Nie Zobaczy";
const BAZA_ZDJEC = "https://storage.local/site-images";
const SCIEZKA_OBRAZU = `${TENANT_ID}/sekcje/stopka.png`;
const UPLOAD_ID = "22222222-2222-4222-8222-222222222222";
const SCIEZKA_ZNAKU = `${TENANT_ID}/logo/${UPLOAD_ID}.png`;

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

/* ============================== FIKSTURY ============================== */

/** Stopka w kształcie produkcyjnym: płótno v2, opcjonalnie z obrazem. */
function stopkaPlotno(businessName: string, obraz?: "z-obrazem") {
  const plotno = sectionCanvasFrom("footer", {
    ...presetContentFor("footer", "pl"),
    businessName,
  } as Parameters<typeof sectionCanvasFrom>[1]);
  if (!obraz) return plotno;
  const element = {
    id: "footer-image-1",
    kind: "image",
    source: { kind: "storage", path: SCIEZKA_OBRAZU },
    alt: "Zdjęcie w stopce",
    fit: "contain",
    layout: { desktop: { x: 0, y: 0, w: 20, h: 8, z: 0 } },
  } as CanvasElement;
  return { ...plotno, elements: [...plotno.elements, element] };
}

function wiersz(id: string, type: string, position: number, content: unknown) {
  return {
    id,
    type,
    position,
    enabled: true,
    deleted_in_draft: false,
    content_draft: content,
    content_published: null,
  };
}

const HERO_PODSTRONY = wiersz("aaaaaaaa-1111-4111-8111-111111111111", "hero", 0, {
  heading: "Kontakt",
  subheading: "Zadzwoń albo napisz",
});

/* ============================== MOCKI TRASY ============================== */

const state = vi.hoisted(() => ({
  tenantLocale: "pl" as string,
  slug: "kontakt" as string,
  sections: [] as unknown[],
  homeSections: [] as unknown[],
  homeExists: true,
  logoDraft: null as unknown,
}));

const rowsFor = (table: string, filters: Record<string, unknown>): unknown[] => {
  if (table === "tenants")
    return [{ locale: state.tenantLocale, name: STORE_NAME, logo_draft: state.logoDraft }];
  if (table === "tenant_settings") return [{ value: "PLN" }];
  if (table === "products") return [];
  // Strona GŁÓWNA to wiersz o pustym slugu (0073, ADR-157).
  if (table === "sites")
    return state.homeExists && filters.slug === "" ? [{ id: HOME_ID }] : [];
  if (table === "site_sections") return filters.site_id === HOME_ID ? state.homeSections : [];
  return [];
};

/** Chainable atrapa PostgREST, która ZAPAMIĘTUJE filtry — bez nich nie da się
 *  odróżnić zapytania o stronę główną od zapytania o cokolwiek innego. */
function queryFor(table: string) {
  const filters: Record<string, unknown> = {};
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return builder;
    },
    not: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => ({ data: rowsFor(table, filters)[0] ?? null, error: null }),
    then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
      Promise.resolve({ data: rowsFor(table, filters), error: null }).then(resolve),
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
  siteImagePublicBase: () => BAZA_ZDJEC,
}));

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
      return (key: string) => resolve(locale, `${namespace}.${key}`);
    }),
  };
});

vi.mock("@/lib/site-queries", () => ({
  getSiteWithSections: vi.fn(async () => ({
    site: { id: SITE_ID, slug: state.slug, name: "Strona", template: "classic", style_draft: {} },
    sections: state.sections,
  })),
}));

const { default: SiteDraftPreviewPage } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/podglad/page"
);

async function renderPreview(): Promise<HTMLElement> {
  const page = await SiteDraftPreviewPage({ params: Promise.resolve({ siteId: SITE_ID }) });
  return render(page).container;
}

afterEach(() => {
  cleanup();
  state.tenantLocale = "pl";
  state.slug = "kontakt";
  state.sections = [];
  state.homeSections = [];
  state.homeExists = true;
  state.logoDraft = null;
});

/* ======================= KONTROLA FIKSTUR (pusty zbiór) ======================= */

describe("fikstury są w kształcie, który ma produkcja", () => {
  it("stopka jest płótnem v2 i niesie nazwę firmy", () => {
    const plotno = stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ) as { version: number; elements: unknown[] };
    expect(plotno.version, "fikstura nie jest płótnem — badalibyśmy martwą generację").toBe(2);
    expect(JSON.stringify(plotno.elements)).toContain(NAZWA_W_STOPCE_GLOWNEJ);
  });

  it("schemat szkicu przyjmuje fikstury (inaczej render dostałby treść domyślną)", async () => {
    const { SECTION_DRAFT_SCHEMAS } = await import("@avably/core/site");
    expect(SECTION_DRAFT_SCHEMAS.footer.safeParse(stopkaPlotno("X")).success).toBe(true);
    expect(SECTION_DRAFT_SCHEMAS.hero.safeParse(HERO_PODSTRONY.content_draft).success).toBe(true);
  });
});

/* ============================ POWŁOKA W PODGLĄDZIE ============================ */

describe("podgląd renderuje POWŁOKĘ sklepu, nie same sekcje", () => {
  it("nagłówek sklepu stoi nad treścią i POD korzeniem strony", async () => {
    state.sections = [HERO_PODSTRONY];
    const container = await renderPreview();

    const naglowek = container.querySelector("[data-store-header]");
    expect(naglowek, "podgląd rysuje same sekcje — powłoki sklepu nie ma").not.toBeNull();
    // Kontrola pozytywna: treść strony NAPRAWDĘ się wyrenderowała.
    expect(container.textContent).toContain("Zadzwoń albo napisz");

    // Zmienne motywu żyją na korzeniu, więc nagłówek POZA nim brałby paletę
    // panelu — dokładnie wada, którą zamknął K6 po stronie sklepu.
    expect(naglowek!.closest(".site-root"), "nagłówek stoi POZA korzeniem strony").not.toBeNull();
    expect(container.querySelectorAll(".site-root")).toHaveLength(1);
  });

  it("nagłówek pokazuje ZNAK ZE SZKICU, a nie nazwę sklepu", async () => {
    state.sections = [HERO_PODSTRONY];
    state.logoDraft = { path: SCIEZKA_ZNAKU, inFooter: true };
    const container = await renderPreview();

    const znak = container.querySelector<HTMLImageElement>("[data-store-header] img.site-logo");
    expect(znak, "podgląd nie pokazuje wgranego znaku w nagłówku").not.toBeNull();
    expect(znak!.getAttribute("src")).toBe(`${BAZA_ZDJEC}/${SCIEZKA_ZNAKU}`);
    expect(znak!.getAttribute("alt")).toBe(STORE_NAME);
  });

  it("bez znaku nagłówek pisze nazwę sklepu — stan normalny, nie awaria", async () => {
    state.sections = [HERO_PODSTRONY];
    const container = await renderPreview();
    expect(container.querySelector("[data-store-header]")!.textContent).toContain(STORE_NAME);
  });

  it("nagłówek podglądu NIE PROWADZI donikąd — trasa panelu nie ma koszyka", async () => {
    state.sections = [HERO_PODSTRONY];
    const container = await renderPreview();
    const naglowek = container.querySelector("[data-store-header]")!;
    expect(naglowek.querySelectorAll("a")).toHaveLength(0);
    expect(naglowek.querySelectorAll("[data-shell-inert]")).toHaveLength(2);
  });

  it("napis koszyka jedzie osią TENANCKĄ, nie językiem panelu", async () => {
    state.sections = [HERO_PODSTRONY];
    state.tenantLocale = "en";
    const container = await renderPreview();
    const naglowek = container.querySelector("[data-store-header]")!;
    expect(naglowek.textContent).toContain(storefrontEn.storefront.nav.cart);
    expect(naglowek.textContent, "polski koszyk u najemcy EN").not.toContain(
      storefrontPl.storefront.nav.cart,
    );
    // Pasek PANELU zostaje w języku operatora (locale URL panelu = pl).
    expect(container.textContent).toContain(panelPl.site.preview.draftTitle);
  });
});

/* ===================== STOPKA: WŁASNOŚĆ POWŁOKI, NIE STRONY ===================== */

describe("stopka podglądu pochodzi ze strony GŁÓWNEJ", () => {
  it("PODSTRONA: rysuje stopkę strony głównej i NIE rysuje własnej", async () => {
    state.slug = "kontakt";
    state.sections = [
      HERO_PODSTRONY,
      wiersz(
        "bbbbbbbb-2222-4222-8222-222222222222",
        "footer",
        1,
        stopkaPlotno(NAZWA_W_STOPCE_PODSTRONY),
      ),
    ];
    state.homeSections = [
      wiersz(
        "cccccccc-3333-4333-8333-333333333333",
        "footer",
        9,
        stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ),
      ),
    ];
    const container = await renderPreview();

    expect(container.textContent, "podgląd nie pokazuje stopki, którą zobaczy klient").toContain(
      NAZWA_W_STOPCE_GLOWNEJ,
    );
    expect(
      container.textContent,
      "podgląd pokazuje stopkę podstrony, której sklep NIGDY nie wyrenderuje",
    ).not.toContain(NAZWA_W_STOPCE_PODSTRONY);
    // Jedna stopka, jeden landmark `contentinfo` — jak w sklepie.
    expect(container.querySelectorAll("footer")).toHaveLength(1);
  });

  it("PODSTRONA ze stopką: pasek mówi wprost, że ta praca nie dociera do sklepu", async () => {
    state.slug = "kontakt";
    state.sections = [
      HERO_PODSTRONY,
      wiersz(
        "bbbbbbbb-2222-4222-8222-222222222222",
        "footer",
        1,
        stopkaPlotno(NAZWA_W_STOPCE_PODSTRONY),
      ),
    ];
    const container = await renderPreview();
    const komunikat = container.querySelector("[data-preview-footer-shadowed]");
    expect(komunikat, "podgląd milczy o stopce, która nigdzie nie trafia").not.toBeNull();
    expect(komunikat!.textContent).toBe(panelPl.site.preview.footerShadowed);
  });

  it("PODSTRONA bez własnej stopki nie dostaje komunikatu (kontrola negatywna)", async () => {
    state.slug = "kontakt";
    state.sections = [HERO_PODSTRONY];
    state.homeSections = [
      wiersz(
        "cccccccc-3333-4333-8333-333333333333",
        "footer",
        9,
        stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ),
      ),
    ];
    const container = await renderPreview();
    expect(container.querySelector("[data-preview-footer-shadowed]")).toBeNull();
    expect(container.textContent).toContain(NAZWA_W_STOPCE_GLOWNEJ);
  });

  it("STRONA GŁÓWNA: stopka jest jej własna i nie ma o czym ostrzegać", async () => {
    state.slug = "";
    state.sections = [
      HERO_PODSTRONY,
      wiersz(
        "bbbbbbbb-2222-4222-8222-222222222222",
        "footer",
        1,
        stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ),
      ),
    ];
    const container = await renderPreview();
    expect(container.textContent).toContain(NAZWA_W_STOPCE_GLOWNEJ);
    expect(container.querySelector("[data-preview-footer-shadowed]")).toBeNull();
    expect(container.querySelectorAll("footer")).toHaveLength(1);
  });

  it("BEZ STRONY GŁÓWNEJ podgląd podstrony nie ma stopki — i nie jest awarią", async () => {
    state.slug = "kontakt";
    state.homeExists = false;
    state.sections = [HERO_PODSTRONY];
    const container = await renderPreview();
    expect(container.textContent).toContain("Zadzwoń albo napisz");
    expect(container.querySelectorAll("footer")).toHaveLength(0);
  });

  it("stopka POWŁOKI stoi POZA `<main>` — landmark treści jej nie połyka", async () => {
    state.slug = "";
    state.sections = [
      HERO_PODSTRONY,
      wiersz(
        "bbbbbbbb-2222-4222-8222-222222222222",
        "footer",
        1,
        stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ),
      ),
    ];
    const container = await renderPreview();
    const main = container.querySelector("main");
    expect(main, "render bez `<main>` — asercja byłaby po pustym zbiorze").not.toBeNull();
    expect(main!.querySelector("footer")).toBeNull();
    expect(main!.textContent).not.toContain(NAZWA_W_STOPCE_GLOWNEJ);
  });
});

/* ===================== OBRAZ W STOPCE: ADRES, NIE KAFEL ===================== */

describe("obraz w stopce podglądu dostaje prawdziwy adres", () => {
  it("element obrazu ma `src` z bucketa, a nie kafel zastępczy", async () => {
    state.slug = "";
    state.sections = [
      HERO_PODSTRONY,
      wiersz(
        "bbbbbbbb-2222-4222-8222-222222222222",
        "footer",
        1,
        stopkaPlotno(NAZWA_W_STOPCE_GLOWNEJ, "z-obrazem"),
      ),
    ];
    const container = await renderPreview();
    const stopka = container.querySelector("footer")!;
    const obraz = stopka.querySelector<HTMLImageElement>(`img[src$="stopka.png"]`);
    expect(obraz, "obraz w stopce spadł na kafel zastępczy — brak prefiksu zdjęć").not.toBeNull();
    expect(obraz!.getAttribute("src")).toBe(`${BAZA_ZDJEC}/${SCIEZKA_OBRAZU}`);
    expect(stopka.querySelector(".site-placeholder")).toBeNull();
  });
});

/* ============================ KONTRAKT LUSTRA ============================ */

describe("napis koszyka w panelu jest LUSTREM sklepu", () => {
  it("PL: site.shell.cart ≡ storefront.nav.cart", () => {
    expect((panelPl.site as Record<string, { cart: string }>).shell.cart).toBe(
      storefrontPl.storefront.nav.cart,
    );
  });

  it("EN: site.shell.cart ≡ storefront.nav.cart", () => {
    expect((panelEn.site as Record<string, { cart: string }>).shell.cart).toBe(
      storefrontEn.storefront.nav.cart,
    );
  });
});
