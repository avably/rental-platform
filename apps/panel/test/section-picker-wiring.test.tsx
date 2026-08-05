import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * OKABLOWANIE PICKERA — DROGĄ OPERATORA, NIE DROGĄ TESTU (delta recenzji PM
 * do PR #180).
 *
 * ===================== CO ZNALAZŁ PM =====================
 *
 * Na zbudowanym panelu wstawienie sekcji „nie zapisywało się”: klik w typ nie
 * wysyłał ŻADNEGO żądania, a po prawej pojawiał się gotowy render sekcji —
 * czyli coś, co wygląda jak sekcja dodana do strony. Repro na żywej bazie
 * potwierdziło zgłoszenie co do faktu (zero POST-ów, zero wierszy), a jego
 * przyczyna nie jest zerwanym przewodem: <b>klik w typ nigdy nie miał
 * wstawiać</b>. Wstawia dopiero klik w podgląd po prawej — i nic tego nie
 * mówiło, a lewa kolumna wyglądała jak kafle STAREJ galerii, w której
 * kliknięcie typu dodawało sekcję.
 *
 * ===================== DLACZEGO NIE ZŁAPAŁY TEGO KONTRAKTY =====================
 *
 * Testy E2 klikały `[data-picker-add]` — czyli element znaleziony po znaczniku,
 * którego operator nie widzi. Taki test przechodzi także wtedy, gdy jedyna
 * droga wstawienia jest niewidoczna, nieopisana albo nieodróżnialna od wyboru.
 *
 * ===================== CZEGO PILNUJE TEN PLIK =====================
 *
 * Kontrakty niżej szukają kontrolek TAK, JAK ZNAJDUJE JE OPERATOR: po
 * DOSTĘPNEJ NAZWIE i roli, nigdy po `data-*`. Klikają `userEvent`-em (pełna
 * sekwencja wskaźnika), a mierzą WYWOŁANIE AKCJI SERWEROWEJ (mock modułu
 * akcji) — nie stan optymistyczny, nie DOM.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import plMessages from "../messages/pl.json";

const STYL = DEFAULT_SITE_STYLE;

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
  updateSiteStyle: vi.fn(),
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

const SITE_ID = "99999999-9999-4999-8999-999999999999";
const HERO_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const CTA_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const NOWA_ID = "dddddddd-4444-4444-8444-444444444444";

const picker = plMessages.site.sectionPicker;
const typy = plMessages.site.sectionTypes;

function sekcja(id: string, type: "hero" | "cta", position: number): Section {
  return {
    id,
    type,
    position,
    enabled: true,
    content: sectionCanvasFrom(type, presetContentFor(type, "pl")),
  } as Section;
}

function renderBuilder(sections: Section[] = [sekcja(HERO_ID, "hero", 0), sekcja(CTA_ID, "cta", 1)]) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={sections} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

/**
 * Radix wiesza `pointer-events: none` na `body`, gdy okno jest modalne;
 * w jsdom dziedziczy to także zawartość okna, więc kontrola wskaźnika
 * `userEvent` odrzucałaby kliknięcia, które w przeglądarce dochodzą. Wyłączamy
 * WYŁĄCZNIE tę kontrolę — sekwencja zdarzeń (pointerdown → mouseup → click)
 * zostaje pełna.
 */
const uzytkownik = () => userEvent.setup({ pointerEventsCheck: 0 });

/** Wstawienia (bez `sectionId`) zgłoszone do akcji serwerowej. */
function wstawienia() {
  return actions.upsertSection.mock.calls
    .map(([arg]) => arg as { sectionId?: string; type: string; insertBefore?: string })
    .filter((arg) => !arg.sectionId);
}

beforeEach(() => {
  for (const action of Object.values(actions)) action.mockReset();
  actions.upsertSection.mockResolvedValue({ ok: true, sectionId: NOWA_ID });
  actions.reorderSections.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("droga operatora: „+” → typ → wstawienie", () => {
  it("KLIK W TYP niczego nie wysyła — i okno mówi wprost, co zrobić dalej", async () => {
    /*
     * Dokładnie ta interakcja, po której PM zgłosił „wstawienie nie zapisuje
     * się". Test utrwala OBIE połowy prawdy: klik w typ ma nie wstawiać (bo
     * wybór wariantu jest jeszcze przed operatorem) ORAZ ma zostawić widoczne
     * zdanie o tym, co dalej. Sam brak żądania jest wadą, gdy nic go nie
     * tłumaczy.
     */
    const user = uzytkownik();
    renderBuilder();
    await user.click(screen.getAllByRole("button", { name: plMessages.site.builder.addHere })[0]!);

    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.pricing }));

    expect(actions.upsertSection, "klik w typ wysłał zapis").not.toHaveBeenCalled();
    expect(
      within(okno).getByText(picker.chooseLayout.replace("{type}", typy.pricing)),
      "okno nie mówi, że wstawia dopiero kliknięcie w podgląd",
    ).toBeTruthy();
  });

  it("KLIK W KONTROLKĘ ZNALEZIONĄ PO NAZWIE woła akcję serwerową z kotwicą", async () => {
    // Kontrolki szukamy tak, jak operator: po nazwie zaczynającej się od
    // czasownika. Gdyby jedyną drogą wstawienia był element bez takiej nazwy,
    // ten test nie miałby czego kliknąć — i to jest cała jego wartość.
    const user = uzytkownik();
    renderBuilder();
    await user.click(screen.getAllByRole("button", { name: plMessages.site.builder.addHere })[1]!);

    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.usp }));
    await user.click(
      within(okno).getByRole("button", { name: picker.addAria.replace("{type}", typy.usp) }),
    );

    expect(actions.upsertSection, "kliknięcie w podgląd nie wysłało zapisu").toHaveBeenCalledTimes(1);
    expect(wstawienia()[0]).toMatchObject({ type: "usp", insertBefore: CTA_ID });
  });

  it("TA SAMA droga z palety — kontekst końca strony", async () => {
    const user = uzytkownik();
    renderBuilder();
    await user.click(screen.getByRole("button", { name: plMessages.site.sections.add }));

    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.delivery }));
    await user.click(
      within(okno).getByRole("button", { name: picker.addAria.replace("{type}", typy.delivery) }),
    );

    expect(actions.upsertSection).toHaveBeenCalledTimes(1);
    expect(wstawienia()[0]).toMatchObject({ type: "delivery" });
    expect(wstawienia()[0]!.insertBefore, "paleta wskazała kotwicę zamiast końca strony").toBeUndefined();
  });

  it("WARIANT UKŁADU ma własną kontrolkę, też nazwaną czasownikiem", async () => {
    const user = uzytkownik();
    renderBuilder();
    await user.click(screen.getAllByRole("button", { name: plMessages.site.builder.addHere })[0]!);

    const okno = await screen.findByRole("dialog");
    await user.click(within(okno).getByRole("radio", { name: typy.faq }));
    await user.click(
      within(okno).getByRole("button", {
        name: picker.addLayoutAria
          .replace("{type}", typy.faq)
          .replace("{layout}", plMessages.site.structured.faq.layouts["open-list"]),
      }),
    );

    expect(wstawienia()[0]).toMatchObject({ type: "faq" });
    expect((wstawienia()[0] as { content?: { layout?: string } }).content?.layout).toBe("open-list");
  });
});

describe("w oknie nie ma kontrolki TRZECIEGO rodzaju", () => {
  it("każdy klikalny albo WYBIERA typ, albo WSTAWIA — i mówi to swoją nazwą", async () => {
    /*
     * Noga kompletności: wada PM-a wzięła się stąd, że jeden rodzaj kontrolki
     * (wybór) wyglądał jak drugi (wstawienie). Test chodzi po KOMPLECIE
     * klikalnych okna i wymaga, żeby każdy dał się przypisać do jednej z dwóch
     * ról. Kontrolka bez nazwy albo z nazwą, która nic nie obiecuje, zapala go.
     */
    const user = uzytkownik();
    renderBuilder();
    await user.click(screen.getAllByRole("button", { name: plMessages.site.builder.addHere })[0]!);
    const okno = await screen.findByRole("dialog");

    const wybory = within(okno).getAllByRole("radio");
    expect(wybory.length, "lista typów przestała być wyborem").toBeGreaterThan(1);

    const przyciski = within(okno)
      .getAllByRole("button")
      // Zamknięcie okna jest kontrolką POWŁOKI (Radix), nie treścią pickera.
      .filter((node) => (node.textContent ?? "").trim() !== "Zamknij" && node.getAttribute("type") !== null);

    expect(przyciski.length, "okno bez ani jednej kontrolki wstawienia").toBeGreaterThan(0);
    for (const przycisk of przyciski) {
      const nazwa = przycisk.getAttribute("aria-label") ?? przycisk.textContent ?? "";
      expect(
        nazwa.trim().startsWith("Dodaj"),
        `kontrolka „${nazwa.trim()}” nie mówi, że wstawia sekcję`,
      ).toBe(true);
    }
  });
});
