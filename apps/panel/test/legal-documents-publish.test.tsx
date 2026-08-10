// @vitest-environment jsdom

/**
 * PUBLIKACJA DOKUMENTU PRAWNEGO Z PANELU (B4, ADR-129) — droga kliknięcia.
 *
 * Publikacja przestawia to, co widzą KLIENCI sklepu, i zapisuje wiersz, którego
 * już nie da się zmienić. Dlatego kontrakt tej drogi jest twardy:
 *
 *   1. sam klik w „Opublikuj" NIE woła akcji — otwiera potwierdzenie;
 *   2. `created:false` (treść identyczna z żywą wersją) czyta się jako
 *      WYNIK, nie jako awaria: osobny komunikat, zero `role="alert"`;
 *   3. odmowa właściciela wraca jako błąd z komunikatem z serwera;
 *   4. dokument bez szkicu nie ma czego opublikować — przycisk jest wyłączony
 *      Z POWODEM, a nie cicho nieklikalny.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "../messages/pl.json";

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
  saveLegalDocumentDraftAction: vi.fn(),
  publishLegalDocumentAction: vi.fn(),
}));

vi.mock("@/app/[locale]/(panel)/dokumenty-prawne/actions", () => actions);
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/dokumenty-prawne",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const { LegalDocumentForm } = await import(
  "@/app/[locale]/(panel)/dokumenty-prawne/legal-document-form"
);

type Props = Parameters<typeof LegalDocumentForm>[0];

const terms: NonNullable<Props["document"]> = {
  kind: "terms",
  title: "Regulamin",
  bodyDraft: "Fikcyjna treść regulaminu.",
  locale: "pl",
  currentVersionLabel: "v2",
  currentPublishedAtLabel: "08.08.2026, 10:30",
  versions: [
    {
      id: "ver-2",
      versionNo: 2,
      versionLabel: "v2",
      publishedAtLabel: "08.08.2026, 10:30",
      checksum: "0123456789ab",
    },
  ],
};

const copy = messages.legalDocuments;

function renderForm(document: Props["document"] = terms) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <LegalDocumentForm kind="terms" document={document} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.saveLegalDocumentDraftAction.mockReset().mockResolvedValue({});
  actions.publishLegalDocumentAction
    .mockReset()
    .mockResolvedValue({ ok: true, created: true, versionLabel: "v3" });
});

afterEach(() => cleanup());

describe("publikacja idzie przez potwierdzenie", () => {
  it("sam klik w „Opublikuj” NIE publikuje", () => {
    const { container } = renderForm();
    fireEvent.click(container.querySelector<HTMLElement>("[data-legal-publish]")!);

    expect(
      actions.publishLegalDocumentAction,
      "publikacja poszła bez potwierdzenia",
    ).not.toHaveBeenCalled();
  });

  it("potwierdzenie mówi o SKUTKU dla klientów sklepu", async () => {
    const { container } = renderForm();
    fireEvent.click(container.querySelector<HTMLElement>("[data-legal-publish]")!);

    expect(await screen.findByText(copy.publishBodyReplace)).toBeTruthy();
    expect(screen.getByText(copy.publishNote)).toBeTruthy();
  });

  it("pierwsza publikacja dostaje INNE zdanie niż kolejna", async () => {
    const { container } = renderForm({ ...terms, currentVersionLabel: null, versions: [] });
    fireEvent.click(container.querySelector<HTMLElement>("[data-legal-publish]")!);

    expect(await screen.findByText(copy.publishBodyFirst)).toBeTruthy();
    expect(screen.queryByText(copy.publishBodyReplace)).toBeNull();
  });

  it("dopiero potwierdzenie woła akcję — rodzajem dokumentu", async () => {
    renderForm();
    fireEvent.click(document.querySelector<HTMLElement>("[data-legal-publish]")!);
    fireEvent.click(await screen.findByText(copy.publish, { selector: "[data-legal-publish-confirm]" }));

    await waitFor(() =>
      expect(actions.publishLegalDocumentAction).toHaveBeenCalledWith("terms"),
    );
  });
});

describe("wynik publikacji", () => {
  async function confirm() {
    renderForm();
    fireEvent.click(document.querySelector<HTMLElement>("[data-legal-publish]")!);
    fireEvent.click(
      await screen.findByText(copy.publish, { selector: "[data-legal-publish-confirm]" }),
    );
  }

  it("nowa wersja melduje SWÓJ numer, nie „zapisano”", async () => {
    await confirm();

    const line = await screen.findByText(copy.publishCreated.replace("{version}", "v3"));
    expect(line).toBeTruthy();
    expect(document.querySelector("[data-legal-publish-created]")).toBeTruthy();
  });

  it("created:false → komunikat o braku nowej wersji, a NIE błąd", async () => {
    actions.publishLegalDocumentAction.mockResolvedValue({
      ok: true,
      created: false,
      versionLabel: "v2",
    });
    await confirm();

    const line = await screen.findByText(copy.publishUnchanged);
    expect(line).toBeTruthy();
    expect(line.getAttribute("role"), "brak nowej wersji udaje awarię").not.toBe("alert");
    expect(document.querySelector("[data-legal-publish-unchanged]")).toBeTruthy();
    expect(document.querySelector("[data-legal-publish-created]")).toBeNull();
  });

  it("odmowa właściciela wraca jako błąd z komunikatem serwera", async () => {
    actions.publishLegalDocumentAction.mockResolvedValue({
      ok: false,
      error: "Tylko właściciel organizacji może zmieniać i publikować dokumenty prawne.",
    });
    await confirm();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Tylko właściciel organizacji");
    expect(document.querySelector("[data-legal-publish-created]")).toBeNull();
  });
});

describe("dokument bez zapisanego szkicu", () => {
  it("nie da się opublikować — przycisk wyłączony Z POWODEM", () => {
    const { container } = renderForm(null);
    const trigger = container.querySelector<HTMLButtonElement>("[data-legal-publish]");

    expect(trigger?.disabled, "publikacja pustego dokumentu jest klikalna").toBe(true);
    expect(screen.getByText(copy.publishNeedsDraft)).toBeTruthy();
  });

  it("formularz szkicu ZOSTAJE — brak dokumentu nie chowa ekranu", () => {
    const { container } = renderForm(null);

    expect(container.querySelector('textarea[name="body_draft"]')).toBeTruthy();
    expect(container.querySelector('input[name="title"]')).toBeTruthy();
    expect(screen.getByText(copy.statusUnpublished)).toBeTruthy();
  });
});
