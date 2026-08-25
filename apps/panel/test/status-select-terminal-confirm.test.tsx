// @vitest-environment jsdom

/**
 * POTWIERDZENIE PRZEJŚĆ NIEODWRACALNYCH (Finding 1 audytu cyklu zamówienia,
 * LOW/orphaned-state, ADR-270).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * `applyStatus` utrwala tranzycję OD RAZU po wyborze w dropdownie — a jedyny
 * dialog przed tą zmianą to prompt maila, który pojawia się DOPIERO PO zapisie.
 * Dla przejść TERMINALNYCH (`returned`, `cancelled`: nie ma z nich powrotu w
 * panelu, a `returned` zwalnia egzemplarz do dostępności) mis-klik lądował więc
 * bez żadnego pytania i bez cofnięcia. Ten test przypina BRAMKĘ: terminalny cel
 * z dropdownu otwiera JAWNE okno potwierdzenia i NIE woła akcji zmiany, dopóki
 * operator nie potwierdzi; anulowanie zostawia stan nietknięty.
 *
 * Asercja jest zawsze o TYM SAMYM: ile razy zawołano `changeStatus`. Napis na
 * ekranie przeszedłby także nad implementacją, która zapisuje najpierw, a pyta
 * potem — dowodem, że bramka jest PRZED zapisem, może być tylko liczba wywołań
 * akcji w chwili, gdy okno stoi otwarte.
 *
 * ================== ZASIĘG BRAMKI (regresja) ==================
 *
 * Bramka obejmuje WYŁĄCZNIE przejścia nieodwracalne. Przejście odwracalne
 * (korekta o krok, np. reserved → ready_for_pickup) MUSI iść bez tarcia jak
 * dotąd — osobny przypadek pilnuje, że potwierdzenie nie rozlało się na
 * normalną pracę lady.
 *
 * ================== DLACZEGO REALNY KOMPONENT ==================
 *
 * Testowana jest PRAWDZIWA `StatusSelect` z prawdziwą maszyną stanów z
 * `@avably/core` (to ona wyznacza, które cele są terminalne) i prawdziwym
 * oknem dialogowym; zamockowane są tylko dwie akcje serwerowe. Predykat
 * „terminalny" czyta canTransition, więc test spina UI z tą samą mapą, którą
 * egzekwuje trigger 0010.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormState } from "@/lib/form-state";

import messages from "../messages/pl.json";

import { StatusSelect } from "@/app/[locale]/(panel)/zamowienia/[id]/status-select";

const ORDER_ID = "00000000-0000-4000-8000-0000000000f2";
const detail = messages.orders.detail;
const statusLabels = messages.orders.statusLabels.order;

/** Radix Select i Dialog wołają API, których jsdom nie implementuje. */
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

let changeStatus: ReturnType<typeof vi.fn>;
let sendEmail: ReturnType<typeof vi.fn>;

type MountOptions = {
  currentStatus?: "pending" | "reserved" | "ready_for_pickup" | "picked_up";
  paymentStatus?: "unpaid" | "paid";
};

function mount(options: MountOptions = {}) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
      <StatusSelect
        changeStatus={changeStatus as never}
        sendEmail={sendEmail as never}
        orderId={ORDER_ID}
        currentStatus={options.currentStatus ?? "reserved"}
        paymentStatus={options.paymentStatus ?? "unpaid"}
        emailAvailability={{ available: true }}
      />
    </NextIntlClientProvider>,
  );
}

async function click(element: Element) {
  await act(async () => {
    fireEvent.click(element);
    await Promise.resolve();
  });
}

async function pickStatus(label: string) {
  await click(screen.getByRole("combobox"));
  const listbox = screen.getByRole("listbox");
  await click(within(listbox).getByRole("option", { name: label }));
}

function confirmDialog() {
  return screen.getByRole("dialog");
}

beforeEach(() => {
  changeStatus = vi.fn(async (): Promise<FormState> => ({ success: "changed" }));
  sendEmail = vi.fn(async () => ({}));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("potwierdzenie przejść nieodwracalnych (ADR-270)", () => {
  it("wybór `returned` (terminalny) otwiera potwierdzenie i NIE zapisuje jeszcze", async () => {
    mount({ currentStatus: "picked_up" });

    await pickStatus(statusLabels.returned);

    // Okno potwierdzenia stoi otwarte…
    expect(screen.getByText(detail.confirmTerminalTitle)).toBeTruthy();
    // …a treść nazywa docelowy status, żeby operator wiedział, co potwierdza.
    expect(within(confirmDialog()).getByText(new RegExp(statusLabels.returned))).toBeTruthy();
    // SEDNO: zapis się NIE wydarzył — bramka jest PRZED changeStatus.
    expect(changeStatus).not.toHaveBeenCalled();
  });

  it("potwierdzenie zapisuje tranzycję DOKŁADNIE raz, z poprawnym expectedFrom", async () => {
    mount({ currentStatus: "picked_up" });
    await pickStatus(statusLabels.returned);

    await click(within(confirmDialog()).getByRole("button", { name: detail.confirmTerminalConfirm }));

    expect(changeStatus).toHaveBeenCalledTimes(1);
    const formData = changeStatus.mock.calls[0]![1] as FormData;
    expect(formData.get("orderId")).toBe(ORDER_ID);
    expect(formData.get("to")).toBe("returned");
    expect(formData.get("expectedFrom")).toBe("picked_up");
  });

  it("anulowanie potwierdzenia NIE zapisuje niczego", async () => {
    mount({ currentStatus: "picked_up" });
    await pickStatus(statusLabels.returned);

    await click(within(confirmDialog()).getByRole("button", { name: detail.confirmTerminalCancel }));

    expect(changeStatus).not.toHaveBeenCalled();
    // Okno znika — a przy ponownym wyborze bramka działa znowu.
    expect(screen.queryByText(detail.confirmTerminalTitle)).toBeNull();
  });

  it("`cancelled` (terminalny) też jest bramkowany potwierdzeniem", async () => {
    mount({ currentStatus: "reserved" });
    await pickStatus(statusLabels.cancelled);

    expect(screen.getByText(detail.confirmTerminalTitle)).toBeTruthy();
    expect(changeStatus).not.toHaveBeenCalled();

    await click(within(confirmDialog()).getByRole("button", { name: detail.confirmTerminalConfirm }));
    expect(changeStatus).toHaveBeenCalledTimes(1);
    expect((changeStatus.mock.calls[0]![1] as FormData).get("to")).toBe("cancelled");
  });

  it("przejście ODWRACALNE (reserved → ready_for_pickup) idzie bez potwierdzenia", async () => {
    mount({ currentStatus: "reserved" });

    await pickStatus(statusLabels.ready_for_pickup);

    // Bramka NIE dotyczy przejść odwracalnych — zapis leci od razu, jak dotąd,
    // a okna potwierdzenia w ogóle nie ma.
    expect(screen.queryByText(detail.confirmTerminalTitle)).toBeNull();
    expect(changeStatus).toHaveBeenCalledTimes(1);
    expect((changeStatus.mock.calls[0]![1] as FormData).get("to")).toBe("ready_for_pickup");
  });
});
