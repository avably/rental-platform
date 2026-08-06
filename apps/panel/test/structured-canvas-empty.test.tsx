import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PUSTY STAN SEKCJI NA PŁÓTNIE (E8) — kontrakt drogą operatora.
 *
 * ==================== CO TU JEST DOWODZONE ====================
 *
 *   1. sekcja, która nie odda do dokumentu ANI JEDNEGO wpisu, dostaje na
 *      płótnie czytelny stan z DUŻYM przyciskiem — a nie dziurę;
 *   2. przycisk otwiera szufladę OD RAZU na liście wpisów (i18n nazywa tę
 *      zakładkę per typ: „Sprzęt”, „Zarządzaj zdjęciami” — kontrakt patrzy na
 *      to, co jest WYBRANE, a nie na napis);
 *   3. pustka, której w szufladzie naprawić NIE MOŻNA (sekcja sprzętu ze
 *      źródłem „katalog” przy pustym katalogu), NIE dostaje przycisku —
 *      dostaje zdanie mówiące, gdzie iść;
 *   4. warstwa jest WYŁĄCZNIE edycyjna: ten sam render z tą samą treścią,
 *      wywołany tak, jak woła go sklep, nie ma ani przycisku, ani zdania;
 *   5. sekcja, która MA co pokazać, pustego stanu nie dostaje (kontrola
 *      negatywna — bez niej wszystkie asercje wyżej spełniałby też blok
 *      wiszący pod każdą sekcją).
 *
 * Kontrolki znajdujemy PO ROLI I NAZWIE, klikamy `userEvent`-em, a mierzymy
 * SKUTEK (co jest zaznaczone w szufladzie), nie stan wewnętrzny komponentu.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const STYL = DEFAULT_SITE_STYLE;
const MONEY = { currency: "PLN", locale: "pl" } as const;
const SITE_ID = "99999999-9999-4999-8999-999999999999";
const PRODUCTS_ID = "dddddddd-4444-4444-8444-444444444444";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const puste = plMessages.site.structured.products.canvasEmpty;

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

const actions = vi.hoisted(() => ({
  upsertSection: vi.fn(),
  reorderSections: vi.fn(),
  toggleSection: vi.fn(),
  duplicateSection: vi.fn(),
  deleteSection: vi.fn(),
  restoreSection: vi.fn(),
  updateSiteStyle: vi.fn(),
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
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { StructuredSectionForm } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/structured-section-form"
);
const { SiteRenderer } = await import("@avably/ui");
const { presetContentFor, sectionCanvasFrom, structuredPresetFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Product = Parameters<typeof SiteBuilder>[0]["products"][number];

function produkt(id: string, name: string): Product {
  return { id, name, description: null, priceLabel: "od 120,00 zł / doba", imageUrl: null, imageAlt: "" };
}

/** Sekcja sprzętu w podanym stanie źródła i wskazań. */
function productsSection(overrides: Record<string, unknown>): Section {
  return {
    id: PRODUCTS_ID,
    type: "products",
    position: 1,
    enabled: true,
    content: { ...(structuredPresetFor("products", "pl") as unknown as Record<string, unknown>), ...overrides },
  } as Section;
}

function heroSection(): Section {
  return {
    id: HERO_ID,
    type: "hero",
    position: 0,
    enabled: true,
    content: sectionCanvasFrom("hero", presetContentFor("hero", "pl")),
  } as Section;
}

function renderBuilder(sections: Section[], products: Product[] = []) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={sections}
        products={products}
        money={MONEY}
      />
    </NextIntlClientProvider>,
  );
}

/** Ten sam render, wywołany TAK, JAK WOŁA GO SKLEP — bez ani jednej owijki edycyjnej. */
function renderSklep(section: Section, products: Product[] = []) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteRenderer
        sections={[{ id: section.id, position: section.position, type: section.type, content: section.content }] as never}
        style={STYL}
        products={products}
        money={MONEY}
      />
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("sekcja bez wpisów mówi, co zrobić", () => {
  it("wskazania puste → stan pusty z DUŻYM przyciskiem, znaleziony po nazwie", () => {
    renderBuilder([heroSection(), productsSection({ source: "picked", items: [] })]);

    expect(screen.getByText(puste.title), "płótno zostawiło dziurę zamiast stanu pustego").toBeTruthy();
    expect(screen.getByRole("button", { name: puste.action })).toBeTruthy();
  });

  it("sekcja, która MA co pokazać, stanu pustego NIE dostaje", () => {
    // Kontrola negatywna: bez niej „stan pusty jest” spełniałby też blok
    // doklejony do KAŻDEJ sekcji sprzętu, niezależnie od jej treści.
    renderBuilder(
      [heroSection(), productsSection({ source: "picked", items: [{ productId: "p-1" }] })],
      [produkt("p-1", "Namiot 6×12")],
    );

    expect(screen.queryByText(puste.title)).toBeNull();
    expect(screen.queryByRole("button", { name: puste.action })).toBeNull();
  });

  it("wskazania na pozycje, których w katalogu NIE MA → to też jest pustka", () => {
    // Wskazanie osierocone wypada z renderu (`visibleProductsFor`), więc sekcja
    // z trzema wpisami potrafi nie pokazać nic. Gdyby płótno pytało o długość
    // listy zamiast o to, co sekcja odda do dokumentu, ten przypadek byłby
    // dziurą bez ani jednego słowa wyjaśnienia.
    renderBuilder(
      [heroSection(), productsSection({ source: "picked", items: [{ productId: "znikneło" }] })],
      [produkt("p-1", "Namiot 6×12")],
    );

    expect(screen.getByText(puste.title)).toBeTruthy();
  });
});

describe("przycisk pustego stanu prowadzi TAM, GDZIE OBIECUJE", () => {
  it("otwiera szufladę na zakładce z WPISAMI, nie na wyglądzie", async () => {
    const user = userEvent.setup();
    renderBuilder([heroSection(), productsSection({ source: "picked", items: [] })]);

    await user.click(screen.getByRole("button", { name: puste.action }));

    const drawer = await screen.findByRole("dialog");
    const wybrana = within(drawer)
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(wybrana, "szuflada otworzyła się bez ani jednej wybranej zakładki").toBeTruthy();
    expect(
      wybrana!.textContent,
      "przycisk „dodaj pierwszy wpis” wylądował poza listą wpisów",
    ).toBe(plMessages.site.structured.products.tabs.items);
    // Skutek, a nie sam napis zakładki: pod nią stoi selektor pozycji katalogu.
    expect(within(drawer).getByLabelText(plMessages.site.structured.products.pick.label)).toBeTruthy();
  });

  it("KONTROLA NEGATYWNA: wskazanie zakładki naprawdę działa w obie strony", () => {
    /*
     * Bez tego asercja wyżej byłaby pusta: `items` jest wartością DOMYŚLNĄ, więc
     * „otworzyło się na wpisach” przechodziłoby również wtedy, gdyby parametr
     * był martwy. Tu wołamy mini-CMS wprost z drugą wartością i sprawdzamy, że
     * szuflada naprawdę potrafi zacząć gdzie indziej.
     */
    render(
      <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
        <StructuredSectionForm
          siteId={SITE_ID}
          content={structuredPresetFor("products", "pl")}
          currency="PLN"
          initialTab="appearance"
          onChange={() => {}}
        />
      </NextIntlClientProvider>,
    );

    const wybrana = screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");
    expect(wybrana?.textContent).toBe(plMessages.site.structured.products.tabs.appearance);
  });
});

describe("pustka nienaprawialna w szufladzie nie obiecuje szuflady", () => {
  it("źródło „katalog” + pusty katalog → zdanie o module sprzętu, ZERO przycisku", () => {
    renderBuilder([heroSection(), productsSection({ source: "catalog", items: [] })], []);

    expect(screen.getByText(puste.elsewhere)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: puste.action }),
      "przycisk obiecuje naprawę w szufladzie, w której tej naprawy nie ma",
    ).toBeNull();
  });

  it("źródło „katalog” + niepusty katalog → sekcja pokazuje pozycje, bez stanu pustego", () => {
    renderBuilder([heroSection(), productsSection({ source: "catalog", items: [] })], [produkt("p-1", "Namiot 6×12")]);

    expect(screen.queryByText(puste.title)).toBeNull();
    expect(screen.queryByText(puste.elsewhere)).toBeNull();
  });
});

describe("stan pusty NIE wychodzi poza edytor", () => {
  it("ten sam render wywołany jak w sklepie nie niesie ani przycisku, ani zdania", () => {
    /*
     * Oś mutacyjna: przeniesienie stanu pustego do pakietu renderu (np. do
     * `ProductsEmpty`) postawiłoby go także na stronie klienta — a pusta sekcja
     * jest problemem OPERATORA, nie odwiedzającego. Porównujemy dwie jednostki
     * ze sobą: ta sama treść, ten sam komponent, dwa sposoby wywołania.
     */
    const pusta = productsSection({ source: "picked", items: [] });
    const { unmount } = renderSklep(pusta);

    expect(screen.queryByRole("button", { name: puste.action })).toBeNull();
    expect(screen.queryByText(puste.title)).toBeNull();
    expect(screen.queryByText(puste.elsewhere)).toBeNull();
    // Zdanie DLA ODWIEDZAJĄCEGO zostaje takie, jakie było przed E8.
    expect(screen.getByText("Katalog jest w przygotowaniu.")).toBeTruthy();

    unmount();
    renderBuilder([heroSection(), pusta]);
    expect(
      screen.getByRole("button", { name: puste.action }),
      "kontrola dodatnia: w edytorze przycisk MA być — inaczej asercje wyżej nic nie bronią",
    ).toBeTruthy();
  });
});
