// @vitest-environment jsdom

/**
 * WŁASNA STRONA WYBRANEGO PRODUKTU — POWIERZCHNIE PANELU (faza B, ADR-200).
 *
 * Cztery powierzchnie, każda z własnym sposobem zepsucia:
 *
 *   1. LICZNIK „użyto X z 5" liczy PRODUKTY z własną stroną (jak trigger
 *      limitu w bazie: count distinct), nie wiersze i nie wszystkie strony —
 *      licznik liczący cokolwiek innego rozjeżdża się z odmową bazy.
 *   2. ODZNAKA „własna strona sprzętu" stoi WYŁĄCZNIE przy wierszu
 *      z `productId` — matka i strony treściowe jej nie dostają.
 *   3. FORK i „PRZYWRÓĆ DOMYŚLNY" wołają akcje z właściwymi argumentami,
 *      a okna potwierdzeń mówią o zasięgu prawdę (wyjątek ≠ matka).
 *   4. PRZEŁĄCZNIK PODGLĄDU w kreatorze: na matce zmienia rekord płótna
 *      (sam podgląd, zero zapisu), na wyjątku podgląd jest PRZYPIĘTY.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SITE_STYLE } from "@avably/core/site";

import plMessages from "../messages/pl.json";

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
  createSite: vi.fn(async () => ({ ok: true, siteId: "nowa" })),
  deleteSite: vi.fn(async () => ({ ok: true })),
  publishSite: vi.fn(async () => ({ ok: true })),
  renameSite: vi.fn(async () => ({ ok: true })),
  unpublishSite: vi.fn(async () => ({ ok: true })),
  upsertSection: vi.fn(async () => ({ ok: true })),
  reorderSections: vi.fn(async () => ({ ok: true })),
  toggleSection: vi.fn(async () => ({ ok: true })),
  duplicateSection: vi.fn(async () => ({ ok: true })),
  deleteSection: vi.fn(async () => ({ ok: true })),
  restoreSection: vi.fn(async () => ({ ok: true })),
  updateStoreStyle: vi.fn(async () => ({ ok: true })),
  applyStarterTemplate: vi.fn(async () => ({ ok: true })),
}));
const exceptionActions = vi.hoisted(() => ({
  forkProductPage: vi.fn(async () => ({ ok: true, siteId: "fork" })),
  restoreDefaultProductPage: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/lib/actions/site", () => actions);
vi.mock("@/lib/actions/site-product-exception", () => exceptionActions);
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SitePages } = await import("@/app/[locale]/(panel)/strona/site-pages");
const { SiteBuilder } = await import(
  "@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder"
);
const { countProductExceptions, isProductExceptionLimitError, MAX_PRODUCT_EXCEPTIONS } =
  await import("@/lib/site-validation");

const pages = plMessages.site.pages;
const builder = plMessages.site.builder;

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";

type Row = Parameters<typeof SitePages>[0]["rows"][number];

const STRONA_GLOWNA: Row = {
  id: "site-home",
  name: "Strona główna",
  live: true,
  kind: "page",
  slug: "",
  slugPublished: "",
  redirectOldSlug: true,
  redirectedFrom: [],
  productId: null,
  productName: null,
  publishedAtLabel: "14.08.2026, 08:00",
  createdAtLabel: "01.08.2026, 08:00",
};

const MATKA: Row = {
  id: "site-mother",
  name: "Strona sprzętu",
  live: false,
  kind: "product",
  slug: "",
  slugPublished: null,
  redirectOldSlug: true,
  redirectedFrom: [],
  productId: null,
  productName: null,
  publishedAtLabel: null,
  createdAtLabel: "02.08.2026, 08:00",
};

const WYJATEK: Row = {
  ...MATKA,
  id: "site-exception",
  name: "Terminal satelitarny",
  productId: P1,
  productName: "Terminal satelitarny",
  createdAtLabel: "03.08.2026, 08:00",
};

const WYJATEK_ZYWY: Row = {
  ...WYJATEK,
  id: "site-exception-live",
  live: true,
  slugPublished: "",
  publishedAtLabel: "15.08.2026, 09:00",
};

function renderujListe(
  rows: Row[],
  forkProducts: { id: string; name: string }[] | null = null,
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SitePages rows={rows} forkProducts={forkProducts} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  exceptionActions.forkProductPage.mockClear();
  exceptionActions.restoreDefaultProductPage.mockClear();
});

// -----------------------------------------------------------------------
// 0. Definicje wspólne z bazą — czyste funkcje
// -----------------------------------------------------------------------
describe("licznik i dopasowanie odmowy limitu — definicje", () => {
  it("licznik liczy PRODUKTY (distinct), nie wiersze — jak trigger w bazie", () => {
    expect(
      countProductExceptions([
        { productId: P1 },
        { productId: P1 }, // drugi szkic tego samego produktu — limitu nie zjada
        { productId: P2 },
        { productId: null }, // matka
        {}, // strona treściowa sprzed pola
      ]),
    ).toBe(2);
    expect(countProductExceptions([])).toBe(0);
  });

  it("odmowę limitu rozpoznaje KOD PT409 albo hint-token — nigdy treść zdania", () => {
    expect(isProductExceptionLimitError({ code: "PT409", hint: null })).toBe(true);
    expect(
      isProductExceptionLimitError({ hint: "sites_product_exception_limit" }),
    ).toBe(true);
    expect(isProductExceptionLimitError({ code: "23505", hint: null })).toBe(false);
    expect(isProductExceptionLimitError({})).toBe(false);
  });
});

// -----------------------------------------------------------------------
// 1. Licznik „użyto X z 5"
// -----------------------------------------------------------------------
describe("licznik własnych stron sprzętu na liście stron", () => {
  it("liczy produkty z wyjątkiem, nie wszystkie strony", () => {
    // 4 wiersze `sites`, ale wyjątki dotyczą DWÓCH produktów (P1 ma dwa
    // szkice) — licznik liczący wiersze albo wszystkie strony świeci inaczej.
    const drugiSzkicP1: Row = { ...WYJATEK, id: "site-exception-2" };
    const { container } = renderujListe(
      [STRONA_GLOWNA, MATKA, WYJATEK, drugiSzkicP1, { ...WYJATEK, id: "e-p2", productId: P2, productName: "Zestaw zasilania" }],
    );
    const licznik = container.querySelector("[data-site-exceptions-counter]");
    expect(licznik).not.toBeNull();
    expect(licznik!.textContent).toBe(
      pages.exceptionsCounter
        .replace("{used}", "2")
        .replace("{max}", String(MAX_PRODUCT_EXCEPTIONS)),
    );
  });

  it("bez matki i bez wyjątków bloku NIE MA; z wyjątkami bez matki licznik ZOSTAJE", () => {
    const bez = renderujListe([STRONA_GLOWNA]);
    expect(bez.container.querySelector("[data-site-exceptions]")).toBeNull();
    cleanup();

    // Matka usunięta, wyjątek został (stan osiągalny: matkę nieżywą wolno
    // usunąć) — licznik dalej pilnuje, choć forkować nie ma z czego.
    const sierota = renderujListe([STRONA_GLOWNA, WYJATEK]);
    expect(sierota.container.querySelector("[data-site-exceptions-counter]")).not.toBeNull();
    expect(sierota.container.querySelector("[data-new-product-exception]")).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 2. Odznaka „własna strona sprzętu"
// -----------------------------------------------------------------------
describe("odznaka wyjątku na liście stron", () => {
  it("stoi WYŁĄCZNIE przy wierszu z productId i wymienia sprzęt z nazwy", () => {
    const { container } = renderujListe([STRONA_GLOWNA, MATKA, WYJATEK]);

    const wierszWyjatku = container.querySelector(`[data-site-page="${WYJATEK.id}"]`)!;
    const odznaka = wierszWyjatku.querySelector("[data-site-page-exception]");
    expect(odznaka).not.toBeNull();
    expect(odznaka!.textContent).toContain(pages.exceptionBadge);
    expect(odznaka!.textContent).toContain("Terminal satelitarny");

    // MATKA: odznaka szablonu, NIGDY odznaka wyjątku — mutant „odznaka przy
    // każdej roli product" pali się tutaj.
    const wierszMatki = container.querySelector(`[data-site-page="${MATKA.id}"]`)!;
    expect(wierszMatki.querySelector("[data-site-page-exception]")).toBeNull();
    expect(wierszMatki.querySelector("[data-site-page-template]")).not.toBeNull();

    // Strona treściowa: żadnej z dwóch.
    const wierszHome = container.querySelector(`[data-site-page="${STRONA_GLOWNA.id}"]`)!;
    expect(wierszHome.querySelector("[data-site-page-exception]")).toBeNull();
    expect(wierszHome.querySelector("[data-site-page-template]")).toBeNull();
  });

  it("bez nazwy sprzętu (nieudany odczyt) odznaka zostaje, podpis mówi tyle, ile wiadomo", () => {
    const { container } = renderujListe([{ ...WYJATEK, productName: null }]);
    const odznaka = container.querySelector("[data-site-page-exception]");
    expect(odznaka).not.toBeNull();
    expect(odznaka!.textContent).toContain(pages.exceptionAddressUnknown);
  });
});

// -----------------------------------------------------------------------
// 3. Fork z ekranu stron
// -----------------------------------------------------------------------
describe("okno „utwórz stronę sprzętu”", () => {
  it("oferuje wyłącznie sprzęt BEZ własnej strony i woła akcję ze wskazanym produktem", () => {
    const { container } = renderujListe(
      [STRONA_GLOWNA, MATKA, WYJATEK],
      [
        { id: P1, name: "Terminal satelitarny" }, // ma już wyjątek — odpada
        { id: P3, name: "Zestaw zasilania" },
      ],
    );

    fireEvent.click(container.querySelector("[data-new-product-exception]")!);
    const trigger = document.body.querySelector<HTMLElement>("[data-exception-product-select]");
    expect(trigger).not.toBeNull();

    // Bez wyboru przycisk stoi wyłączony — fork „na chybił trafił" nie istnieje.
    const confirm = document.body.querySelector<HTMLButtonElement>(
      "[data-new-product-exception-confirm]",
    )!;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(trigger!);
    const opcje = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    expect(opcje).not.toContain("Terminal satelitarny");
    expect(opcje).toContain("Zestaw zasilania");

    fireEvent.click(screen.getByRole("option", { name: "Zestaw zasilania" }));
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    expect(exceptionActions.forkProductPage).toHaveBeenCalledTimes(1);
    expect(exceptionActions.forkProductPage).toHaveBeenCalledWith({ productId: P3 });
  });

  it("bez matki przycisku forka nie ma; przy nieudanym odczycie katalogu też nie", () => {
    // forkProducts przyjechały, ale matki nie ma — fork nie ma czego kopiować.
    const bezMatki = renderujListe([STRONA_GLOWNA, WYJATEK], [{ id: P3, name: "Zestaw" }]);
    expect(bezMatki.container.querySelector("[data-new-product-exception]")).toBeNull();
    cleanup();

    // Matka jest, ale odczyt katalogu padł (null) — przycisk gaśnie, licznik stoi.
    const bezKatalogu = renderujListe([STRONA_GLOWNA, MATKA], null);
    expect(bezKatalogu.container.querySelector("[data-new-product-exception]")).toBeNull();
    expect(
      bezKatalogu.container.querySelector("[data-site-exceptions-counter]"),
    ).not.toBeNull();
  });

  it("pusta lista do wyboru dostaje własne zdanie zamiast pustego selecta", () => {
    const { container } = renderujListe([MATKA, WYJATEK], [
      { id: P1, name: "Terminal satelitarny" },
    ]);
    fireEvent.click(container.querySelector("[data-new-product-exception]")!);
    expect(document.body.querySelector("[data-exception-picker-empty]")).not.toBeNull();
    expect(document.body.querySelector("[data-exception-product-select]")).toBeNull();
  });
});

// -----------------------------------------------------------------------
// 4. „Przywróć szablon domyślny"
// -----------------------------------------------------------------------
describe("przywracanie szablonu domyślnego", () => {
  it("stoi na wierszu wyjątku (zamiast usuwania), woła akcję z id TEGO wiersza", () => {
    const { container } = renderujListe([STRONA_GLOWNA, MATKA, WYJATEK]);

    const wiersz = container.querySelector(`[data-site-page="${WYJATEK.id}"]`)!;
    expect(wiersz.querySelector("[data-delete-site]")).toBeNull();
    fireEvent.click(wiersz.querySelector("[data-restore-default]")!);

    // Wiersz ROBOCZY: zdanie mówi, że w sklepie nic się nie zmieni.
    const opis = document.body.querySelector("[data-restore-default-scope]");
    expect(opis?.getAttribute("data-restore-default-scope")).toBe("draft");

    fireEvent.click(document.body.querySelector("[data-restore-default-confirm]")!);
    expect(exceptionActions.restoreDefaultProductPage).toHaveBeenCalledTimes(1);
    expect(exceptionActions.restoreDefaultProductPage).toHaveBeenCalledWith(WYJATEK.id);
  });

  it("na wierszu ŻYWYM zdanie mówi o zniknięciu ze sklepu; matka przycisku nie ma", () => {
    const { container } = renderujListe([MATKA, WYJATEK_ZYWY]);

    const matka = container.querySelector(`[data-site-page="${MATKA.id}"]`)!;
    expect(matka.querySelector("[data-restore-default]")).toBeNull();

    const zywy = container.querySelector(`[data-site-page="${WYJATEK_ZYWY.id}"]`)!;
    // Żywego wyjątku nie broni już przycisk „widoczna w sklepie" — przywrócenie
    // samo zdejmuje go ze sklepu (akcja: unpublish + delete).
    expect(zywy.querySelector("[data-delete-site-blocked]")).toBeNull();
    fireEvent.click(zywy.querySelector("[data-restore-default]")!);
    const opis = document.body.querySelector("[data-restore-default-scope]");
    expect(opis?.getAttribute("data-restore-default-scope")).toBe("live");
  });
});

// -----------------------------------------------------------------------
// 5. Okna publikacji i zdjęcia mówią o zasięgu wyjątku prawdę
// -----------------------------------------------------------------------
describe("zasięg wyjątku w oknach potwierdzeń", () => {
  it("publikacja wyjątku: zdanie o JEDNYM sprzęcie, nie o każdym", () => {
    const { container } = renderujListe([MATKA, WYJATEK]);

    const wiersz = container.querySelector(`[data-site-page="${WYJATEK.id}"]`)!;
    fireEvent.click(wiersz.querySelector("[data-publish-site]")!);
    const opis = document.body.querySelector("[data-publish-template-scope]");
    expect(opis?.getAttribute("data-publish-template-scope")).toBe("exception");
    expect(opis?.textContent).toContain("Terminal satelitarny");
    expect(opis?.textContent).not.toBe(pages.switchBodyTemplateNew);
  });

  it("publikacja matki: zasięg „all” — zdanie o stronie każdego sprzętu", () => {
    const { container } = renderujListe([MATKA, WYJATEK]);
    const wiersz = container.querySelector(`[data-site-page="${MATKA.id}"]`)!;
    fireEvent.click(wiersz.querySelector("[data-publish-site]")!);
    const opis = document.body.querySelector("[data-publish-template-scope]");
    expect(opis?.getAttribute("data-publish-template-scope")).toBe("all");
  });

  it("zdjęcie ŻYWEGO wyjątku ze sklepu: zakres „exception” z nazwą sprzętu", () => {
    const { container } = renderujListe([MATKA, WYJATEK_ZYWY]);
    const wiersz = container.querySelector(`[data-site-page="${WYJATEK_ZYWY.id}"]`)!;
    fireEvent.click(wiersz.querySelector("[data-unpublish-site]")!);
    const opis = document.body.querySelector("[data-unpublish-scope]");
    expect(opis?.getAttribute("data-unpublish-scope")).toBe("exception");
    expect(opis?.textContent).toContain("Terminal satelitarny");
  });
});

// -----------------------------------------------------------------------
// 6. Przełącznik podglądu w kreatorze (B2)
// -----------------------------------------------------------------------
const LAYOUT = { desktop: { x: 0, y: 0, w: 48, h: 6, z: 0 } };
const KATALOG = [
  {
    id: P1,
    name: "Terminal satelitarny",
    description: "Opis 1",
    priceLabel: "od 120,00 zł / doba",
    imageUrl: null,
    imageAlt: "Terminal satelitarny",
  },
  {
    id: P2,
    name: "Zestaw zasilania",
    description: "Opis 2",
    priceLabel: "od 80,00 zł / doba",
    imageUrl: null,
    imageAlt: "Zestaw zasilania",
  },
];

/** Sekcja płótna v2 z nagłówkiem ZWIĄZANYM z pozycją strony — podgląd rysuje jej nazwę. */
const SEKCJA_Z_WIAZANIEM = {
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  type: "hero",
  position: 0,
  enabled: true,
  deletedInDraft: false,
  published: false,
  content: {
    version: 2,
    rows: 24,
    background: "default",
    elements: [
      {
        id: "napis",
        kind: "heading",
        text: "Napis statyczny",
        level: 2,
        align: "left",
        layout: LAYOUT,
        bindings: { text: { record: { kind: "pageProduct" }, field: "name", whenEmpty: "hide" } },
      },
    ],
  },
} as never;

type BuilderProps = Parameters<typeof SiteBuilder>[0];

function renderujKreator(props: Partial<BuilderProps> = {}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId="99999999-9999-4999-8999-999999999999"
        siteName="Strona sprzętu"
        style={DEFAULT_SITE_STYLE}
        sections={[SEKCJA_Z_WIAZANIEM] as BuilderProps["sections"]}
        products={KATALOG as BuilderProps["products"]}
        money={{ currency: "PLN", locale: "pl" }}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("podgląd na pozycji w pasku kreatora", () => {
  it("na MATCE przełącznik zmienia rekord płótna — sam podgląd, zero zapisu", () => {
    const { container } = renderujKreator({
      pageRecord: KATALOG[0] as BuilderProps["pageRecord"],
      pageRecordPinned: false,
      productTemplate: true,
    });

    const trigger = container.querySelector<HTMLElement>("[data-builder-record-select]");
    expect(trigger, "matka bez przełącznika podglądu").not.toBeNull();
    expect(container.querySelector("[data-builder-record-pinned]")).toBeNull();

    // Płótno rysuje nazwę pozycji DOMYŚLNEJ (pierwszej z katalogu)…
    const stage = container.querySelector<HTMLElement>("[data-builder-stage]")!;
    expect(within(stage).getByText("Terminal satelitarny")).toBeTruthy();

    // …a po przełączeniu — WYBRANEJ. To jest cały skutek kontrolki.
    fireEvent.click(trigger!);
    fireEvent.click(screen.getByRole("option", { name: "Zestaw zasilania" }));
    expect(within(stage).getByText("Zestaw zasilania")).toBeTruthy();
    expect(within(stage).queryByText("Terminal satelitarny")).toBeNull();
    // Zero zapisu: przełącznik nie woła ŻADNEJ akcji.
    expect(actions.upsertSection).not.toHaveBeenCalled();
    expect(actions.updateStoreStyle).not.toHaveBeenCalled();
  });

  it("na WYJĄTKU podgląd jest PRZYPIĘTY: zdanie z nazwą sprzętu, bez przełącznika", () => {
    const { container } = renderujKreator({
      pageRecord: KATALOG[1] as BuilderProps["pageRecord"],
      pageRecordPinned: true,
      productTemplate: true,
    });

    expect(container.querySelector("[data-builder-record-select]")).toBeNull();
    const pinned = container.querySelector("[data-builder-record-pinned]");
    expect(pinned).not.toBeNull();
    expect(pinned!.textContent).toBe(
      builder.recordPinned.replace("{name}", "Zestaw zasilania"),
    );

    const stage = container.querySelector<HTMLElement>("[data-builder-stage]")!;
    expect(within(stage).getByText("Zestaw zasilania")).toBeTruthy();
  });

  it("bez rekordu (strona treściowa / pusty katalog) kontrolki nie ma wcale", () => {
    const { container } = renderujKreator({ products: [] as BuilderProps["products"] });
    expect(container.querySelector("[data-builder-record-select]")).toBeNull();
    expect(container.querySelector("[data-builder-record-pinned]")).toBeNull();
  });

  it("okno publikacji wyjątku w KREATORZE mówi o zasięgu jednego sprzętu", () => {
    const { container } = renderujKreator({
      pageRecord: KATALOG[0] as BuilderProps["pageRecord"],
      pageRecordPinned: true,
      productTemplate: true,
    });
    fireEvent.click(container.querySelector("[data-builder-publish]")!);
    const opis = document.body.querySelector("[data-publish-template-scope]");
    expect(opis?.getAttribute("data-publish-template-scope")).toBe("exception");
    expect(opis?.textContent).toContain("Terminal satelitarny");
  });
});
