import { DEFAULT_SITE_STYLE } from "@avably/core/site";
// @vitest-environment jsdom

/**
 * ODRZUCONY PROMISE AKCJI NIE ZOSTAWIA KREATORA W KŁAMSTWIE (L6, audyt E2E
 * 2026-08-07 — wzorzec „operator wierzy w fałszywy stan").
 *
 * Kanał mutacji `run` rozstrzygał wyłącznie WYNIK akcji (`ok: true/false`);
 * ODRZUCENIE obietnicy (memberCtx re-rzuca błędy inne niż AuthError — site.ts
 * :69 — plus każda awaria transportu) nie trafiało nigdzie: `settle` nie
 * odpalał się wcale, wskaźnik zostawał na „Zapisywanie…" NA ZAWSZE, a operator
 * zamykał kartę w przekonaniu, że edycja jest na serwerze.
 *
 * Kontrakt po naprawie: odrzucenie = stan błędu (komunikat + koniec
 * „Zapisywanie…") + MOŻLIWOŚĆ PONOWIENIA tej samej akcji. Edycja lokalna nie
 * ginie po cichu: autozapis nie ma rollbacku (treść zostaje w edytorze),
 * a ponowienie wysyła ją jeszcze raz.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

type Section = Parameters<typeof SiteBuilder>[0]["sections"][number];

const A: Section = { id: "aaaaaaaa-1111-4111-8111-111111111111", type: "hero", position: 0, enabled: true, deletedInDraft: false, published: true, content: { heading: "Alfa" } };
const B: Section = { id: "bbbbbbbb-2222-4222-8222-222222222222", type: "pricing", position: 1, enabled: true, deletedInDraft: false, published: true, content: { heading: "Beta" } };
const SITE_ID = "99999999-9999-4999-8999-999999999999";

const builder = plMessages.site.builder;
const sec = plMessages.site.sections;

function renderBuilder() {
  return render(
    <NextIntlClientProvider locale="pl" messages={plMessages} timeZone="Europe/Warsaw">
      <SiteBuilder siteId={SITE_ID} siteName="Strona sklepu" style={STYL} sections={[A, B]} products={[]} money={{ currency: "PLN", locale: "pl" }} />
    </NextIntlClientProvider>,
  );
}

/** Zaznacza sekcję i klika akcję z jej paska narzędzi. */
function clickToolbarAction(container: HTMLElement, sectionId: string, label: string) {
  const node = container.querySelector<HTMLElement>(`[data-canvas-section="${sectionId}"]`)!;
  fireEvent.pointerDown(node);
  const toolbar = node.querySelector<HTMLElement>(`[data-section-toolbar="${sectionId}"]`)!;
  fireEvent.click(within(toolbar).getByRole("button", { name: label }));
}

beforeEach(() => {
  for (const fn of Object.values(actions)) {
    fn.mockReset();
    // Domyślnie KAŻDA akcja kończy się sukcesem — scenariusz odrzucenia
    // nakłada się `mockRejectedValueOnce`, więc ponowienie ma na czym przejść.
    fn.mockResolvedValue({ ok: true });
  }
  actions.publishSite.mockResolvedValue({ ok: true, publishedAt: "2026-08-08T10:00:00Z" });
});

afterEach(() => cleanup());

describe("odrzucona akcja tła: stan błędu zamiast wiecznego „Zapisywanie…”", () => {
  it("wskaźnik NIE zostaje na „Zapisywanie…”, wychodzi komunikat błędu", async () => {
    actions.duplicateSection.mockRejectedValue(new Error("fetch failed"));
    const { container } = renderBuilder();
    clickToolbarAction(container, B.id, sec.duplicate);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(builder.saveFailed),
    );
    const state = container.querySelector("[data-builder-save-state]")!;
    expect(state.textContent, "wskaźnik wisi na „Zapisywanie…” po odrzuceniu").not.toBe(
      builder.saving,
    );
    // Odrzucenie nie ma prawa meldować sukcesu.
    expect(state.textContent).not.toBe(builder.saved);
  });

  it("obok komunikatu stoi ponowienie i wykonuje TĘ SAMĄ akcję jeszcze raz", async () => {
    actions.duplicateSection.mockRejectedValueOnce(new Error("fetch failed"));
    const { container } = renderBuilder();
    clickToolbarAction(container, B.id, sec.duplicate);

    const retry = await screen.findByRole("button", { name: builder.retry });
    expect(actions.duplicateSection).toHaveBeenCalledTimes(1);

    // Drugie podejście przechodzi (mock odrzucał tylko raz) — kreator wraca
    // do normalnego meldunku zapisu, komunikat błędu znika.
    fireEvent.click(retry);
    await waitFor(() => expect(actions.duplicateSection).toHaveBeenCalledTimes(2));
    expect(actions.duplicateSection).toHaveBeenLastCalledWith(B.id);
    const state = container.querySelector("[data-builder-save-state]")!;
    await waitFor(() => expect(state.textContent).toBe(builder.saved));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("AUTOZAPIS (kanał quiet) po odrzuceniu też melduje błąd z ponowieniem", async () => {
    // Kanał quiet obsługuje autozapis geometrii i treści płótna (K2/K2c) —
    // dokładnie ta ścieżka, na której zguba edycji boli najbardziej.
    actions.updateSiteStyle.mockRejectedValueOnce(new Error("fetch failed"));
    const { container } = renderBuilder();

    const accents = container.querySelectorAll<HTMLElement>("[data-style-accent]");
    const inny = [...accents].find((node) => node.getAttribute("aria-pressed") !== "true")!;
    fireEvent.click(inny);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(builder.saveFailed),
    );
    fireEvent.click(screen.getByRole("button", { name: builder.retry }));
    await waitFor(() => expect(actions.updateSiteStyle).toHaveBeenCalledTimes(2));
  });

  it("błąd BIZNESOWY (ok: false) zostaje przy starym kontrakcie — komunikat akcji, bez ponowienia", async () => {
    // Ponowienie ma sens przy awarii transportu; walidacja odrzuci drugie
    // podejście identycznie, więc przycisk obiecywałby naprawę, której nie ma.
    actions.duplicateSection.mockResolvedValue({ ok: false, error: "Limit sekcji osiągnięty." });
    const { container } = renderBuilder();
    clickToolbarAction(container, B.id, sec.duplicate);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Limit sekcji osiągnięty."),
    );
    expect(screen.queryByRole("button", { name: builder.retry })).toBeNull();
  });

  it("następna udana akcja sprząta błąd i ponowienie po poprzedniej", async () => {
    actions.duplicateSection.mockRejectedValueOnce(new Error("fetch failed"));
    const { container } = renderBuilder();
    clickToolbarAction(container, B.id, sec.duplicate);
    await screen.findByRole("button", { name: builder.retry });

    clickToolbarAction(container, A.id, sec.duplicate);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("button", { name: builder.retry })).toBeNull();
  });
});

describe("odrzucona PUBLIKACJA (kanał blokujący) też kończy się stanem błędu", () => {
  it("komunikat wychodzi, a przycisk publikacji nie wisi w oczekiwaniu", async () => {
    actions.publishSite.mockRejectedValue(new Error("fetch failed"));
    const { container } = renderBuilder();

    fireEvent.click(container.querySelector<HTMLElement>("[data-builder-publish]")!);
    const confirm = await screen.findByRole("button", { name: /^Opublikuj/ });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(builder.saveFailed),
    );
    const publish = container.querySelector<HTMLButtonElement>("[data-builder-publish]")!;
    await waitFor(() => expect(publish.disabled).toBe(false));
  });
});
