import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * PUBLIKACJA Z KREATORA MA POTWIERDZENIE I WŁASNY KOMUNIKAT (L6, audyt E2E
 * 2026-08-07 — wzorzec „operator wierzy w fałszywy stan").
 *
 * Dwa znaleziska audytu, oba o tym samym przycisku:
 *
 *   1. „Publikuj" w kreatorze wołał akcję OD RAZU (site-builder :596), podczas
 *      gdy lista wersji od 0048 ostrzega dialogiem, że dotychczasowa żywa
 *      strona przestanie być publiczna. Operator z kreatora gasił żywą wersję
 *      bez jednego zdania ostrzeżenia — a z listy z pełnym.
 *   2. Po publikacji wskaźnik mówił „Zapisano" (stan `saved` wspólny z
 *      autozapisem) — czyli zdanie PRAWDZIWE dla szkicu i FAŁSZYWE dla
 *      operacji, która właśnie przestawiła sklep.
 *
 * Kontrakt po naprawie: klik w „Publikuj" otwiera TEN SAM `PublishDialog`, co
 * lista wersji (reużycie, nie nowy UI); akcja idzie dopiero po potwierdzeniu;
 * sukces melduje „Opublikowano" osobnym stanem, nie „Zapisano".
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  useRouter: () => ({ refresh: () => {} }),
}));

const { SiteBuilder } = await import("@/app/[locale]/(kreator)/strona/[siteId]/kreator/site-builder");

type Props = Parameters<typeof SiteBuilder>[0];
type Section = Props["sections"][number];

const A: Section = { id: "aaaaaaaa-1111-4111-8111-111111111111", type: "hero", position: 0, enabled: true, deletedInDraft: false, published: true, content: { heading: "Alfa" } };
const SITE_ID = "99999999-9999-4999-8999-999999999999";

const builder = plMessages.site.builder;
const pages = plMessages.site.pages;

function renderBuilder(extra: Partial<Props> = {}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder
        siteId={SITE_ID}
        siteName="Strona sklepu"
        style={STYL}
        sections={[A]}
        products={[]}
        money={{ currency: "PLN", locale: "pl" }}
        {...extra}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-08-08T10:00:00Z" });
});

afterEach(() => cleanup());

describe("publikacja z kreatora wymaga potwierdzenia (ten sam dialog, co lista wersji)", () => {
  it("sam klik w „Publikuj” NIE woła akcji — otwiera potwierdzenie", async () => {
    const { container } = renderBuilder({ liveName: "Wersja wiosenna" });
    fireEvent.click(container.querySelector<HTMLElement>("[data-builder-publish]")!);

    expect(actions.publishSite, "publikacja poszła bez potwierdzenia").not.toHaveBeenCalled();
    // Tytuł dialogu z listy wersji — reużycie wzorca, nie nowy UI.
    expect(await screen.findByText(/Opublikować stronę/)).toBeTruthy();
  });

  it("ostrzega, że dotychczasowa ŻYWA wersja przestanie być publiczna", async () => {
    renderBuilder({ liveName: "Wersja wiosenna" });
    fireEvent.click(document.querySelector<HTMLElement>("[data-builder-publish]")!);

    const body = await screen.findByText(/Wersja wiosenna/);
    expect(body.textContent).toContain("przestanie być publiczna");
  });

  it("edycja wersji ŻYWEJ dostaje zdanie o odświeżeniu, nie o przełączeniu", async () => {
    renderBuilder({ live: true });
    fireEvent.click(document.querySelector<HTMLElement>("[data-builder-publish]")!);

    expect(await screen.findByText(pages.switchBodySelf)).toBeTruthy();
  });

  it("bez żadnej żywej wersji mówi o PIERWSZEJ publikacji", async () => {
    renderBuilder();
    fireEvent.click(document.querySelector<HTMLElement>("[data-builder-publish]")!);

    expect(await screen.findByText(pages.switchBodyFirst)).toBeTruthy();
  });

  it("potwierdzenie woła publishSite z id edytowanej wersji", async () => {
    renderBuilder({ liveName: "Wersja wiosenna" });
    fireEvent.click(document.querySelector<HTMLElement>("[data-builder-publish]")!);
    fireEvent.click(await screen.findByRole("button", { name: /^Opublikuj/ }));

    await waitFor(() => expect(actions.publishSite).toHaveBeenCalledWith(SITE_ID));
  });

  it("anulowanie zamyka dialog i NIE publikuje", async () => {
    renderBuilder({ liveName: "Wersja wiosenna" });
    fireEvent.click(document.querySelector<HTMLElement>("[data-builder-publish]")!);
    fireEvent.click(await screen.findByRole("button", { name: pages.cancel }));

    await waitFor(() => expect(screen.queryByText(/Opublikować stronę/)).toBeNull());
    expect(actions.publishSite).not.toHaveBeenCalled();
  });
});

describe("komunikat po publikacji mówi „Opublikowano”, nie „Zapisano”", () => {
  async function publish(container: HTMLElement) {
    fireEvent.click(container.querySelector<HTMLElement>("[data-builder-publish]")!);
    fireEvent.click(await screen.findByRole("button", { name: /^Opublikuj/ }));
  }

  it("po udanej publikacji wskaźnik niesie osobny komunikat publikacji", async () => {
    const { container } = renderBuilder();
    await publish(container);

    const state = container.querySelector("[data-builder-save-state]")!;
    await waitFor(() => expect(state.textContent).toBe(builder.published));
    expect(state.textContent).not.toBe(builder.saved);
  });

  it("zwykły zapis dalej melduje „Zapisano” — komunikat publikacji go nie zastępuje", async () => {
    actions.toggleSection.mockResolvedValue({ ok: true });
    const { container } = renderBuilder();

    const node = container.querySelector<HTMLElement>(`[data-canvas-section="${A.id}"]`)!;
    fireEvent.pointerDown(node);
    const toolbar = node.querySelector<HTMLElement>(`[data-section-toolbar="${A.id}"]`)!;
    fireEvent.click(
      [...toolbar.querySelectorAll("button")].find(
        (button) => button.getAttribute("aria-label") === plMessages.site.sections.disable,
      )!,
    );

    const state = container.querySelector("[data-builder-save-state]")!;
    await waitFor(() => expect(state.textContent).toBe(builder.saved));
  });

  it("nieudana publikacja zostawia komunikat błędu, bez fałszywego „Opublikowano”", async () => {
    actions.publishSite.mockResolvedValue({ ok: false, error: "Strona nie ma sekcji." });
    const { container } = renderBuilder();
    await publish(container);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Strona nie ma sekcji."),
    );
    expect(container.querySelector("[data-builder-save-state]")?.textContent).toBe("");
  });
});
