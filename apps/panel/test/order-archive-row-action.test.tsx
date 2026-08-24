// @vitest-environment jsdom

/**
 * Akcja archiwizuj/przywróć w menu wiersza listy zamówień (ADR-242) — kontrakt
 * warstwy klienta. Izolację w bazie dowodzi packages/db/test/order-archive-
 * isolation.test.ts; TU pilnujemy UI:
 *
 *  1. w widoku AKTYWNYCH pozycja mówi „Archiwizuj", w ARCHIWUM „Przywróć"
 *     (etykieta zależy od widoku, nie od zgadywania);
 *  2. pozycja to przycisk SUBMIT (nie kotwica — nie nawiguje), z ukrytym
 *     polem `orderId`, które akcja czyta z FormData;
 *  3. bez sterowania archiwum menu tej pozycji NIE MA (okno domykania);
 *  4. potwierdzenie (submit) woła związaną akcję z (prevState, formData),
 *     a FormData niesie właściwy `orderId`.
 *
 * Radix DropdownMenu renderuje treść w portalu dopiero po otwarciu — stąd
 * jsdom + testing-library zamiast renderToStaticMarkup kontraktu tabeli.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";

import type { FormState } from "@/lib/form-state";

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/zamowienia",
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));

const { OrderRowActions } = await import("@/app/[locale]/(panel)/zamowienia/order-row-actions");

/** Radix DropdownMenu woła API, których jsdom nie implementuje. */
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

const ORDER = "00000000-0000-4000-8000-000000000001";
const labels = {
  trigger: "Działania dla ZAM-1",
  details: "Szczegóły",
  status: "Zmień status",
  archive: "Archiwizuj",
  restore: "Przywróć",
};

const ok = (result: FormState) => async (_p: FormState, _f: FormData): Promise<FormState> => result;

function renderActions(
  archive?: { archived: boolean; action: (p: FormState, f: FormData) => Promise<FormState> },
) {
  return render(<OrderRowActions orderId={ORDER} labels={labels} archive={archive} />);
}

/** Radix DropdownMenu otwiera się na pointerdown (wzorzec account-menu-contract). */
function openMenu(): void {
  fireEvent.pointerDown(screen.getByRole("button", { name: labels.trigger }), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
}

afterEach(() => cleanup());

describe("OrderRowActions — pozycja archiwum wg widoku", () => {
  it("widok AKTYWNYCH: menu ma pozycję „Archiwizuj”, przycisk submit z orderId", async () => {
    renderActions({ archived: false, action: ok({ success: "archived" }) });

    openMenu();

    const item = await screen.findByText(labels.archive);
    expect(item).toBeTruthy();
    // Przycisk SUBMIT, nie kotwica — nie nawiguje.
    const button = item.closest("button")!;
    expect(button.getAttribute("type")).toBe("submit");
    // Ukryte pole niesie id do akcji (czyta je z FormData).
    const form = button.closest("form")!;
    const hidden = form.querySelector('input[name="orderId"]') as HTMLInputElement;
    expect(hidden.value).toBe(ORDER);
    // W widoku aktywnych NIE ma „Przywróć".
    expect(screen.queryByText(labels.restore)).toBeNull();
  });

  it("widok ARCHIWUM: menu ma pozycję „Przywróć”, nie „Archiwizuj”", async () => {
    renderActions({ archived: true, action: ok({ success: "restored" }) });

    openMenu();

    expect(await screen.findByText(labels.restore)).toBeTruthy();
    expect(screen.queryByText(labels.archive)).toBeNull();
  });

  it("bez sterowania archiwum (okno domykania): menu ma tylko szczegół i status", async () => {
    renderActions(undefined);

    openMenu();

    expect(await screen.findByText(labels.details)).toBeTruthy();
    expect(screen.queryByText(labels.archive)).toBeNull();
    expect(screen.queryByText(labels.restore)).toBeNull();
  });
});

describe("OrderRowActions — potwierdzenie woła związaną akcję", () => {
  it("submit pozycji woła akcję z (prevState, formData) i właściwym orderId", async () => {
    const action = vi.fn(ok({ success: "archived" }));
    renderActions({ archived: false, action });

    openMenu();
    const button = (await screen.findByText(labels.archive)).closest("button")!;
    fireEvent.submit(button.closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    // useActionState: (prevState, formData).
    expect(action.mock.calls[0]!.length).toBe(2);
    const formData = action.mock.calls[0]![1] as FormData;
    expect(formData.get("orderId")).toBe(ORDER);
  });
});
