// @vitest-environment jsdom

/**
 * Przełącznik archiwizacji SOFT na szczególe zamówienia (ADR-242) — kontrakt
 * warstwy klienta. Izolację w bazie dowodzi packages/db/test/order-archive-
 * isolation.test.ts; TU pilnujemy UI (wzorzec CustomerBanToggle):
 *
 *  1. stan „aktywne": badge aktywny, CTA „Archiwizuj";
 *  2. stan „zarchiwizowane": badge archiwum, CTA „Przywróć";
 *  3. zmiana WYMAGA potwierdzenia w oknie — dopiero submit woła akcję;
 *  4. woła WŁAŚCIWĄ akcję (archiwizuj vs przywróć wg stanu) z (prevState,
 *     formData), a FormData niesie orderId.
 *
 * Dowód mutacyjny (opis w raporcie): odwrócenie ternary `archived ? … : …`
 * przy CTA/akcji → testy 1/2/4 czerwone (CTA i wołana akcja przeciwne do stanu).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { OrderArchiveToggle } from "@/app/[locale]/(panel)/zamowienia/[id]/order-archive-toggle";
import type { FormState } from "@/lib/form-state";

import plMessages from "../messages/pl.json";

/** Radix Dialog woła API, których jsdom nie implementuje. */
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

const messages = { orders: { detail: { archive: plMessages.orders.detail.archive } } };
const t = plMessages.orders.detail.archive;
const ORDER = "00000000-0000-4000-8000-000000000007";

const ok = (result: FormState) => async (_p: FormState, _f: FormData): Promise<FormState> => result;

function renderToggle(
  archived: boolean,
  actions: {
    archiveAction: (p: FormState, f: FormData) => Promise<FormState>;
    restoreAction: (p: FormState, f: FormData) => Promise<FormState>;
  },
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <OrderArchiveToggle orderId={ORDER} archived={archived} {...actions} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

describe("OrderArchiveToggle — stan i etykiety", () => {
  it("zamówienie AKTYWNE: badge aktywny i CTA „Archiwizuj”", () => {
    renderToggle(false, { archiveAction: ok({}), restoreAction: ok({}) });
    expect(screen.getByText(t.statusActive)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.archiveCta })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.restoreCta })).toBeNull();
  });

  it("zamówienie ZARCHIWIZOWANE: badge archiwum i CTA „Przywróć”", () => {
    renderToggle(true, { archiveAction: ok({}), restoreAction: ok({}) });
    expect(screen.getByText(t.statusArchived)).toBeTruthy();
    expect(screen.getByRole("button", { name: t.restoreCta })).toBeTruthy();
    expect(screen.queryByRole("button", { name: t.archiveCta })).toBeNull();
  });
});

describe("OrderArchiveToggle — potwierdzenie woła właściwą akcję", () => {
  it("archiwizacja: dopiero potwierdzenie w oknie woła archiveAction (nie restore)", async () => {
    const archiveAction = vi.fn(ok({ success: "archived" }));
    const restoreAction = vi.fn(ok({ success: "restored" }));
    renderToggle(false, { archiveAction, restoreAction });

    fireEvent.click(screen.getByRole("button", { name: t.archiveCta }));
    expect(archiveAction).not.toHaveBeenCalled();

    expect(await screen.findByText(t.confirmArchiveTitle)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: t.confirmArchive });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => expect(archiveAction).toHaveBeenCalledTimes(1));
    expect(restoreAction).not.toHaveBeenCalled();
    // useActionState: (prevState, formData); FormData niesie orderId.
    expect(archiveAction.mock.calls[0]!.length).toBe(2);
    expect((archiveAction.mock.calls[0]![1] as FormData).get("orderId")).toBe(ORDER);
  });

  it("przywracanie: potwierdzenie woła restoreAction (nie archive)", async () => {
    const archiveAction = vi.fn(ok({ success: "archived" }));
    const restoreAction = vi.fn(ok({ success: "restored" }));
    renderToggle(true, { archiveAction, restoreAction });

    fireEvent.click(screen.getByRole("button", { name: t.restoreCta }));
    expect(await screen.findByText(t.confirmRestoreTitle)).toBeTruthy();
    const confirm = screen.getByRole("button", { name: t.confirmRestore });
    fireEvent.submit(confirm.closest("form")!);

    await waitFor(() => expect(restoreAction).toHaveBeenCalledTimes(1));
    expect(archiveAction).not.toHaveBeenCalled();
  });
});
