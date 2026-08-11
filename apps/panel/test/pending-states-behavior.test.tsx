// @vitest-environment jsdom

/**
 * STAN OCZEKIWANIA MUTACJI JEST PRAWDZIWY (uwaga właściciela 2026-07-28).
 *
 * ================== CO TEN TEST PILNUJE ==================
 *
 * Bramka `pending-states-gate` czyta ŹRÓDŁO i pilnuje, że przycisk NIESIE
 * `loading`/`aria-busy`. To za mało: `loading={pending}` można podpiąć pod flagę,
 * która nigdy nie wstaje, i ze źródła wygląda identycznie. Ten test dowodzi
 * ZACHOWANIA na PRAWDZIWYCH komponentach: po wysłaniu akcji przycisk realnie
 * wchodzi w `aria-busy=true`, a po rozstrzygnięciu do niego wraca.
 *
 * Akcja jest ODROCZONA (obietnica rozwiązywana ręcznie), więc „w trakcie" to
 * realny stan między kliknięciem a rozwiązaniem — nie migawka. Zamockowana jest
 * wyłącznie akcja serwerowa (granica sieci); komponent, hook `useActionState`
 * i `Button` z `@avably/ui` są prawdziwe.
 *
 * Trzy reprezentatywne formularze, w tym dwa świeże z dziś (R4, R1):
 *   • ExtensionForm  — przedłużenie najmu (R4), akcja wstrzykiwana propem;
 *   • ItemsEditor    — dodanie pozycji (R1), akcja wstrzykiwana propem;
 *   • EmailSenderForm— ustawienia nadawcy poczty, akcja przez moduł (mock).
 *
 * Dowód mutacyjny (inny wektor niż bramka, opis w raporcie): zdjęcie
 * `loading={pending}` z ExtensionForm gasi `aria-busy` → suita „ExtensionForm"
 * czerwona, niezależnie od bramki statycznej.
 */
import type { PriceParams } from "@avably/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FormState } from "@/lib/form-state";
import messages from "../messages/pl.json";

import { ExtensionForm } from "@/app/[locale]/(panel)/zamowienia/[id]/extension-form";
import {
  ItemsEditor,
  type EditorProduct,
} from "@/app/[locale]/(panel)/zamowienia/[id]/items-editor";

/** Radix Select/Dialog + kalendarz wołają API, których jsdom nie ma. */
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

/** DateField (react-day-picker) czyta matchMedia — jsdom go nie ma. */
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
    })),
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Obietnica rozwiązywana z zewnątrz — modeluje trwające żądanie serwerowe. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ─────────────────────────────── ExtensionForm (R4) ───────────────────────────────

const ZAGESZCZARKA: PriceParams = {
  basePriceDayGrosze: 10_000,
  depositGrosze: 5_000,
  autoIncrementMultiplier: 1.0,
  tiers: [{ tierDays: 7, multiplier: 6.5 }],
};

function dayButton(year: number, monthIndex: number, day: number): HTMLButtonElement {
  const label = new Date(year, monthIndex, day).toLocaleDateString("pl-PL");
  const button = document.querySelector<HTMLButtonElement>(`button[data-day="${label}"]`);
  if (!button) throw new Error(`Brak przycisku dnia ${label}`);
  return button;
}

describe("ExtensionForm (R4) — przycisk „Przedłuż najem” wchodzi w aria-busy", () => {
  it("po submicie jest aria-busy=true, po rozstrzygnięciu wraca", async () => {
    const action = deferred<FormState>();
    const fn = vi.fn(() => action.promise);

    render(
      <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
        <ExtensionForm
          orderId="00000000-0000-4000-8000-000000000001"
          startDate="2027-03-01"
          endDate="2027-03-05"
          items={[{ itemId: "i1", params: ZAGESZCZARKA }]}
          currency="PLN"
          locale="pl"
          action={fn as never}
        />
      </NextIntlClientProvider>,
    );

    // Wejście zwinięte: odsłoń formularz, otwórz kalendarz i wybierz datę po
    // końcu najmu — dopiero wtedy jest wycena i submit przestaje być zablokowany.
    fireEvent.click(screen.getByRole("button", { name: messages.orders.extension.trigger }));
    fireEvent.click(screen.getByRole("button", { name: messages.orders.extension.newEndLabel }));
    fireEvent.click(dayButton(2027, 2, 8)); // 2027-03-08

    const submit = screen.getByRole("button", { name: messages.orders.extension.cta });
    await waitFor(() =>
      expect((submit as HTMLButtonElement).disabled).toBe(false),
    );
    expect(submit.getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      fireEvent.click(submit);
    });
    // W trakcie odroczonej akcji — sygnał zajętości stoi.
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => {
      action.resolve({ success: "ok" });
    });
    await flush();
    expect(submit.getAttribute("aria-busy")).toBeNull();
  });
});

// ─────────────────────────────── ItemsEditor (R1) ───────────────────────────────

const UNIT_FREE = "00000000-0000-4000-8000-0000000000b1";
const HEATER: EditorProduct = {
  id: "00000000-0000-4000-8000-0000000000c1",
  name: "Nagrzewnica 20 kW",
  freeUnits: 1,
  totalUnits: 1,
  units: [{ id: UNIT_FREE, label: "NG-001", free: true }],
  proposedRentalGrosze: 50_000,
  proposedDepositGrosze: 5_000,
};

describe("ItemsEditor (R1) — przycisk „Dodaj pozycję” wchodzi w aria-busy", () => {
  it("po submicie formularza dodawania jest aria-busy=true, po rozstrzygnięciu wraca", async () => {
    const action = deferred<FormState>();
    const add = vi.fn(() => action.promise);
    const noop = vi.fn(async () => ({}));

    const { container } = render(
      <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
        <ItemsEditor
          orderId="00000000-0000-4000-8000-0000000000f1"
          orderStatus="reserved"
          editable
          items={[]}
          products={[HEATER]}
          collectedGrosze={0}
          totalRentalGrosze={0}
          totalDepositGrosze={0}
          currency="PLN"
          locale="pl"
          actions={{ add: add as never, update: noop as never, remove: noop as never }}
        />
      </NextIntlClientProvider>,
    );

    // Formularz dodawania jest ZWINIĘTY (U3, audyt 2.5) — otwieramy go tak,
    // jak operator: przyciskiem „Dodaj pozycję".
    await act(async () => {
      fireEvent.click(container.querySelector("[data-items-add-trigger]")!);
      await Promise.resolve();
    });

    const form = container.querySelector<HTMLFormElement>("[data-items-add]")!;
    const submit = within(form).getByRole("button", { name: messages.orders.items.addCta });
    expect(submit.getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(add).toHaveBeenCalledTimes(1);

    await act(async () => {
      action.resolve({});
    });
    await flush();
    expect(submit.getAttribute("aria-busy")).toBeNull();
  });
});

// ─────────────────────────── EmailSenderForm (ustawienia) ───────────────────────────

const emailAction = deferred<FormState>();
const saveEmailSender = vi.fn((..._args: unknown[]) => emailAction.promise);
vi.mock(
  "@/app/[locale]/(panel)/ustawienia-emaili/email-settings-actions",
  () => ({ saveEmailSenderAction: saveEmailSender }),
);

const { EmailSenderForm } = await import(
  "@/app/[locale]/(panel)/ustawienia-emaili/email-settings-form"
);

describe("EmailSenderForm (ustawienia) — przycisk „Zapisz” wchodzi w aria-busy", () => {
  it("po submicie jest aria-busy=true, po rozstrzygnięciu wraca", async () => {
    const { container } = render(
      <NextIntlClientProvider locale="pl" messages={messages} timeZone="Europe/Warsaw">
        <EmailSenderForm defaults={{ name: "Wypożyczalnia", replyTo: "" }} configured={false} />
      </NextIntlClientProvider>,
    );

    const form = container.querySelector<HTMLFormElement>("form")!;
    const submit = within(form).getByRole("button", {
      name: messages.emailSettings.saveCta,
    });
    expect(submit.getAttribute("aria-busy")).toBeNull();

    await act(async () => {
      fireEvent.submit(form);
    });
    expect(submit.getAttribute("aria-busy")).toBe("true");
    expect(saveEmailSender).toHaveBeenCalledTimes(1);

    await act(async () => {
      emailAction.resolve({ success: "ok" });
    });
    await flush();
    expect(submit.getAttribute("aria-busy")).toBeNull();
  });
});
