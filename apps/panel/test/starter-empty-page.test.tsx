// @vitest-environment jsdom

/**
 * PUSTA STRONA JEST PUNKTEM WYJŚCIA (ADR-161).
 *
 * Do tej pory nowa strona MUSIAŁA powstać z czegoś gotowego: galeria otwierała
 * się z automatu przy zerze sekcji, a jej jedyne wyjście („wróć do kreatora")
 * było ukryte dokładnie wtedy, gdy strona nie miała treści. Operator, który
 * chciał zbudować stronę po swojemu, musiał najpierw wziąć cudzą i ją
 * wyczyścić.
 *
 * Test trzyma trzy zdania:
 *   1. galeria otwarta z automatu (zero sekcji) MA kafel pustej strony;
 *   2. kliknięcie w niego odsłania PŁÓTNO — i nie woła ani jednej akcji
 *      serwera, bo pusta strona nie ma czego zapisać;
 *   3. szablon startowy dalej działa tą samą drogą (kontrola pozytywna: bez
 *      niej „nic nie zawołano" mogłoby znaczyć, że galeria w ogóle nie klika).
 */
import { DEFAULT_SITE_STYLE } from "@avably/core/site";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");

const SITE_ID = "99999999-9999-4999-8999-999999999999";

function renderEmptyBuilder() {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Nowa strona"
        style={DEFAULT_SITE_STYLE}
        sections={[]}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.applyStarterTemplate.mockResolvedValue({ ok: true, sectionIds: [] });
});
afterEach(cleanup);

describe("galeria punktów wyjścia zna pustą stronę (ADR-161)", () => {
  it("strona bez sekcji: galeria otwarta i MA kafel pustej strony", () => {
    const { container } = renderEmptyBuilder();

    expect(
      container.querySelector("[data-template-gallery]"),
      "galeria nie otworzyła się dla strony bez sekcji — dowód po pustym zbiorze",
    ).not.toBeNull();
    expect(container.querySelector("[data-starter-empty]")).not.toBeNull();
    // Kontrola pozytywna: to jest ta sama galeria, w której stoją szablony.
    expect(
      container.querySelectorAll("[data-starter-template]").length,
      "galeria bez szablonów — kafel pustej strony byłby jedyną pozycją",
    ).toBeGreaterThan(0);
  });

  it("klik w pustą stronę odsłania płótno i NIE woła serwera", async () => {
    const { container } = renderEmptyBuilder();

    fireEvent.click(container.querySelector<HTMLElement>("[data-starter-empty]")!);

    await waitFor(() =>
      expect(
        container.querySelector("[data-template-gallery]"),
        "galeria została na ekranie po wyborze pustej strony",
      ).toBeNull(),
    );
    expect(container.querySelector("[data-builder-stage]"), "płótno się nie odsłoniło").not.toBeNull();
    for (const [name, fn] of Object.entries(actions)) {
      expect(fn, `pusta strona zawołała ${name}`).not.toHaveBeenCalled();
    }
  });

  it("kontrola pozytywna: kafel szablonu dalej woła applyStarterTemplate", async () => {
    const { container } = renderEmptyBuilder();

    fireEvent.click(container.querySelector<HTMLElement>("[data-starter-template]")!);

    await waitFor(() => expect(actions.applyStarterTemplate).toHaveBeenCalledTimes(1));
  });
});
