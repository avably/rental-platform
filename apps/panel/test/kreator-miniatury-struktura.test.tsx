import { DEFAULT_SITE_STYLE, SECTION_TYPES } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * BRAMKA STRUKTURY MINIATUR KREATORA (M-A11Y-02, ADR-195):
 * ZERO INTERAKTYWNYCH POTOMKÓW W INTERAKTYWNYM PRZODKU.
 *
 * ===================== CO POSZŁO NIE TAK =====================
 *
 * Kafle miniatur (galeria szablonów, podglądy pickera sekcji) były
 * `<button>`, a w środku stał pełny render strony najemcy — z własnymi
 * przyciskami (powiększenie w galerii, akordeon FAQ, formularz kontaktu)
 * i odnośnikami (CTA hero). `<button>` w `<button>` to nie „nieładny HTML":
 * parser DOMYKA zewnętrzny przycisk przy pierwszym wewnętrznym (reguła
 * „button in button scope"), więc DOM po sparsowaniu SSR różni się od drzewa
 * Reacta i hydracja pada twardo („Hydration failed…"), a cały ekran renderuje
 * się drugi raz u klienta. Pomiar na dev (2026-08-18): strumień SSR niósł
 * 6 przycisków powiększenia WEWNĄTRZ kafla `construction-tools`, DOM po
 * sparsowaniu — zero, bo parser wyrzucił je POZA kafel.
 *
 * ===================== CZEGO PILNUJE TEN PLIK =====================
 *
 *   • ŻADEN element interaktywny nie ma interaktywnego PRZODKA — na całym
 *     ekranie kreatora z otwartą galerią i w pickerze na KAŻDYM typie sekcji
 *     (to picker renderuje formularz kontaktu i akordeon FAQ, czyli
 *     najgęstsze interaktywnie podglądy);
 *   • miniatura jest MARTWA w całości (`inert`): poza wskaźnikiem,
 *     tab-orderem i drzewem dostępności — a w środku NAPRAWDĘ jest treść
 *     interaktywna (kontrola po pustym zbiorze: bramka, która niczego nie
 *     liczy, broni niczego);
 *   • kaflem klika się z klawiatury Z DEFINICJI: jedyna kontrolka kafla to
 *     natywny `<button>` z dostępną nazwą (Enter/Spacja za darmo).
 *
 * Interaktywność mierzymy listą selektorów, nie `getByRole`: aria-hidden
 * zdejmuje elementy z drzewa ról, a dokładnie te „ukryte, ale żywe" elementy
 * były wadą (fokus wchodził w treść schowaną przed czytnikiem).
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  if (!document.elementsFromPoint) {
    (document as Document & { elementsFromPoint: () => Element[] }).elementsFromPoint = () => [];
  }
});

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
vi.mock("@/lib/actions/site-images", () => ({
  photoSearchAvailable: vi.fn(async () => false),
  searchPhotos: vi.fn(async () => ({ ok: true, photos: [] })),
  confirmPhotoChoice: vi.fn(async () => {}),
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");
const { sectionCanvasFrom, presetContentFor } = await import("@avably/core/site");

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];
type Produkty = Parameters<typeof SiteBuilder>[0]["products"];

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";

/**
 * Katalog jak z trasy (`previewProductsFor`) — podgląd sekcji sprzętu ma
 * rysować PRAWDZIWE kafle z odnośnikami, bo dokładnie takie odnośniki były
 * częścią wady. Pusty katalog uczyniłby ten podgląd pusty, a bramkę — ślepą.
 */
const PRODUKTY: Produkty = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Terminal satelitarny",
    description: "Opis z katalogu",
    priceLabel: "od 120,00 zł / doba",
    imageUrl: null,
    imageAlt: "Terminal satelitarny",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Zestaw zasilania",
    description: "Zasilanie w terenie",
    priceLabel: "od 60,00 zł / doba",
    imageUrl: null,
    imageAlt: "Zestaw zasilania",
  },
] as Produkty;

/**
 * ELEMENTY INTERAKTYWNE wprost z treści HTML (interactive content) plus role
 * i `tabindex`, którymi interaktywność nadaje się ręcznie. `details`/`summary`
 * są na liście, bo sekcja FAQ v1 na nich stoi.
 */
const INTERAKTYWNE =
  'a[href], button, input, select, textarea, details, summary, iframe, audio[controls], video[controls], [contenteditable="true"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="switch"], [role="slider"]';

/** Interaktywne elementy, które MAJĄ interaktywnego przodka — ma być pusto. */
function zagniezdzone(root: ParentNode): string[] {
  return [...root.querySelectorAll<HTMLElement>(INTERAKTYWNE)]
    .filter((el) => el.parentElement?.closest(INTERAKTYWNE))
    .map((el) => {
      const przodek = el.parentElement!.closest<HTMLElement>(INTERAKTYWNE)!;
      const opisz = (node: HTMLElement) =>
        node.tagName.toLowerCase() +
        [...node.attributes]
          .filter((a) => a.name.startsWith("data-") || a.name === "role")
          .map((a) => `[${a.name}="${a.value}"]`)
          .join("");
      return `${opisz(el)} wewnątrz ${opisz(przodek)}`;
    });
}

function sekcja(id: string, type: "hero", position: number): Section {
  return {
    id,
    type,
    position,
    enabled: true,
    content: sectionCanvasFrom(type, presetContentFor(type, "pl")),
  } as Section;
}

function renderBuilder(sections: Section[]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={DEFAULT_SITE_STYLE}
        sections={sections}
        products={PRODUKTY}
        money={{ currency: "PLN", locale: "pl" }}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: HERO_ID });
  actions.applyStarterTemplate.mockResolvedValue({ ok: true, sectionIds: [] });
});

afterEach(cleanup);

describe("galeria szablonów: ekran kreatora bez zagnieżdżonej interaktywności", () => {
  it("CAŁY ekran z otwartą galerią: zero interaktywnych potomków w interaktywnych przodkach", () => {
    // Strona bez sekcji otwiera galerię z automatu — dokładnie ten render
    // szedł w SSR i wywracał hydrację.
    renderBuilder([]);
    // Dialogi i warstwy Radix portalują do <body>; mierzymy CAŁY dokument,
    // żeby portal nie schował zagnieżdżenia przed bramką.
    expect(zagniezdzone(document.body), "interaktywny element w interaktywnym przodku").toEqual([]);
  });

  it("kontrola po pustym zbiorze: miniatury NAPRAWDĘ niosą treść interaktywną — w pudełku inert", () => {
    const { container } = renderBuilder([]);

    const miniatury = [...container.querySelectorAll<HTMLElement>("[data-starter-miniatura]")];
    const kafle = container.querySelectorAll("[data-starter-template]");
    expect(kafle.length, "galeria bez kafli szablonów").toBeGreaterThan(0);
    expect(miniatury.length, "kafel szablonu bez pudełka miniatury").toBe(kafle.length);

    let interaktywnychWewnatrz = 0;
    for (const miniatura of miniatury) {
      // Martwota jest STRUKTURALNA: jeden atrybut `inert` zdejmuje wskaźnik,
      // fokus i drzewo dostępności z CAŁEGO poddrzewa miniatury.
      expect(miniatura.hasAttribute("inert"), "miniatura bez inert — żywa treść w kaflu").toBe(true);
      expect(miniatura.closest(INTERAKTYWNE), "miniatura ma interaktywnego przodka").toBeNull();
      interaktywnychWewnatrz += miniatura.querySelectorAll(INTERAKTYWNE).length;
    }
    expect(
      interaktywnychWewnatrz,
      "miniatury bez ani jednego elementu interaktywnego — bramka nie ma czego bronić",
    ).toBeGreaterThan(0);
  });

  it("kafel klika się z klawiatury Z DEFINICJI: natywny <button> z dostępną nazwą", () => {
    const { container } = renderBuilder([]);
    for (const kafel of container.querySelectorAll<HTMLElement>("[data-starter-template], [data-starter-empty]")) {
      expect(kafel.tagName, "kontrolka kafla nie jest natywnym przyciskiem").toBe("BUTTON");
      const nazwa = (kafel.getAttribute("aria-label") ?? kafel.textContent ?? "").trim();
      expect(nazwa.length, "kafel bez dostępnej nazwy").toBeGreaterThan(0);
    }
    // Geometria pseudo-elementu jest poza zasięgiem jsdom, więc pilnujemy
    // DEKLARACJI strefy kliku, a zachowanie kryje przebieg przeglądarkowy
    // (ADR-195). Dotyczy kafli z miniaturą — pusty kafel jest przyciskiem
    // w całości i nakładki nie potrzebuje.
    for (const kafel of container.querySelectorAll<HTMLElement>("[data-starter-template]")) {
      expect(
        kafel.className,
        "przycisk kafla bez nakładki after:absolute — klik skurczy się do paska podpisu",
      ).toContain("after:absolute");
      expect(
        kafel.className,
        "przycisk kafla bez after:inset-0 — nakładka nie pokrywa kafla",
      ).toContain("after:inset-0");
    }
    // Nazwa kafla to nazwa strony-szablonu, nie techniczny identyfikator.
    const pierwszy = container.querySelector<HTMLElement>("[data-starter-template]")!;
    const nazwy = Object.values(plMessages.site.starter.names) as string[];
    expect(
      nazwy.some((n) => (pierwszy.textContent ?? "").includes(n)),
      "treść kafla nie zawiera nazwy szablonu ze słownika",
    ).toBe(true);
  });

  it("klik w kafel dalej wybiera szablon (strefa kliku po restrukturyzacji)", async () => {
    const { container } = renderBuilder([]);
    fireEvent.click(container.querySelector<HTMLElement>("[data-starter-template]")!);
    await vi.waitFor(() => expect(actions.applyStarterTemplate).toHaveBeenCalledTimes(1));
  });
});

describe("picker sekcji: podglądy każdego typu bez zagnieżdżonej interaktywności", () => {
  it("KAŻDY typ z rejestru: zero interaktywnych potomków w interaktywnych przodkach", () => {
    /*
     * Chodzimy po KOMPLECIE typów, bo gęstość interaktywna podglądów skrajnie
     * się różni: hero ma jeden odnośnik CTA, galeria — przycisk powiększenia
     * na każdym kaflu, kontakt — cały formularz. Bramka na jednym typie
     * przepuściłaby regres w pozostałych.
     */
    const { container } = renderBuilder([sekcja(HERO_ID, "hero", 0)]);
    fireEvent.click(container.querySelector<HTMLElement>('[data-insert-at="0"]')!);
    const dialog = document.querySelector<HTMLElement>("[data-section-picker]")!;
    expect(dialog, "picker się nie otworzył").not.toBeNull();

    let interaktywnychWPodgladach = 0;
    for (const typ of SECTION_TYPES) {
      fireEvent.click(dialog.querySelector<HTMLElement>(`[data-picker-type="${typ}"]`)!);
      const kafle = [...dialog.querySelectorAll<HTMLElement>("[data-picker-tile]")];
      expect(kafle.length, `typ ${typ} bez ani jednego podglądu`).toBeGreaterThan(0);

      expect(
        zagniezdzone(document.body),
        `typ ${typ}: interaktywny element w interaktywnym przodku`,
      ).toEqual([]);

      for (const kafel of kafle) {
        const miniatura = kafel.querySelector<HTMLElement>("span[inert]");
        expect(miniatura, `typ ${typ}: podgląd bez pudełka inert`).not.toBeNull();
        interaktywnychWPodgladach += miniatura!.querySelectorAll(INTERAKTYWNE).length;

        const przycisk = kafel.querySelector<HTMLElement>("[data-picker-add]");
        expect(przycisk?.tagName, `typ ${typ}: kontrolka wstawienia nie jest przyciskiem`).toBe("BUTTON");
        expect(
          (przycisk?.getAttribute("aria-label") ?? "").trim().length,
          `typ ${typ}: przycisk wstawienia bez dostępnej nazwy`,
        ).toBeGreaterThan(0);
        // Geometria pseudo-elementu jest poza zasięgiem jsdom, więc pilnujemy
        // DEKLARACJI strefy kliku, a zachowanie kryje przebieg przeglądarkowy
        // (ADR-195).
        expect(
          przycisk?.className ?? "",
          `typ ${typ}: przycisk bez nakładki after:absolute — klik skurczy się do paska akcji`,
        ).toContain("after:absolute");
        expect(
          przycisk?.className ?? "",
          `typ ${typ}: przycisk bez after:inset-0 — nakładka nie pokrywa kafla`,
        ).toContain("after:inset-0");
      }
    }
    expect(
      interaktywnychWPodgladach,
      "podglądy bez ani jednego elementu interaktywnego — bramka nie ma czego bronić",
    ).toBeGreaterThan(0);
  });
});
